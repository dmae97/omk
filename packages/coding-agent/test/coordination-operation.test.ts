/**
 * Authorized operation lifecycle — Jev audit F01/F02 and algorithm A6.
 *
 * Two audit reproductions drive this:
 *   R07 — an approved action reached `act()` without any observation ever
 *         being taken, so "observe first" was documentation, not a precondition.
 *   R08 — cancellation raised while the approval prompt was pending still let
 *         the adapter dispatch, because the signal was accepted and ignored.
 *
 * The lifecycle makes both structurally impossible: dispatch requires a bound
 * observation and a permit re-evaluated at the dispatch boundary, and a cancel
 * after dispatch can never be reported as cancelled-before-dispatch.
 */

import { describe, expect, it } from "vitest";
import {
	evaluatePermit,
	type ObservationBinding,
	OperationLifecycle,
	type PermitInput,
	sequence,
} from "../src/coordination/index.ts";

function binding(overrides: Partial<ObservationBinding> = {}): ObservationBinding {
	return {
		observationId: "obs-1",
		actionId: "act-1",
		targetId: "tab-1",
		documentGeneration: sequence("7"),
		...overrides,
	};
}

function permitInput(overrides: Partial<PermitInput> = {}): PermitInput {
	return {
		policyAllowed: true,
		intentDigest: "intent-a",
		approvalDigest: "intent-a",
		policyVersion: "policy-1",
		approvalPolicyVersion: "policy-1",
		leaseGeneration: sequence("3"),
		currentLeaseGeneration: sequence("3"),
		observationValid: true,
		cancelled: false,
		budgetAvailable: true,
		...overrides,
	};
}

describe("permit evaluation", () => {
	it("allows a fully bound intent", () => {
		expect(evaluatePermit(permitInput())).toEqual({ allowed: true });
	});

	it("denies each missing conjunct with its own reason", () => {
		const cases: Array<[Partial<PermitInput>, string]> = [
			[{ policyAllowed: false }, "policy-denied"],
			[{ approvalDigest: "intent-b" }, "approval-mismatch"],
			[{ approvalPolicyVersion: "policy-0" }, "approval-mismatch"],
			[{ currentLeaseGeneration: sequence("4") }, "stale-lease"],
			[{ observationValid: false }, "observation-invalid"],
			[{ cancelled: true }, "cancelled"],
			[{ budgetAvailable: false }, "budget-exhausted"],
		];
		for (const [patch, reason] of cases) {
			expect(evaluatePermit(permitInput(patch)), reason).toEqual({ allowed: false, reason });
		}
	});

	it("reports cancellation ahead of other denials so the log is not misleading", () => {
		const decision = evaluatePermit(permitInput({ cancelled: true, budgetAvailable: false }));
		expect(decision).toEqual({ allowed: false, reason: "cancelled" });
	});
});

describe("operation lifecycle", () => {
	it("refuses to dispatch an action that was never observed (F01 / R07)", () => {
		const op = new OperationLifecycle("op-1");
		expect(op.state).toBe("created");
		expect(() => op.propose(binding())).toThrow(/observe/i);
		expect(op.state).toBe("created");
	});

	it("walks the authorized path to a verified outcome", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		expect(op.state).toBe("observed");
		op.propose(binding());
		expect(op.state).toBe("proposed");
		expect(op.authorize(permitInput())).toEqual({ allowed: true });
		expect(op.state).toBe("authorized");
		expect(op.dispatch(permitInput())).toEqual({ allowed: true });
		expect(op.state).toBe("dispatched");
		op.settle("applied");
		expect(op.state).toBe("applied");
		op.verify(true);
		expect(op.state).toBe("verified");
	});

	it("rejects a proposal for an action that was not among the observations", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding({ actionId: "act-1" })]);
		expect(() => op.propose(binding({ actionId: "act-2" }))).toThrow(/not among/i);
	});

	it("re-checks the permit at dispatch, not only at approval (F02 / R08)", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		expect(op.authorize(permitInput())).toEqual({ allowed: true });

		// Cancellation lands while the approval prompt was pending.
		const decision = op.dispatch(permitInput({ cancelled: true }));
		expect(decision).toEqual({ allowed: false, reason: "cancelled" });
		expect(op.state).toBe("cancelled-before-dispatch");
		expect(op.dispatched).toBe(false);
	});

	it("rejects a dispatch whose document generation moved under it", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		expect(op.dispatch(permitInput({ observationValid: false }))).toEqual({
			allowed: false,
			reason: "observation-invalid",
		});
	});

	it("never reports a post-dispatch cancel as cancelled-before-dispatch", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		op.dispatch(permitInput());
		op.cancel();
		expect(op.state).toBe("outcome-unknown");
		expect(op.cancellationRequested).toBe(true);
		expect(op.dispatched).toBe(true);
	});

	it("keeps an unknown outcome unknown until a recheck settles it", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		op.dispatch(permitInput());
		op.settle("outcome-unknown");
		expect(op.state).toBe("outcome-unknown");
		op.settle("outcome-unknown");
		expect(op.state).toBe("outcome-unknown");
		op.settle("failed-confirmed");
		expect(op.state).toBe("failed-confirmed");
	});

	it("routes an unmet postcondition to inspection rather than success", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		op.dispatch(permitInput());
		op.settle("applied");
		op.verify(false);
		expect(op.state).toBe("inspection-required");
	});

	it("cancels cleanly before dispatch and stays terminal", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.cancel();
		expect(op.state).toBe("cancelled-before-dispatch");
		expect(() => op.propose(binding())).toThrow(/terminal|cancelled/i);
	});

	it("refuses to dispatch without a prior authorization", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		expect(() => op.dispatch(permitInput())).toThrow(/authorized/i);
	});

	it("refuses to settle an operation that never dispatched", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		expect(() => op.settle("applied")).toThrow(/dispatch/i);
	});

	it("refuses to verify an outcome that was not applied", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		op.dispatch(permitInput());
		op.settle("failed-confirmed");
		expect(() => op.verify(true)).toThrow(/applied/i);
	});

	it("exposes an ordered transition history for audit", () => {
		const op = new OperationLifecycle("op-1");
		op.observe([binding()]);
		op.propose(binding());
		op.authorize(permitInput());
		op.dispatch(permitInput());
		op.settle("applied");
		op.verify(true);
		expect(op.history).toEqual([
			"created",
			"observed",
			"proposed",
			"authorized",
			"dispatched",
			"applied",
			"verified",
		]);
	});
});
