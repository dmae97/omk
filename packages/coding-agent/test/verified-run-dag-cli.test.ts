import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

it("recovers a killed DAG writer through CLI while preserving its completed sibling and original budget", async () => {
	const root = mkdtempSync(join(tmpdir(), "dag-cli-"));
	const f = dagFixture(root, true);
	mkdirSync(f.stateRoot);
	f.contract.writer.tasks[1].attempts[0] = ["/bin/sh", "-c", "cp input right; sleep 30"];
	const plan = planVerifiedRun(f.contract);
	const path = join(root, "contract.json");
	writeFileSync(path, JSON.stringify(f.contract));
	const repo = fileURLToPath(new URL("../../../", import.meta.url));
	const env = { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" };
	const prefix = ["--import", "tsx", "packages/coding-agent/src/cli.ts", "run"];
	const child = spawn(
		process.execPath,
		[
			...prefix,
			"start",
			"--contract",
			path,
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
			const timeout = setTimeout(() => finish(new Error(`DAG checkpoint timeout: ${diagnostics}`)), 20000);
			const watcher = watch(f.stateRoot, { recursive: true }, () => {
				if (existsSync(join(f.runPath, "tasks", "right-1-g1", "right"))) finish();
			});
			function finish(error?: Error) {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				watcher.close();
				if (error) reject(error);
				else resolve();
			}
			void closed.then(
				() => finish(new Error(`DAG exited before checkpoint: ${diagnostics}`)),
				() => finish(new Error("child error")),
			);
		});
		child.kill("SIGKILL");
		await closed;
		const deadline = performance.now() + 2000;
		while (f.coordinator.inspectTaskRecovery("dag").reason === "unsettled" && performance.now() < deadline)
			await delay(10);
		const before = f.coordinator.inspect("dag");
		writeFileSync(join(f.workspace, "input"), "changed original");
		writeFileSync(join(f.runPath, "tasks", "right-1-g1", "right"), "discard partial");
		const bytes = readFileSync(journalPath(f.runPath));
		const inspect = spawnSync(
			process.execPath,
			[...prefix, "inspect", "dag", "--task-recovery", "--state-dir", f.stateRoot],
			{ cwd: repo, env, encoding: "utf8", timeout: 20000 },
		);
		expect(inspect.status, inspect.stderr).toBe(0);
		expect(JSON.parse(inspect.stdout)).toMatchObject({
			readiness: "ready",
			retryableTaskIds: ["right"],
			ownership: "lease_required",
		});
		expect(readFileSync(journalPath(f.runPath))).toEqual(bytes);
		const args = [
			...prefix,
			"retry-tasks",
			"dag",
			"--tasks",
			"right",
			"--approve",
			plan.contractDigest,
			"--base",
			f.contract.workspace.baseDigest,
			"--revision",
			String(before.revision),
			"--generation",
			String(before.generation),
			"--command-id",
			"retry",
			"--state-dir",
			f.stateRoot,
		];
		const denied = spawnSync(process.execPath, args, { cwd: repo, env, encoding: "utf8", timeout: 20000 });
		expect(denied.status, denied.stderr).toBe(2);
		expect(readFileSync(journalPath(f.runPath))).toEqual(bytes);
		const result = spawnSync(process.execPath, [...args, "--execute"], {
			cwd: repo,
			env,
			encoding: "utf8",
			timeout: 20000,
		});
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			generation: 2,
			verification: "verified",
			tasks: [
				{ taskId: "left", attempt: 1 },
				{ taskId: "right", attempt: 2 },
				{ taskId: "join", attempt: 1 },
			],
		});
		expect(f.coordinator.inspect("dag").budget).toEqual(before.budget);
		expect(readFileSync(join(f.runPath, "writer-2", "joined"), "utf8")).toBe("originalORIGINAL");
		expect(readFileSync(join(f.runPath, "tasks", "right-1-g1", "right"), "utf8")).toBe("discard partial");
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed;
		rmSync(root, { recursive: true, force: true });
	}
}, 45000);
