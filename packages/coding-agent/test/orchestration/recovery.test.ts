import { describe, expect, it } from "vitest";
import {
	type CompensationPlan,
	type CompensatorStep,
	classifyRecoveryAction,
	isStateChangingStage,
	type LedgerAuditStage,
	type PreparedOperationReceipt,
	planCompensation,
	type RecoveryAction,
	shouldAbortForLedgerFailure,
} from "../../src/core/orchestration/recovery.ts";

function receipt(overrides: Partial<PreparedOperationReceipt> = {}): PreparedOperationReceipt {
	return {
		operationId: "op-1",
		lastStatus: null,
		prepared: false,
		started: false,
		completed: false,
		compensatorFailure: false,
		preparedStateHash: null,
		requiredReceipts: [],
		presentReceipts: [],
		leaseExpired: false,
		...overrides,
	};
}

function step(overrides: Partial<CompensatorStep> = {}): CompensatorStep {
	return {
		id: "c-0",
		kind: "file_restore",
		sequence: 0,
		idempotent: true,
		applied: false,
		preparedStateHash: "hash-0",
		...overrides,
	};
}

describe("classifyRecoveryAction - crash points map to correct action", () => {
	it("ignores an operation that reached the completed marker", () => {
		// completed marker dominates every other signal (T6 success path)
		const r = receipt({
			completed: true,
			prepared: true,
			started: true,
			preparedStateHash: "h",
			lastStatus: "completed",
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("ignore");
	});

	it("resumes when nothing durable was recorded and the lease is live (T1: crash after lease acquire)", () => {
		const r = receipt({ lastStatus: "leased", leaseExpired: false });
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("resume");
	});

	it("rolls back an expired lease that recorded no receipts (T1: stale lease, nothing durable)", () => {
		const r = receipt({ lastStatus: "leased", leaseExpired: true, presentReceipts: [] });
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("rollback");
	});

	it("rolls back when prepared marker exists but execution never started (T2: crash after prepared ledger)", () => {
		const r = receipt({
			lastStatus: "prepared",
			prepared: true,
			started: false,
			preparedStateHash: "h",
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("rollback");
	});

	it("resumes when prepared+started with all required receipts present (T4: crash after receipt)", () => {
		const r = receipt({
			lastStatus: "applying",
			prepared: true,
			started: true,
			preparedStateHash: "h",
			requiredReceipts: ["receipt-a", "receipt-b"],
			presentReceipts: ["receipt-a", "receipt-b"],
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("resume");
	});

	it("resumes when no receipts are required and prepared+started (verifying crash, deterministic re-verify)", () => {
		const r = receipt({
			lastStatus: "verifying",
			prepared: true,
			started: true,
			preparedStateHash: "h",
			requiredReceipts: [],
			presentReceipts: [],
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("resume");
	});

	it("returns in_doubt when started with partial receipts and a live lease (ambiguous apply)", () => {
		const r = receipt({
			lastStatus: "applying",
			prepared: true,
			started: true,
			preparedStateHash: "h",
			requiredReceipts: ["receipt-a", "receipt-b"],
			presentReceipts: ["receipt-a"],
			leaseExpired: false,
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("in_doubt");
	});

	it("rolls back started execution when lease expired with no receipts recorded", () => {
		const r = receipt({
			lastStatus: "started",
			prepared: true,
			started: true,
			preparedStateHash: "h",
			requiredReceipts: ["receipt-a"],
			presentReceipts: [],
			leaseExpired: true,
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("rollback");
	});

	it("returns in_doubt when a compensator failure marker is present (T7)", () => {
		const r = receipt({ compensatorFailure: true, lastStatus: "in_doubt" });
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("in_doubt");
	});

	it("returns in_doubt when prepared state hash is missing despite a prepared marker", () => {
		const r = receipt({
			lastStatus: "prepared",
			prepared: true,
			started: false,
			preparedStateHash: null,
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("in_doubt");
	});

	it("treats compensator failure as in_doubt even if completed marker is absent but prepared", () => {
		const r = receipt({
			compensatorFailure: true,
			prepared: true,
			started: true,
			preparedStateHash: "h",
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("in_doubt");
	});

	it("resumes when not prepared, not expired, even if a stray receipt exists", () => {
		const r = receipt({
			lastStatus: null,
			prepared: false,
			presentReceipts: ["orphan"],
			leaseExpired: false,
		});
		expect(classifyRecoveryAction(r)).toBe<RecoveryAction>("resume");
	});
});

describe("planCompensation", () => {
	it("returns idempotent steps in reverse registration order", () => {
		const plan = planCompensation([
			step({ id: "c-1", sequence: 1 }),
			step({ id: "c-2", sequence: 2 }),
			step({ id: "c-3", sequence: 3 }),
		]);

		expect(plan.action).toBe<CompensationPlan["action"]>("rollback");
		expect(plan.steps.map((s) => s.id)).toEqual(["c-3", "c-2", "c-1"]);
		expect(plan.reason).toBeTruthy();
	});

	it("creates an in_doubt plan when a non-idempotent step was already applied", () => {
		const plan = planCompensation([
			step({ id: "c-1", sequence: 1, idempotent: true, applied: true }),
			step({ id: "c-2", sequence: 2, idempotent: false, applied: true }),
			step({ id: "c-3", sequence: 3, idempotent: true, applied: false }),
		]);

		expect(plan.action).toBe<CompensationPlan["action"]>("in_doubt");
		expect(plan.steps).toEqual([]);
		expect(plan.reason).toContain("c-2");
	});

	it("drops non-idempotent steps that were never applied and keeps idempotent ones reversed", () => {
		const plan = planCompensation([
			step({ id: "c-1", sequence: 1, idempotent: true }),
			step({ id: "c-2", sequence: 2, idempotent: false, applied: false }),
			step({ id: "c-3", sequence: 3, idempotent: true }),
		]);

		expect(plan.action).toBe<CompensationPlan["action"]>("rollback");
		expect(plan.steps.map((s) => s.id)).toEqual(["c-3", "c-1"]);
	});

	it("handles an empty step list as a no-op rollback plan", () => {
		const plan = planCompensation([]);
		expect(plan.action).toBe<CompensationPlan["action"]>("rollback");
		expect(plan.steps).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [step({ id: "c-1", sequence: 1 }), step({ id: "c-2", sequence: 2 })];
		const snapshot = input.map((s) => s.id);
		planCompensation(input);
		expect(input.map((s) => s.id)).toEqual(snapshot);
	});
});

describe("shouldAbortForLedgerFailure - fail-closed audit", () => {
	it("aborts state-changing prepare stage when ledger append failed", () => {
		expect(shouldAbortForLedgerFailure("prepare", false)).toBe(true);
	});

	it("aborts state-changing apply stage when ledger append failed", () => {
		expect(shouldAbortForLedgerFailure("apply", false)).toBe(true);
	});

	it("aborts state-changing verify stage when ledger append failed", () => {
		expect(shouldAbortForLedgerFailure("verify", false)).toBe(true);
	});

	it("does not abort read-only stages when ledger append failed", () => {
		expect(shouldAbortForLedgerFailure("read-only", false)).toBe(false);
	});

	it("does not abort any stage when ledger append succeeded", () => {
		const stages: LedgerAuditStage[] = ["prepare", "apply", "verify", "read-only"];
		for (const stage of stages) {
			expect(shouldAbortForLedgerFailure(stage, true)).toBe(false);
		}
	});

	it("classifies prepare/apply/verify as state-changing and read-only as not", () => {
		expect(isStateChangingStage("prepare")).toBe(true);
		expect(isStateChangingStage("apply")).toBe(true);
		expect(isStateChangingStage("verify")).toBe(true);
		expect(isStateChangingStage("read-only")).toBe(false);
	});
});
