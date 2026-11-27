import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCompletionStatusContract } from "omk-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import { GoalVerifier } from "../src/core/goal-verification.ts";
import { evaluatePlanHostBoundary } from "../src/core/plan-host-boundary.ts";
import { assertMetacogNoAuthority, createHeuristicSignal } from "../src/metacognition/score-semantics.ts";

const tempDirs: string[] = [];

function makeGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-p0-wave1-"));
	tempDirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

const noSandbox = () => undefined;

afterEach(() => {
	while (tempDirs.length > 0) {
		const d = tempDirs.pop();
		if (d) rmSync(d, { recursive: true, force: true });
	}
});

describe("P0-01: durable goal verification obligation survives real process restart", () => {
	it("blocks GoalAcceptance.complete() after restart when pre-restart verification receipts exist on disk", async () => {
		const root = makeGitRepo();
		const store = new DurableGoalStore(join(root, ".omk", "goals", "goal.json"));
		const created = await store.create(
			createDurableGoal({
				id: "g-p01",
				objective: "survive restart",
				maxRounds: 3,
				now: "2026-11-27T00:00:00.000Z",
			}),
		);

		// Process 1 approves and verifies.
		const proc1 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		proc1.approve(created, "printf ok");
		await proc1.check(store, created, root);

		// Workspace mutates after check.
		writeFileSync(join(root, "index.ts"), "export const x = 2;\n");

		// Process 2 restarts cleanly with fresh GoalAcceptance (empty in-memory maps).
		const proc2 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		const reloaded = (await store.current())!;
		await expect(proc2.complete(store, reloaded, root)).rejects.toThrow(/reverify|verify|withdrawn|restart/i);
	});

	it("still blocks GoalAcceptance.complete() after restart even when the receipt directory is deleted while journal evidence remains", async () => {
		const root = makeGitRepo();
		const store = new DurableGoalStore(join(root, ".omk", "goals", "goal.json"));
		const created = await store.create(
			createDurableGoal({
				id: "g-p01-no-receipt-dir",
				objective: "survive restart without receipt dir",
				maxRounds: 3,
				now: "2026-11-27T00:00:00.000Z",
			}),
		);

		const proc1 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		proc1.approve(created, "printf ok");
		await proc1.check(store, created, root);

		// Simulate receipt directory disappearing before/after restart while goal journal keeps its evidence.
		rmSync(join(root, ".omk", "goals", "evidence"), { recursive: true, force: true });

		const proc2 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		const reloaded = (await store.current())!;
		expect(reloaded.evidence.length).toBeGreaterThan(0);
		await expect(proc2.complete(store, reloaded, root)).rejects.toThrow(/reverify|verify|restart|withdrawn/i);
	});
});

describe("P0-02: /plan read-only enforcement at host execution boundary", () => {
	it("blocks mutating shell commands, unknown extension tools, and non-readonly MCP tools", () => {
		expect(
			evaluatePlanHostBoundary({
				toolName: "bash",
				source: "shell",
				args: { command: "echo hi > evil.txt" },
			}).allowed,
		).toBe(false);

		expect(
			evaluatePlanHostBoundary({
				toolName: "bash",
				source: "shell",
				args: { command: "git status\nrm -rf /tmp/x" },
			}).allowed,
		).toBe(false);

		expect(
			evaluatePlanHostBoundary({
				toolName: "custom_ext_deploy",
				source: "extension",
			}).allowed,
		).toBe(false);

		expect(
			evaluatePlanHostBoundary({
				toolName: "postgres__drop_table",
				source: "mcp",
				readOnlyHint: false,
			}).allowed,
		).toBe(false);

		// Read-only shell, read-only builtin, and readOnlyHint MCP remain allowed.
		expect(
			evaluatePlanHostBoundary({
				toolName: "bash",
				source: "shell",
				args: { command: "git status && ls -la" },
			}).allowed,
		).toBe(true);
		expect(
			evaluatePlanHostBoundary({
				toolName: "github__get_file_contents",
				source: "mcp",
				readOnlyHint: true,
			}).allowed,
		).toBe(true);
		expect(
			evaluatePlanHostBoundary({
				toolName: "read",
				source: "builtin",
			}).allowed,
		).toBe(true);
	});

	it("blocks file-creating bypass commands (fd -x, rg --pre, find -fprint0, sort -ofile, git branch create) and enforces /plan at final tool execution boundary", async () => {
		const { createBashToolDefinition } = await import("../src/core/tools/bash.ts");
		const { createWriteToolDefinition } = await import("../src/core/tools/write.ts");
		const { createEditToolDefinition } = await import("../src/core/tools/edit.ts");
		const { setPlanReadOnlyActive, toReadOnlySandboxPolicy } = await import("../src/core/plan-host-boundary.ts");

		// File-creating / mutating command bypasses that previously slipped past allowlist checks
		for (const cmd of [
			"fd . -x touch evil.txt",
			"fd . --exec-batch rm -f",
			"rg --pre sh foo",
			"rg --pre=sh foo",
			"find . -fprint0 evil.txt",
			"sort -oout.txt README.md",
			"git branch created-during-plan",
			"git branch --set-upstream-to=origin/main",
			"echo hi 1>evil.txt",
			"cat <<< payload",
		]) {
			expect(
				evaluatePlanHostBoundary({ toolName: "bash", source: "shell", args: { command: cmd } }).allowed,
				`expected /plan to block: ${cmd}`,
			).toBe(false);
		}

		// Legitimate read-only commands stay allowed
		for (const cmd of [
			"fd . packages/coding-agent/src",
			"rg evaluatePlanHostBoundary packages/coding-agent/src",
			"find . -maxdepth 2 -name '*.ts'",
			"sort -u README.md",
			"git branch --show-current",
			"git branch -a -v",
		]) {
			expect(
				evaluatePlanHostBoundary({ toolName: "bash", source: "shell", args: { command: cmd } }).allowed,
				`expected /plan to allow: ${cmd}`,
			).toBe(true);
		}

		// Final execution boundary enforcement inside bash, write, and edit tools
		const root = makeGitRepo();
		const sessionId = "plan-exec-boundary-session";
		const fakeCtx = { sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined } } as never;
		setPlanReadOnlyActive(sessionId, true);
		try {
			const writeTool = createWriteToolDefinition(root);
			await expect(
				writeTool.execute("tc-w", { path: "blocked.txt", content: "nope" }, undefined, undefined, fakeCtx),
			).rejects.toThrow(/plan\.host_readonly/i);

			const editTool = createEditToolDefinition(root);
			await expect(
				editTool.execute(
					"tc-e",
					{ path: "index.ts", edits: [{ oldText: "x = 1", newText: "x = 9" }] },
					undefined,
					undefined,
					fakeCtx,
				),
			).rejects.toThrow(/plan\.host_readonly/i);

			const bashTool = createBashToolDefinition(root);
			await expect(
				bashTool.execute("tc-b", { command: "fd . -x touch evil.txt" }, undefined, undefined, fakeCtx),
			).rejects.toThrow(/plan\.host_readonly/i);

			// Read-only sandbox policy strips all writeAllow/tempWrite mounts
			const { createWorkspaceSandboxPolicy } = await import("../src/core/sandbox/default-policy.ts");
			const roPolicy = toReadOnlySandboxPolicy(createWorkspaceSandboxPolicy(root, "enforce"));
			expect(roPolicy.filesystem.writeAllow).toEqual([]);
			expect(roPolicy.filesystem.tempWrite).toEqual([]);
			expect(roPolicy.filesystem.denyWrite).toContain(root);
		} finally {
			setPlanReadOnlyActive(sessionId, false);
		}
	});
});

describe("P0-03: unified completion status contract separates progress, model claim, and verified completion", () => {
	it("never upgrades 100% plan progress plus model done claim into verified_complete without passing evidence", () => {
		const claimed = deriveCompletionStatusContract({
			completedSteps: 5,
			totalSteps: 5,
			modelClaimedDone: true,
			modelSummary: "All done!",
			verification: { state: "unverified", reason: "no acceptance check run" },
		});
		expect(claimed.planProgress.status).toBe("steps_checked");
		expect(claimed.modelClaim.claimedDone).toBe(true);
		expect(claimed.modelClaim.authoritative).toBe(false);
		expect(claimed.effectiveStatus).toBe("claimed_unverified");

		const verified = deriveCompletionStatusContract({
			completedSteps: 5,
			totalSteps: 5,
			modelClaimedDone: true,
			verification: {
				state: "verified_complete",
				evidenceId: "rcpt-1",
				evidenceDigest: "a".repeat(64),
				workspaceSha256: "b".repeat(64),
			},
		});
		expect(verified.effectiveStatus).toBe("verified_complete");
	});
});

describe("P0-04: metacognition heuristic scores are explicitly uncalibrated and hold zero approval/verification authority", () => {
	it("labels heuristic scores as uncalibrated and rejects authority escalation attempts", () => {
		const sig = createHeuristicSignal(0.94, "router-v4");
		expect(sig.kind).toBe("uncalibrated_heuristic");
		expect(sig.isCalibratedProbability).toBe(false);
		expect(sig.grantsApprovalAuthority).toBe(false);
		expect(sig.grantsVerificationAuthority).toBe(false);
		expect(sig.displayLabel).toContain("uncalibrated");
		expect(sig.displayLabel).not.toMatch(/calibrated probability/i);

		expect(() => assertMetacogNoAuthority("approve", sig)).toThrow(/authority/i);
		expect(() => assertMetacogNoAuthority("verify", sig)).toThrow(/authority/i);
		expect(() => assertMetacogNoAuthority("complete", sig)).toThrow(/authority/i);
	});
});
