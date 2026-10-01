import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "verified-cli-control-"));
	stateRoot = join(root, "state");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = () => ({ PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" });
const argv = (args: readonly string[]) => ["--import", "tsx", "packages/coding-agent/src/cli.ts", ...args];

function cli(args: readonly string[]) {
	return spawnSync(process.execPath, argv(args), {
		cwd: repo,
		env: env(),
		encoding: "utf8",
		timeout: 60000,
		maxBuffer: 1048576,
	});
}

function contractFile(runId: string, writer: string[]) {
	const workspace = join(root, `workspace-${runId}`);
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId,
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer,
		checks: [{ claimId: "copy", argv: ["/bin/cat", "output"], stdout: "original" }],
		budget: {
			workMs: 60000,
			verifyMs: 20000,
			cleanupMs: 15000,
			maxOutputBytes: 4096,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const path = join(root, `${runId}.json`);
	writeFileSync(path, JSON.stringify(contract));
	return { path, digest: planVerifiedRun(contract).contractDigest };
}

function startArgs(contract: { path: string; digest: string }) {
	return ["run", "start", "--contract", contract.path, "--approve", contract.digest, "--command-id", "start"].concat([
		"--state-dir",
		stateRoot,
	]);
}

describe("omk run cancel and gc from the public CLI", () => {
	it("cancels a run started by another process, which exits paused and resumable", async () => {
		const contract = contractFile("slow", ["/bin/sleep", "60"]);
		const child = spawn(process.execPath, argv(startArgs(contract)), { cwd: repo, env: env() });
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
		try {
			const deadline = Date.now() + 45000;
			while ((readRunJournal(join(stateRoot, "slow"))?.state.activeExecutionIds.length ?? 0) === 0) {
				if (Date.now() > deadline) throw new Error("writer never started");
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			const cancelled = cli(["run", "cancel", "slow", "--wait-ms", "30000", "--state-dir", stateRoot, "--json"]);
			expect(cancelled.status, cancelled.stderr).toBe(0);
			expect(JSON.parse(cancelled.stdout)).toMatchObject({
				runId: "slow",
				outcome: "observed",
				status: { lifecycle: "cancelled", terminal: false },
			});
			expect(await exited).toBe(1);
			expect(JSON.parse(stdout)).toMatchObject({ execution: "paused", failure: "cancelled" });
			expect(existsSync(join(stateRoot, "slow", "cancel-request.json"))).toBe(false);

			const gc = cli(["run", "gc", "--older-than", "0ms", "--state-dir", stateRoot, "--json"]);
			expect(gc.status, gc.stderr).toBe(0);
			expect(JSON.parse(gc.stdout).runs).toEqual([
				expect.objectContaining({ runId: "slow", action: "kept", reason: "recoverable" }),
			]);
		} finally {
			child.kill("SIGKILL");
		}
	}, 120000);

	it("prunes a finished run only with --execute and keeps its evidence readable", () => {
		const contract = contractFile("done", ["/bin/cp", "input", "output"]);
		const started = cli(startArgs(contract));
		expect(started.status, started.stderr).toBe(0);
		// Age by file time, not wall clock: this host's wall clock can step backwards.
		const old = new Date(Date.now() - 8 * 86_400_000);
		utimesSync(join(stateRoot, "done", "journal.v2.jsonl"), old, old);
		const dry = cli(["run", "gc", "--older-than", "7d", "--state-dir", stateRoot, "--json"]);
		expect(dry.status, dry.stderr).toBe(0);
		expect(JSON.parse(dry.stdout)).toMatchObject({
			execute: false,
			runs: [{ runId: "done", action: "prunable", paths: ["candidate", "writer"] }],
		});
		expect(existsSync(join(stateRoot, "done", "writer"))).toBe(true);
		const executed = cli(["run", "gc", "--older-than", "7d", "--execute", "--state-dir", stateRoot, "--json"]);
		expect(executed.status, executed.stderr).toBe(0);
		expect(JSON.parse(executed.stdout).runs[0]).toMatchObject({ action: "pruned" });
		expect(existsSync(join(stateRoot, "done", "writer"))).toBe(false);
		const evidence = cli(["run", "evidence", "done", "--state-dir", stateRoot, "--json"]);
		expect(evidence.status, evidence.stderr).toBe(0);
	}, 120000);

	it("rejects malformed cancel and gc arguments as usage errors", () => {
		for (const args of [
			["run", "cancel"],
			["run", "cancel", "slow", "--wait-ms", "600001"],
			["run", "cancel", "slow", "--wait-ms", "-1"],
			["run", "gc", "--older-than", "7"],
			["run", "gc", "extra"],
		])
			expect(cli([...args, "--state-dir", stateRoot]).status).toBe(2);
		const missing = cli(["run", "cancel", "missing", "--state-dir", stateRoot]);
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain("missing_run");
	}, 120000);
});
