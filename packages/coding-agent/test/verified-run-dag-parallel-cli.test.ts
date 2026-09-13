import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

it("recovers two actually running writer namespaces after supervisor SIGKILL through the public CLI", async () => {
	const root = mkdtempSync(join(tmpdir(), "parallel-cli-"));
	const f = dagFixture(root);
	mkdirSync(f.stateRoot);
	f.contract.writer.tasks[0].attempts = [
		["/bin/sh", "-c", "cp input left; sleep 30"],
		["/bin/cp", "input", "left"],
	];
	f.contract.writer.tasks[1].attempts = [
		["/bin/sh", "-c", "tr a-z A-Z < input > right; sleep 30"],
		["/bin/sh", "-c", "tr a-z A-Z < input > right"],
	];
	const contract = { ...f.contract, writer: { ...f.contract.writer, maxConcurrentTasks: 2 } };
	const plan = planVerifiedRun(contract);
	const contractPath = join(root, "contract.json");
	writeFileSync(contractPath, JSON.stringify(contract));
	const repo = fileURLToPath(new URL("../../../", import.meta.url));
	const env = { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" };
	const prefix = ["--import", "tsx", "packages/coding-agent/src/cli.ts", "run"];
	const child = spawn(
		process.execPath,
		[
			...prefix,
			"start",
			"--contract",
			contractPath,
			"--approve",
			plan.contractDigest,
			"--command-id",
			"start",
			"--state-dir",
			f.stateRoot,
		],
		{ cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	child.stdout.resume();
	let diagnostics = "";
	child.stderr.on("data", (bytes: Buffer) => {
		diagnostics = (diagnostics + bytes.toString()).slice(-4096);
	});
	const closed = once(child, "close");
	try {
		await new Promise<void>((resolve, reject) => {
			let done = false;
			const timer = setTimeout(() => finish(new Error(`parallel writer timeout: ${diagnostics}`)), 20000);
			const watcher = watch(f.stateRoot, { recursive: true }, () => {
				if (
					existsSync(join(f.runPath, "tasks", "left-1-g1", "left")) &&
					existsSync(join(f.runPath, "tasks", "right-1-g1", "right"))
				)
					finish();
			});
			function finish(error?: Error) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				watcher.close();
				if (error) reject(error);
				else resolve();
			}
			void closed.then(
				() => finish(new Error(`supervisor exited early: ${diagnostics}`)),
				() => finish(new Error("child error")),
			);
		});
		const live = f.coordinator.inspect("dag");
		expect(live.activeExecutionIds).toHaveLength(2);
		expect(live.processes).toHaveLength(2);
		child.kill("SIGKILL");
		await closed;
		const deadline = performance.now() + 2000;
		while (f.coordinator.inspectTaskRecovery("dag").reason === "unsettled" && performance.now() < deadline)
			await delay(10);
		const report = f.coordinator.inspectTaskRecovery("dag");
		expect(report).toMatchObject({ readiness: "ready", retryableTaskIds: ["left", "right"] });
		const before = report.state;
		const result = spawnSync(
			process.execPath,
			[
				...prefix,
				"retry-tasks",
				"dag",
				"--execute",
				"--tasks",
				"left,right",
				"--approve",
				plan.contractDigest,
				"--base",
				contract.workspace.baseDigest,
				"--revision",
				String(before.revision),
				"--generation",
				String(before.generation),
				"--command-id",
				"retry",
				"--state-dir",
				f.stateRoot,
			],
			{ cwd: repo, env, encoding: "utf8", timeout: 20000 },
		);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			generation: 2,
			verification: "verified",
			settlement: "settled",
			activeExecutionIds: [],
			tasks: [{ attempt: 2 }, { attempt: 2 }, { attempt: 1 }],
		});
		expect(f.coordinator.inspect("dag").budget).toEqual(before.budget);
		const records = readRunJournal(f.runPath)?.records ?? [];
		expect(
			records.filter(
				({ generation, event }) => generation === 2 && event.kind === "dispatch" && event.role === "writer",
			),
		).toHaveLength(3);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		try {
			await closed;
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
}, 45000);
