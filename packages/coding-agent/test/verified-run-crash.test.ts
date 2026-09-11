import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { readRunClock } from "../src/core/verified-run/recovery-clock.ts";

let root: string;
const repo = fileURLToPath(new URL("../../../", import.meta.url));
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-crash-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture(options: { writerCrash?: boolean; verifyMs?: number } = {}) {
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	mkdirSync(workspace);
	mkdirSync(stateRoot);
	writeFileSync(join(workspace, "input"), "hello");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: "crash",
		goal: "copy once",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer: {
			kind: "scripted-agent",
			steps: [["/bin/sh", "-c", options.writerCrash ? "cp input output; sleep 3" : "cp input output"]],
			maxRequests: 2,
		},
		checks: [{ claimId: "answer", argv: ["/bin/sh", "-c", "sleep 3; cat output"], stdout: "hello" }],
		budget: {
			workMs: 15000,
			verifyMs: options.verifyMs ?? 30000,
			cleanupMs: 1000,
			maxOutputBytes: 4096,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const path = join(root, "contract.json");
	writeFileSync(path, JSON.stringify(contract));
	return {
		stateRoot,
		path,
		plan,
		workspace,
		runPath: join(stateRoot, "crash"),
		coordinator: new RunCoordinator(stateRoot),
	};
}
const env = () => ({ PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" });

async function crashAt(f: ReturnType<typeof fixture>, role: "writer" | "verifier") {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			"packages/coding-agent/src/cli.ts",
			"run",
			"start",
			"--contract",
			f.path,
			"--approve",
			f.plan.contractDigest,
			"--command-id",
			"start",
			"--state-dir",
			f.stateRoot,
		],
		{ cwd: repo, env: env(), stdio: ["ignore", "pipe", "pipe"] },
	);
	let diagnostic = "";
	child.stderr.on("data", (bytes: Buffer) => {
		diagnostic = (diagnostic + bytes.toString()).slice(-4096);
	});
	child.stdout.resume();
	const closed = once(child, "close");
	try {
		await new Promise<void>((resolve, reject) => {
			let finished = false;
			const timer = setTimeout(() => finish(new Error(`checkpoint timeout: ${diagnostic}`)), 25000);
			const observer = watch(f.stateRoot, { recursive: true }, () => {
				try {
					const journal = readRunJournal(f.runPath);
					if (!journal) return;
					const ready = journal.state.activeExecutionIds.some(
						(id) =>
							journal.state.processes.some((item) => item.executionId === id) &&
							journal.records.some(
								({ event }) => event.kind === "dispatch" && event.executionId === id && event.role === role,
							),
					);
					if (ready && (role === "verifier" || existsSync(join(f.runPath, "writer", "output")))) finish();
				} catch {
					/* A concurrent append can expose a partial read; the bounded observer retries on the next event. */
				}
			});
			function finish(error?: Error) {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				observer.close();
				if (error) reject(error);
				else resolve();
			}
			void closed.then(
				() => finish(new Error(`exited before checkpoint: ${diagnostic}`)),
				(error: unknown) => finish(error instanceof Error ? error : new Error("child error")),
			);
		});
		child.kill("SIGKILL");
		await closed;
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed;
	}
}

async function settledRecovery(f: ReturnType<typeof fixture>) {
	// A grandchild has no Node exit event in this process; poll its recorded OS identity, never infer exit from a delay.
	const deadline = performance.now() + 2000;
	while (true) {
		const report = f.coordinator.inspectRecovery("crash");
		if (report.readiness !== "unsettled" || performance.now() >= deadline) return report;
		await delay(10);
	}
}

describe("real supervisor crash recovery", () => {
	it("recovers the same candidate through CLI without repeating the AgentSession writer", async () => {
		const f = fixture();
		await crashAt(f, "verifier");
		const before = await settledRecovery(f);
		expect(before.readiness).toBe("ready");
		const journalBytes = readFileSync(join(f.runPath, "journal.v2.jsonl"));
		const inspected = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"packages/coding-agent/src/cli.ts",
				"run",
				"inspect",
				"crash",
				"--recovery",
				"--state-dir",
				f.stateRoot,
			],
			{ cwd: repo, env: env(), encoding: "utf8", timeout: 20000 },
		);
		expect(inspected.status, inspected.stderr).toBe(0);
		expect(JSON.parse(inspected.stdout)).toMatchObject({ readiness: "ready", ownership: "lease_required" });
		expect(readFileSync(join(f.runPath, "journal.v2.jsonl"))).toEqual(journalBytes);
		const resumeArgs = [
			"--import",
			"tsx",
			"packages/coding-agent/src/cli.ts",
			"run",
			"resume",
			"crash",
			"--approve",
			f.plan.contractDigest,
			"--candidate",
			before.state.candidateDigest ?? "",
			"--revision",
			String(before.state.revision),
			"--generation",
			String(before.state.generation),
			"--command-id",
			"resume",
			"--state-dir",
			f.stateRoot,
		];
		const denied = spawnSync(process.execPath, resumeArgs, {
			cwd: repo,
			env: env(),
			encoding: "utf8",
			timeout: 20000,
		});
		expect(denied.status, denied.stderr).toBe(2);
		expect(readFileSync(join(f.runPath, "journal.v2.jsonl"))).toEqual(journalBytes);
		const result = spawnSync(process.execPath, [...resumeArgs, "--execute"], {
			cwd: repo,
			env: env(),
			encoding: "utf8",
			timeout: 20000,
		});
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			generation: 2,
			verification: "verified",
			candidateDigest: before.state.candidateDigest,
			modelRequests: 2,
		});
		const after = f.coordinator.inspect("crash");
		expect(after.budget).toEqual(before.state.budget);
		expect(after.verificationDeadlineMs).toBe(before.state.verificationDeadlineMs);
		expect(readFileSync(join(f.workspace, "input"), "utf8")).toBe("hello");
	}, 45000);

	it("does not renew the verification allowance after a forced stop", async () => {
		const f = fixture({ verifyMs: 1500 });
		await crashAt(f, "verifier");
		const state = f.coordinator.inspect("crash");
		if (state.verificationDeadlineMs === null) throw new Error("missing clock");
		await delay(Math.max(0, state.verificationDeadlineMs - readRunClock().nowMs) + 20);
		expect(f.coordinator.inspectRecovery("crash").readiness).toBe("expired");
		await expect(
			f.coordinator.resume(
				{
					schemaVersion: "omk.verified-command.v1",
					kind: "resume",
					runId: "crash",
					commandId: "expired",
					expectedRevision: state.revision,
					expectedGeneration: state.generation,
					contractDigest: f.plan.contractDigest,
					candidateDigest: state.candidateDigest,
				},
				{ approvedContractDigest: f.plan.contractDigest },
			),
		).rejects.toThrow(/deadline/);
		expect(f.coordinator.inspect("crash").generation).toBe(1);
	}, 45000);

	it("preserves an interrupted writer as unresolved instead of replaying it", async () => {
		const f = fixture({ writerCrash: true });
		await crashAt(f, "writer");
		const report = f.coordinator.inspectRecovery("crash");
		expect(report.readiness).toBe("candidate_missing");
		expect(report.state.activeExecutionIds).toHaveLength(1);
		expect(report.state.generation).toBe(1);
		expect(report.state.verification).not.toBe("verified");
	}, 45000);
});
