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
