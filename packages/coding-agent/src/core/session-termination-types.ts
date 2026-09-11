import type { RunBudgetStopCode } from "./run-budget-policy.ts";

export const SESSION_TERMINATION_SCHEMA_VERSION = 1 as const;
export const MAX_SESSION_TERMINATION_MESSAGE_LENGTH = 512;

/** The journal validator derives its accepted kinds from this tuple. */
export const SESSION_TERMINATION_KIND_VALUES = [
	"completed",
	"user_abort",
	"provider_abort",
	"provider_auth",
	"provider_rate_limit",
	"provider_network",
	"provider_protocol",
	"provider_refusal",
	"context_overflow",
	"transcript_invalid",
	"tool_timeout",
	"tool_fatal",
	"compaction",
	"persistence",
	"process_signal",
	"process_crash",
	"configuration",
	"internal_error",
	"resource_pressure",
	"budget_exhausted",
] as const;
export type SessionTerminationKind = (typeof SESSION_TERMINATION_KIND_VALUES)[number];
export type SessionTerminationPhase =
	| "completed"
	| "control"
	| "preflight"
	| "provider"
	| "tool"
	| "compaction"
	| "persistence"
	| "process"
	| "resume";
export type SessionTerminationSource = "observed" | "inferred_on_resume";
export type SessionSideEffects = "none" | "possible" | "confirmed";
export type SessionProcessSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";
export type ProviderTerminationCauseCode =
	| "abort"
	| "auth"
	| "rate_limit"
	| "network"
	| "protocol"
	| "refusal"
	| "context_overflow";
export type ToolTerminationCauseCode = "timeout" | "fatal";
export type ResourceTerminationCauseCode = "memory" | "disk" | "cpu" | "heap" | "probe_unavailable" | "queue_overflow";
export type CompactionTerminationCauseCode = "aborted" | "failed" | "stale" | "quota_exhausted";
export type PersistenceTerminationCauseCode =
	| "read_failed"
	| "append_failed"
	| "replace_failed"
	| "fsync_failed"
	| "lock_failed";
export type TranscriptTerminationCauseCode =
	| "missing_result"
	| "duplicate_result"
	| "orphan_result"
	| "duplicate_call_id"
	| "interleaved_non_result"
	| "invalid_jsonl"
	| "invalid_tree"
	| "unsupported_version"
	| "trailing_fragment";
export type SessionTerminationCauseCode =
	| "session.completed"
	| "session.user_abort"
	| `provider.${ProviderTerminationCauseCode}`
	| `tool.${ToolTerminationCauseCode}`
	| `compaction.${CompactionTerminationCauseCode}`
	| `persistence.${PersistenceTerminationCauseCode}`
	| "process.signal"
	| "process.crash"
	| `transcript.${TranscriptTerminationCauseCode}`
	| "configuration.invalid"
	| "internal.unclassified"
	| `resource.${ResourceTerminationCauseCode}`
	| `budget.${RunBudgetStopCode}`;

export type SessionTerminationCause =
	| { readonly area: "completed" }
	| { readonly area: "user"; readonly code: "abort" }
	| { readonly area: "provider"; readonly code: ProviderTerminationCauseCode }
	| { readonly area: "tool"; readonly code: ToolTerminationCauseCode }
	| { readonly area: "compaction"; readonly code: CompactionTerminationCauseCode }
	| { readonly area: "persistence"; readonly code: PersistenceTerminationCauseCode }
	| { readonly area: "process"; readonly code: "signal"; readonly signal: SessionProcessSignal }
	| { readonly area: "process"; readonly code: "crash" }
	| { readonly area: "transcript"; readonly code: TranscriptTerminationCauseCode }
	| { readonly area: "configuration"; readonly code: "invalid" }
	| { readonly area: "internal"; readonly code: "unclassified" }
	| { readonly area: "resource"; readonly code: ResourceTerminationCauseCode }
	| { readonly area: "budget"; readonly code: RunBudgetStopCode };

export interface ClassifySessionTerminationInput {
	readonly sessionId: string;
	readonly runId: string;
	/** Deterministic caller-provided ISO-8601 timestamp. */
	readonly timestamp: string;
	readonly source: SessionTerminationSource;
	/** Caller-supplied, pre-redacted diagnostic text. */
	readonly message: string;
	readonly cause: SessionTerminationCause;
	readonly sideEffects: SessionSideEffects;
	readonly retryAfterMs?: number;
	readonly provider?: string;
	readonly model?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
}

export interface SessionTermination {
	readonly schemaVersion: typeof SESSION_TERMINATION_SCHEMA_VERSION;
	readonly sessionId: string;
	readonly runId: string;
	readonly kind: SessionTerminationKind;
	readonly phase: SessionTerminationPhase;
	readonly source: SessionTerminationSource;
	readonly message: string;
	readonly causeCode: SessionTerminationCauseCode;
	/** Stable operator guidance suitable for print, JSON, RPC, and TUI surfaces. */
	readonly nextAction: string;
	readonly retryable: boolean;
	readonly safeToAutoRetry: boolean;
	readonly sideEffects: SessionSideEffects;
	readonly timestamp: string;
	readonly retryAfterMs?: number;
	readonly provider?: string;
	readonly model?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly processSignal?: SessionProcessSignal;
	readonly transcriptIssue?: TranscriptTerminationCauseCode;
}
