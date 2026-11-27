import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDurableGoal, nextDurableGoalTimestamp } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import { evaluateGoalRestartRecovery } from "../src/core/goal-restart-recovery.ts";
import { GoalVerifier } from "../src/core/goal-verification.ts";

const tempDirs: string[] = [];

function makeGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-p0-recovery-"));
	tempDirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	writeFileSync(join(dir, "app.ts"), "export const v = 1;\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

const noSandbox = () => undefined;

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("P0-1: evaluateGoalRestartRecovery & GoalAcceptance.preflightRestartRecovery", () => {
	it("blocks terminal goals as not resumable", () => {
		const goal = {
			...createDurableGoal({ id: "g-term", objective: "done", maxRounds: 2, now: "2026-11-27T00:00:00.000Z" }),
			status: "completed" as const,
		};
		const verdict = evaluateGoalRestartRecovery({
			goal,
			hasActiveApproval: false,
			latestCheckPassed: undefined,
			trustedReceipts: [],
			currentWorkspace: { sha256: "a".repeat(64), completeness: "complete" },
			receiptMatches: () => true,
		});
		expect(verdict).toEqual({
			status: "blocked_not_resumable",
			reasons: ["goal_terminal"],
		});
	});

	it("requires fresh approval and re-verification after a process restart even when journal holds evidence", async () => {
		const root = makeGitRepo();
		const store = new DurableGoalStore(join(root, ".omk", "goals", "g.json"));
		const created = await store.create(
			createDurableGoal({ id: "g-restart", objective: "ship 2.0.5", maxRounds: 3, now: "2026-11-27T00:00:00.000Z" }),
		);

		// Session 1 approves and verifies.
		const session1 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		session1.approve(created, "printf ok");
		const checked = await session1.check(store, created, root);
		expect(checked.result.passed).toBe(true);
		expect(session1.preflightRestartRecovery(checked.goal, root)).toMatchObject({
			status: "ready_to_complete",
			evidenceId: checked.result.receiptId,
		});

		// Session 2 simulates process restart: fresh GoalAcceptance instance with empty in-memory authority.
		const session2 = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		const restartedGoal = (await store.current())!;
		const afterRestart = session2.preflightRestartRecovery(restartedGoal, root);
		expect(afterRestart.status).toBe("needs_reverify");
		if (afterRestart.status === "needs_reverify") {
			expect(afterRestart.requiresFreshApproval).toBe(true);
			expect(afterRestart.reasons).toContain("approval_expired_on_restart");
			expect(afterRestart.reasons).toContain("receipt_untrusted_or_missing");
			expect(afterRestart.freshEvidenceCount).toBe(1);
		}
		// Restart-safe completeVerified must refuse completion until re-approved and re-verified.
		await expect(session2.completeVerified(store, restartedGoal, root)).rejects.toThrow(/reverify|approval/i);
	});

	it("detects post-check workspace drift and refuses completion", async () => {
		const root = makeGitRepo();
		const store = new DurableGoalStore(join(root, ".omk", "goals", "g.json"));
		const created = await store.create(
			createDurableGoal({ id: "g-drift", objective: "keep clean", maxRounds: 3, now: "2026-11-27T00:00:00.000Z" }),
		);
		const acceptance = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		acceptance.approve(created, "printf ok");
		const checked = await acceptance.check(store, created, root);

		// Mutate workspace after passing check.
		writeFileSync(join(root, "app.ts"), "export const v = 2;\n");

		const verdict = acceptance.preflightRestartRecovery(checked.goal, root);
		expect(verdict.status).toBe("needs_reverify");
		if (verdict.status === "needs_reverify") {
			expect(verdict.requiresFreshApproval).toBe(false);
			expect(verdict.reasons).toContain("workspace_drifted");
		}
		await expect(acceptance.completeVerified(store, checked.goal, root)).rejects.toThrow(
			/workspace_drifted|reverify/i,
		);
	});

	it("detects stale generation evidence after goal edit", async () => {
		const root = makeGitRepo();
		const store = new DurableGoalStore(join(root, ".omk", "goals", "g.json"));
		const created = await store.create(
			createDurableGoal({ id: "g-gen", objective: "v1", maxRounds: 3, now: "2026-11-27T00:00:00.000Z" }),
		);
		const acceptance = new GoalAcceptance((opts) => new GoalVerifier({ ...opts, sandboxPreflight: noSandbox }));
		acceptance.approve(created, "printf ok");
		const checked = await acceptance.check(store, created, root);
		const edited = await store.transition(
			{ kind: "edit", ref: checked.goal.ref, objective: "v2 changed scope" },
			nextDurableGoalTimestamp(checked.goal),
		);

		const verdict = acceptance.preflightRestartRecovery(edited, root);
		expect(verdict.status).toBe("needs_reverify");
		if (verdict.status === "needs_reverify") {
			expect(verdict.reasons).toContain("no_fresh_evidence");
			expect(verdict.staleEvidenceCount).toBe(1);
			expect(verdict.freshEvidenceCount).toBe(0);
		}
	});
});
