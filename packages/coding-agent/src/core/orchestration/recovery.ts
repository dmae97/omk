/**
 * Pure recovery + compensation algorithms for the durable orchestration layer.
 *
 * These functions classify the state of a partially-executed durable operation
 * (reconstructed from the ledger + scheduler store), plan idempotent
 * compensator execution in reverse order, and enforce fail-closed audit
 * semantics when the durable ledger cannot accept an event.
 *
 * Design principle: fail-closed. When the recorded state is ambiguous we
 * prefer "in_doubt" (human intervention) over an unsafe resume or rollback.
 *
 * Reference: .omk/runs/omk-orchestration-upgrade-plan/transaction-recovery.md
 */

export type DurableStepStatus =
	| "leased"
	| "prepared"
	| "started"
	| "applying"
	| "verifying"
	| "completed"
	| "rolled_back"
	| "in_doubt"
	| "failed"
	| "blocked";

export type RecoveryAction = "resume" | "rollback" | "in_doubt" | "ignore";

/**
 * Snapshot of what was durably recorded for a single operation, reconstructed
 * by replaying the harness-control ledger and reconciling with the scheduler
 * node/lease/attempt tables. The classifier is pure logic over this struct.
 */
export interface PreparedOperationReceipt {
	operationId: string;
	/** Last durable step status observed in the ledger, or null if none. Informational. */
	lastStatus: DurableStepStatus | null;
	/** A "prepared" marker was durably recorded (S2). */
	prepared: boolean;
	/** A "started" marker was durably recorded (S3). */
	started: boolean;
	/** A terminal "completed" marker was durably recorded (S7). */
	completed: boolean;
	/** A compensator failure marker was recorded (compensation attempted and failed). */
	compensatorFailure: boolean;
	/** sha256 of the prepared state; required to resume or roll back deterministically. */
	preparedStateHash: string | null;
	/** Receipt ids the operation declares as required to resume safely. */
	requiredReceipts: readonly string[];
	/** Receipt ids actually present in the ledger (S5 step receipts). */
	presentReceipts: readonly string[];
	/** True when the lease expiration time is in the past at recovery time. */
	leaseExpired: boolean;
}

/**
 * A single registered compensator and its execution status, as resolved from
 * the compensators table at recovery time.
 */
export interface CompensatorStep {
	id: string;
	kind: string;
	/** Forward execution sequence; higher means executed later. */
	sequence: number;
	/** Whether re-running the compensator is side-effect safe. */
	idempotent: boolean;
	/** Whether the forward step's side effect was already applied. */
	applied: boolean;
	/** sha256 of the prepared state the compensator restores from. */
	preparedStateHash: string | null;
}

export interface CompensationPlan {
	/** "rollback" runs the listed steps; "in_doubt" runs nothing and escalates. */
	action: "rollback" | "in_doubt";
	/** Idempotent steps in reverse execution order. Empty for in_doubt plans. */
	steps: CompensatorStep[];
	/** Human/machine-readable reason for the chosen action. */
	reason: string;
}

/**
 * Coarse stage classification for fail-closed audit. State-changing stages
 * mutate durable node/lease/attempt/artifact state; read-only stages only
 * observe.
 */
export type LedgerAuditStage = "prepare" | "apply" | "verify" | "read-only";

const STATE_CHANGING_STAGES: ReadonlySet<LedgerAuditStage> = new Set<LedgerAuditStage>(["prepare", "apply", "verify"]);

export function isStateChangingStage(stage: LedgerAuditStage): boolean {
	return STATE_CHANGING_STAGES.has(stage);
}

/**
 * Fail-closed audit gate. A state-changing stage MUST abort (and propagate the
 * ledger error, rolling back any in-flight SQLite transaction) when the durable
 * ledger could not accept its event. Read-only stages tolerate a ledger
 * failure because their event is pure observability.
 */
export function shouldAbortForLedgerFailure(stage: LedgerAuditStage, ledgerAppendOk: boolean): boolean {
	if (ledgerAppendOk) {
		return false;
	}
	return isStateChangingStage(stage);
}

function allRequiredReceiptsPresent(receipt: PreparedOperationReceipt): boolean {
	if (receipt.requiredReceipts.length === 0) {
		return true;
	}
	const present = new Set(receipt.presentReceipts);
	for (const id of receipt.requiredReceipts) {
		if (!present.has(id)) {
			return false;
		}
	}
	return true;
}

function hasAnyReceipt(receipt: PreparedOperationReceipt): boolean {
	return receipt.presentReceipts.length > 0;
}

/**
 * Classify the recovery action for a partially-executed durable operation.
 *
 * Precedence (fail-closed overrides first):
 *  1. completed marker present        -> ignore   (definitive terminal success)
 *  2. compensator failure marker      -> in_doubt (state is untrustworthy)
 *  3. prepared but no preparedStateHash -> in_doubt (cannot verify state to resume/rollback)
 *  4. prepared + started + all required receipts -> resume (deterministic replay)
 *  5. prepared + not started          -> rollback (undo the prepared state)
 *  6. expired lease + no receipts     -> rollback (stale lease, nothing durable recorded)
 *  7. prepared + started, partial receipts, live lease -> in_doubt (ambiguous apply)
 *  8. otherwise (nothing durable, live lease) -> resume (clean re-dispatch)
 */
export function classifyRecoveryAction(receipt: PreparedOperationReceipt): RecoveryAction {
	if (receipt.completed) {
		return "ignore";
	}
	if (receipt.compensatorFailure) {
		return "in_doubt";
	}
	if (receipt.prepared && receipt.preparedStateHash === null) {
		return "in_doubt";
	}
	if (receipt.prepared && receipt.started && allRequiredReceiptsPresent(receipt)) {
		return "resume";
	}
	if (receipt.prepared && !receipt.started) {
		return "rollback";
	}
	if (receipt.leaseExpired && !hasAnyReceipt(receipt)) {
		return "rollback";
	}
	if (receipt.prepared && receipt.started) {
		return "in_doubt";
	}
	return "resume";
}

/**
 * Build a compensation plan from registered compensator steps.
 *
 * - If any NON-idempotent step was already applied, its side effect may or may
 *   not have completed, so we cannot safely compensate: return an in_doubt
 *   plan with no executable steps (escalate instead of auto-compensating).
 * - Otherwise, return only the idempotent steps in reverse execution order.
 *   Non-idempotent steps that were never applied are dropped.
 *
 * The input array is never mutated.
 */
export function planCompensation(steps: readonly CompensatorStep[]): CompensationPlan {
	for (const s of steps) {
		if (!s.idempotent && s.applied) {
			return {
				action: "in_doubt",
				steps: [],
				reason: `non-idempotent step "${s.id}" was already applied; state is ambiguous`,
			};
		}
	}

	const reversed = steps.filter((s) => s.idempotent).sort((a, b) => b.sequence - a.sequence);

	return {
		action: "rollback",
		steps: reversed,
		reason: "compensate idempotent steps in reverse execution order",
	};
}
