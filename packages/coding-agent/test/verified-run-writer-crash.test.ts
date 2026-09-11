import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createRunCoordinator } from "../src/core/agent-session-services.ts";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";

it("restarts a SIGKILLed writer through CLI without borrowing time or losing its input checkpoint", async () => {
	const root = mkdtempSync(join(tmpdir(), "writer-crash-"));
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	const runPath = join(stateRoot, "writer");
	mkdirSync(workspace);
	mkdirSync(stateRoot);
	writeFileSync(join(workspace, "input"), "original");
	const repo = fileURLToPath(new URL("../../../", import.meta.url));
	const env = { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" };
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: "writer",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer: { kind: "scripted-agent", steps: [["/bin/sh", "-c", "cp input output; sleep 3"]], maxRequests: 4 },
		checks: [{ claimId: "copy", argv: ["/bin/cat", "output"], stdout: "original" }],
		budget: { workMs: 30000, verifyMs: 5000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const contractPath = join(root, "contract.json");
	writeFileSync(contractPath, JSON.stringify(contract));
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
			stateRoot,
		],
		{ cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	let diagnostics = "";
	child.stdout.resume();
	child.stderr.on("data", (bytes: Buffer) => {
		diagnostics = (diagnostics + bytes.toString()).slice(-4096);
	});
	const closed = once(child, "close");
	try {
		await new Promise<void>((resolve, reject) => {
			let done = false;
			const timeout = setTimeout(() => finish(new Error(`writer checkpoint timeout: ${diagnostics}`)), 20000);
			const watcher = watch(stateRoot, { recursive: true }, () => {
				if (existsSync(join(runPath, "writer", "output"))) finish();
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
				() => finish(new Error(`writer exited before checkpoint: ${diagnostics}`)),
				() => finish(new Error("child error")),
			);
		});
		child.kill("SIGKILL");
		await closed;
		const coordinator = createRunCoordinator(stateRoot);
		const settleDeadline = performance.now() + 2000;
		while (
			coordinator.inspectWriterRecovery("writer").readiness === "unsettled" &&
			performance.now() < settleDeadline
		)
			await delay(10);
		const before = coordinator.inspect("writer");
		expect(before.modelRequests).toBe(1);
		writeFileSync(join(workspace, "input"), "changed original workspace");
		writeFileSync(join(runPath, "writer", "output"), "old forensic output");
		const inspect = spawnSync(
			process.execPath,
			[...prefix, "inspect", "writer", "--writer-recovery", "--state-dir", stateRoot],
			{ cwd: repo, env, encoding: "utf8", timeout: 20000 },
		);
		expect(inspect.status, inspect.stderr).toBe(0);
		expect(JSON.parse(inspect.stdout)).toMatchObject({ readiness: "ready", ownership: "lease_required" });
		const args = [
			...prefix,
			"restart-writer",
			"writer",
			"--approve",
			plan.contractDigest,
			"--base",
			contract.workspace.baseDigest,
			"--revision",
			String(before.revision),
			"--generation",
			String(before.generation),
			"--command-id",
			"restart",
			"--state-dir",
			stateRoot,
		];
		const denied = spawnSync(process.execPath, args, { cwd: repo, env, encoding: "utf8", timeout: 20000 });
		expect(denied.status, denied.stderr).toBe(2);
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
			modelRequests: 3,
			inputDigest: before.inputDigest,
		});
		expect(coordinator.inspect("writer").budget).toEqual(before.budget);
		expect(readFileSync(join(runPath, "writer-2", "output"), "utf8")).toBe("original");
		expect(readFileSync(join(runPath, "writer", "output"), "utf8")).toBe("old forensic output");
		expect(readFileSync(join(workspace, "input"), "utf8")).toBe("changed original workspace");
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed;
		rmSync(root, { recursive: true, force: true });
	}
}, 45000);
