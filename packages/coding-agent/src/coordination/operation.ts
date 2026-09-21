/**
 * Authorized operation lifecycle for GUI-driving adapters (Jev audit A6).
 *
 * Two reproduced defects shape this module:
 *   F01 — an adapter re-interpreted a free-text instruction at execution time,
 *         so an approved candidate and the executed action could differ. Here
 *         dispatch consumes a recorded observation binding, never a sentence.
 *   F02 — a cancellation signal was accepted and then ignored across the
 *         approval await, so a cancelled operation still dispatched. Here the
 *         permit is re-evaluated at the dispatch boundary, and cancellation
 *         after dispatch can never be reported as cancelled-before-dispatch.
 *
 * Pure state machine: no browser, no driver, no timers. "Dispatched" means the
 * command left this process, which is not evidence about the remote effect —
 * that is why `outcome-unknown` is a first-class state rather than a failure.
 */

import type { Sequence } from "./types.ts";
import { sequence } from "./types.ts";

export type OperationState =
	| "created"
	| "observed"
	| "proposed"
	| "authorized"
	| "dispatched"
	| "applied"
	| "verified"
	| "inspection-required"
	| "failed-confirmed"
	| "outcome-unknown"
	| "cancelled-before-dispatch";

/** Outcomes a driver may report once a command has left the process. */
export type SettledOutcome = "applied" | "failed-confirmed" | "outcome-unknown";

const TERMINAL_STATES: ReadonlySet<OperationState> = new Set<OperationState>([
	"verified",
	"inspection-required",
	"failed-confirmed",
	"cancelled-before-dispatch",
]);

/**
 * Host-held reference to one observed candidate.
 *
 * The adapter receives these identifiers, not an instruction string, so the
 * action that was approved is the action that runs.
 */
export interface ObservationBinding {
	readonly observationId: string;
	readonly actionId: string;
	readonly targetId: string;
	/** Document/DOM generation the candidate was observed against. */
	readonly documentGeneration: Sequence;
}

export type PermitDenial =
	| "cancelled"
	| "policy-denied"
	| "approval-mismatch"
	| "stale-lease"
	| "observation-invalid"
	| "budget-exhausted";

export type PermitDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: PermitDenial };

export interface PermitInput {
	readonly policyAllowed: boolean;
	/** Digest of the intent actually about to run. */
	readonly intentDigest: string;
	/** Digest the operator approved; a post-approval edit breaks this equality. */
	readonly approvalDigest: string;
	readonly policyVersion: string;
	readonly approvalPolicyVersion: string;
	readonly leaseGeneration: Sequence;
	readonly currentLeaseGeneration: Sequence;
	readonly observationValid: boolean;
	readonly cancelled: boolean;
	readonly budgetAvailable: boolean;
}

/**
 * Permit(I) = PolicyAllowed ∧ ApprovalMatches ∧ LeaseCurrent ∧ ObservationValid
 *             ∧ ¬Cancelled ∧ BudgetAvailable.
 *
 * Cancellation is reported first: when a run is cancelled, saying "budget
 * exhausted" would send the operator looking for the wrong problem.
 */
export function evaluatePermit(input: PermitInput): PermitDecision {
	for (const value of [input.cancelled, input.policyAllowed, input.observationValid, input.budgetAvailable]) {
		if (typeof value !== "boolean") throw new TypeError("permit flags must be booleans");
	}
	for (const value of [input.intentDigest, input.approvalDigest, input.policyVersion, input.approvalPolicyVersion]) {
		if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
			throw new TypeError("permit binding must be a bounded non-empty string");
		}
	}
	sequence(input.leaseGeneration);
	sequence(input.currentLeaseGeneration);
	if (input.cancelled) return { allowed: false, reason: "cancelled" };
	if (!input.policyAllowed) return { allowed: false, reason: "policy-denied" };
	if (input.approvalDigest !== input.intentDigest || input.approvalPolicyVersion !== input.policyVersion) {
		return { allowed: false, reason: "approval-mismatch" };
	}
	if (input.leaseGeneration !== input.currentLeaseGeneration) return { allowed: false, reason: "stale-lease" };
	if (!input.observationValid) return { allowed: false, reason: "observation-invalid" };
	if (!input.budgetAvailable) return { allowed: false, reason: "budget-exhausted" };
	return { allowed: true };
}

export class OperationLifecycle {
	readonly operationId: string;
	private current: OperationState = "created";
	private readonly states: OperationState[] = ["created"];
	private observations: readonly ObservationBinding[] = [];
	private selected: ObservationBinding | undefined;
	private authorizedPermit: Readonly<PermitInput> | undefined;
	private hasDispatched = false;
	private cancelRequested = false;

	constructor(operationId: string) {
		if (typeof operationId !== "string" || operationId.length === 0) {
			throw new TypeError("operationId must be a non-empty string");
		}
		this.operationId = operationId;
	}

	get state(): OperationState {
		return this.current;
	}

	get history(): readonly OperationState[] {
		return [...this.states];
	}

	/** True once a command left this process; it says nothing about the effect. */
	get dispatched(): boolean {
		return this.hasDispatched;
	}

	get cancellationRequested(): boolean {
		return this.cancelRequested;
	}

	private enter(next: OperationState): void {
		this.current = next;
		this.states.push(next);
	}

	private assertOpen(): void {
		if (TERMINAL_STATES.has(this.current)) {
			throw new Error(`operation ${this.operationId} is terminal in state ${this.current}`);
		}
	}

	/** Record the host-held candidate set. Without this, nothing can dispatch. */
	observe(candidates: readonly ObservationBinding[]): void {
		this.assertOpen();
		if (candidates.length === 0) throw new TypeError("observation must yield at least one candidate");
		if (this.current !== "created" && this.current !== "observed") {
			throw new Error("observe requires a created or observed operation");
		}
		const snapshots = candidates.map((candidate) => {
			for (const value of [candidate.observationId, candidate.actionId, candidate.targetId]) {
				if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
					throw new TypeError("observation binding must be a bounded non-empty string");
				}
			}
			return Object.freeze({
				observationId: candidate.observationId,
				actionId: candidate.actionId,
				targetId: candidate.targetId,
				documentGeneration: sequence(candidate.documentGeneration),
			});
		});
		this.observations = Object.freeze(snapshots);
		this.enter("observed");
	}

	/** Select one observed candidate. Free-text re-interpretation has no path here. */
	propose(candidate: ObservationBinding): void {
		this.assertOpen();
		if (this.observations.length === 0) {
			throw new Error("cannot propose before observe: the candidate set is unbound");
		}
		if (this.current !== "observed" && this.current !== "proposed") {
			throw new Error("propose requires an observed or proposed operation");
		}
		const match = this.observations.find(
			(o) =>
				o.observationId === candidate.observationId &&
				o.actionId === candidate.actionId &&
				o.targetId === candidate.targetId &&
				o.documentGeneration === candidate.documentGeneration,
		);
		if (match === undefined) throw new Error("proposed action is not among the recorded observations");
		this.selected = match;
		this.enter("proposed");
	}

	authorize(permit: PermitInput): PermitDecision {
		this.assertOpen();
		if (this.current !== "proposed") throw new Error("authorize requires a proposed operation");
		const decision = evaluatePermit(permit);
		if (!decision.allowed) {
			this.applyPreDispatchDenial(decision.reason);
			return decision;
		}
		this.authorizedPermit = Object.freeze({ ...permit });
		this.enter("authorized");
		return decision;
	}

	/**
	 * Re-evaluate the permit and hand the command to the driver.
	 *
	 * The second evaluation is the point of the audit finding: approval and
	 * dispatch are separated by awaits (queueing, the operator prompt, browser
	 * startup), and state observed before those awaits is not state now.
	 */
	dispatch(permit: PermitInput): PermitDecision {
		this.assertOpen();
		if (this.current !== "authorized") throw new Error("dispatch requires an authorized operation");
		if (this.selected === undefined) throw new Error("dispatch requires a bound observation");
		const decision = evaluatePermit(permit);
		if (!decision.allowed) {
			this.applyPreDispatchDenial(decision.reason);
			return decision;
		}
		const approved = this.authorizedPermit;
		if (
			approved === undefined ||
			approved.intentDigest !== permit.intentDigest ||
			approved.approvalDigest !== permit.approvalDigest ||
			approved.policyVersion !== permit.policyVersion ||
			approved.approvalPolicyVersion !== permit.approvalPolicyVersion
		) {
			return { allowed: false, reason: "approval-mismatch" };
		}
		if (approved.leaseGeneration !== permit.leaseGeneration) {
			return { allowed: false, reason: "stale-lease" };
		}
		this.hasDispatched = true;
		this.enter("dispatched");
		return decision;
	}

	private applyPreDispatchDenial(reason: PermitDenial): void {
		if (reason === "cancelled") {
			this.cancelRequested = true;
			this.enter("cancelled-before-dispatch");
		}
	}

	/** Driver-reported outcome. Only valid once the command actually left. */
	settle(outcome: SettledOutcome): void {
		if (!this.hasDispatched) throw new Error("settle requires a dispatched operation");
		if (outcome !== "applied" && outcome !== "failed-confirmed" && outcome !== "outcome-unknown") {
			throw new TypeError("invalid settled outcome");
		}
		// Exact duplicate reports are idempotent. A final result cannot be revised.
		if (this.current === outcome) return;
		if (this.current !== "dispatched" && this.current !== "outcome-unknown") {
			throw new Error("settle requires an unresolved dispatched outcome");
		}
		this.enter(outcome);
	}

	/** Explicit postcondition check. A driver's return value is not this. */
	verify(postconditionMet: boolean): void {
		if (typeof postconditionMet !== "boolean") throw new TypeError("postcondition must be a boolean");
		if (this.current !== "applied") throw new Error("verify requires an applied outcome");
		this.enter(postconditionMet ? "verified" : "inspection-required");
	}

	/**
	 * Request cancellation.
	 *
	 * Before dispatch this is terminal. After dispatch it only records the
	 * request: the command is already outside this process, so the real outcome
	 * has to be settled separately and stays `outcome-unknown` until it is.
	 */
	cancel(): void {
		this.cancelRequested = true;
		if (TERMINAL_STATES.has(this.current)) return;
		if (!this.hasDispatched) {
			this.enter("cancelled-before-dispatch");
			return;
		}
		if (this.current === "dispatched") this.enter("outcome-unknown");
	}
}
