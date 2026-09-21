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
export type {
	AuthorityEvent,
	AuthorityGrantRecord,
	AuthorityProjection,
	AuthoritySnapshotState,
} from "./verified-run/authority-events.ts";
export {
	type AuthorityAcquireInput,
	type AuthorityAcquireResult,
	type AuthorityJournalInspection,
	AuthorityLeaseHeldError,
	type AuthorityLookup,
	type AuthorityProbe,
	type AuthorityRecord,
	AuthorityStore,
	AuthorityStoreError,
	authorityStorePath,
	type OpenAuthorityStoreOptions,
} from "./verified-run/authority-store.ts";
export {
	type AuthorityStoreView,
	planVerifiedRun,
	RunCoordinator,
	type VerifiedRunApproval,
	type VerifiedRunPlan,
} from "./verified-run/coordinator.ts";
export type { TaskRecoveryInspection } from "./verified-run/dag-recovery.ts";
export type { RunTaskCheckpoint, RunTaskExecution, RunTaskProjection } from "./verified-run/dag-types.ts";
export type { RunProjection } from "./verified-run/events.ts";
export type { VerifiedRunEvidence } from "./verified-run/evidence.ts";
export type { RunJournalRecord } from "./verified-run/journal.ts";
export type { RecoveryInspection } from "./verified-run/recovery.ts";
export type { RecoveryBudget } from "./verified-run/recovery-clock.ts";
export { OMK_ACCEPTED_REF, type PublishOptions, publishPolicyDigest } from "./verified-run/run-publish.ts";
export {
	type AuthorityGrantCause,
	type AuthorityGrantStatus,
	type AuthorityStatus,
	deriveAuthorityStatus,
	deriveRunStatus,
	type RunCompletion,
	type RunLifecycle,
	type RunRecoveryCommand,
	type RunStatus,
	type RunUnresolved,
} from "./verified-run/run-status.ts";
export type { RunRecoveryMarker } from "./verified-run/run-types.ts";
export { VerifiedRunError } from "./verified-run/storage.ts";
export type { WriterRecoveryInspection } from "./verified-run/writer-recovery.ts";
