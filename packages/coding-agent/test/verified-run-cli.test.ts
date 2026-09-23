import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunContract } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/commands/run-command.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";

let root: string;
let workspace: string;
let stateRoot: string;
let contractPath: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "verified-cli-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	contractPath = join(root, "contract.json");
	mkdirSync(workspace);
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "cli-run",
		goal: "Greeting fixture",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["greeting.txt"],
		writer: ["/bin/sh", "-c", "printf hello > greeting.txt"],
		checks: [{ claimId: "greeting", argv: ["/bin/cat", "greeting.txt"], stdout: "hello" }],
		budget: { workMs: 3000, verifyMs: 3000, cleanupMs: 15000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	writeFileSync(contractPath, JSON.stringify(contract));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function cli(args: readonly string[]) {
	return spawnSync(process.execPath, ["--import", "tsx", "packages/coding-agent/src/cli.ts", ...args], {
		cwd: fileURLToPath(new URL("../../../", import.meta.url)),
		env: { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
		encoding: "utf8",
		timeout: 20000,
		maxBuffer: 1048576,
	});
}

describe("verified run public CLI", () => {
	it("preserves adjacent provider-sync dispatch when main delegates to the router", async () => {
		const result = await runCommand(["provider", "sync"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
	});

	it("handles its command prefix instead of falling through to a model prompt", async () => {
		const result = await runCommand(["run", "start"]);
		expect(result).toEqual({ handled: true, exitCode: 2 });
	});

	it("plans through the real executable without creating run state", () => {
		const result = cli(["run", "plan", "--contract", contractPath, "--json"]);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ baseMatches: true, executionRequested: false });
		expect(readdirSync(workspace)).toEqual([]);
	});

	it.each(["linux-command-v1", "linux-scripted-agent-v1"] as const)(
		"runs %s through CLI, reconnects, and returns the bound artifact",
		(profile) => {
			const base = parseRunContract(JSON.parse(readFileSync(contractPath, "utf8")));
			if (base.profile !== "linux-command-v1") throw new Error("invalid fixture");
			const contract =
				profile === "linux-command-v1"
					? base
					: parseRunContract({
							...base,
							profile,
							writer: { kind: "scripted-agent", steps: [base.writer], maxRequests: 2 },
							budget: { ...base.budget, workMs: 10000 },
						});
			writeFileSync(contractPath, JSON.stringify(contract));
			const plan = planVerifiedRun(contract);
			const started = cli([
				"run",
				"start",
				"--contract",
				contractPath,
				"--approve",
				plan.contractDigest,
				"--command-id",
				"cli-command",
				"--state-dir",
				stateRoot,
			]);
			expect(started.status, started.stderr).toBe(0);
			const inspected = cli(["run", "inspect", "cli-run", "--state-dir", stateRoot, "--json"]);
			expect(inspected.status, inspected.stderr).toBe(0);
			expect(JSON.parse(inspected.stdout)).toEqual(JSON.parse(started.stdout));
			const sdk = new RunCoordinator(stateRoot).inspect("cli-run");
			expect(sdk.verification).toBe("verified");
			if (!sdk.candidateDigest) throw new Error("missing fixture candidate");
			const artifact = cli([
				"run",
				"artifact",
				"cli-run",
				"--state-dir",
				stateRoot,
				"--candidate",
				sdk.candidateDigest,
				"--path",
				"greeting.txt",
			]);
			expect(artifact.status, artifact.stderr).toBe(0);
			expect(JSON.parse(artifact.stdout)).toMatchObject({
				encoding: "base64",
				data: Buffer.from("hello").toString("base64"),
			});
		},
	);

	it("rejects missing approval and unsupported apply without dispatch", () => {
		expect(cli(["run", "start", "--contract", contractPath, "--state-dir", stateRoot]).status).toBe(2);
		expect(cli(["run", "apply", "cli-run", "--state-dir", stateRoot]).status).toBe(2);
		expect(readdirSync(workspace)).toEqual([]);
	});
});
