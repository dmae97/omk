/** Public run-budget, journal, and termination contracts. */

export type { RunBudgetSnapshot } from "./run-budget.ts";
export { RunBudgetExceededError, type RunBudgetLimits, RunBudgetPolicyError } from "./run-budget-policy.ts";
export {
	appendRunJournalRecordDurably,
	type OpenRunJournalStoreOptions,
	type RunJournalQuarantineReport,
	RunJournalStore,
	RunJournalStoreCorruptionError,
	writeQuarantineBytesDurably,
} from "./run-journal-store.ts";
export {
	classifySessionTermination,
	formatSessionTermination,
	type SessionTermination,
	type SessionTerminationCause,
	SessionTerminationError,
	type SessionTerminationKind,
} from "./session-termination.ts";
export {
	planVerifiedRun,
	RunCoordinator,
	type VerifiedRunApproval,
	type VerifiedRunPlan,
} from "./verified-run/coordinator.ts";
export type { RunProjection } from "./verified-run/events.ts";
export type { VerifiedRunEvidence } from "./verified-run/evidence.ts";
export type { RecoveryInspection } from "./verified-run/recovery.ts";
export type { RecoveryBudget } from "./verified-run/recovery-clock.ts";
export { VerifiedRunError } from "./verified-run/storage.ts";
export type { WriterRecoveryInspection } from "./verified-run/writer-recovery.ts";
