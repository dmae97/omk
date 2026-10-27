/** Spec 106 D1 / 118 D2: flag parsing and the counts-only report shape (split out for the module-size cap). */
import { isEnvFlagOptOut } from "./env-flag.ts";
export type EvidenceProducer = "goal-recall" | "read-spill" | "bash-spill" | "tool-output-log" | "bash-executor-log";

/** `unknown`: no producer/consumer mapping exists yet, so nothing may be deleted on its behalf (D2 gap). */
/** `user-visible` (spec 118 D3 decision 4): the path was surfaced to the user; never auto-deleted. */
export type EvidenceHoldReason =
	| "goal-active"
	| "awaiting-consumer"
	| "retry"
	| "recovery"
	| "user-visible"
	| "unknown";

/**
 * Spec 118 D3 decision 1: producer -> required consumers (observe only; nothing consumes or deletes yet).
 * A spill / tool-bash log is needed until its tool result is committed and the turn that read it settled.
 * `bash-spill` has no call site in `src` and is deliberately left unmapped (decision 3).
 */
export const SPILL_CONSUMERS = ["tool-result-commit", "turn-settled"] as const;
export const TOOL_OUTPUT_LOG_CONSUMERS = ["tool-result-commit", "turn-settled"] as const;
/** Executor output is pinned `user-visible` instead (decision 4); it waits on no model consumer. */
export const EXECUTOR_LOG_CONSUMERS = [] as const;

export type EvidenceLifecycleMode = "off" | "observe" | "delete";

/**
 * Default `delete` (spec 118 conditional delete-after-use of verified goal-recall files only).
 * Unset, `1` or exactly `delete` select delete; exactly `observe` records only; `0`/`false`/`off` (trimmed,
 * case-insensitive) opt out. Any other value (typo, `Delete`, `true`) is `observe`, never delete.
 * Revert this one function (and its tests) to go back to an `observe` default.
 */
export function evidenceLifecycleMode(env: NodeJS.ProcessEnv = process.env): EvidenceLifecycleMode {
	const value = env.OMK_EVIDENCE_LIFECYCLE;
	if (value === undefined || value === "1" || value === "delete") return "delete";
	if (isEnvFlagOptOut(value)) return "off";
	return "observe";
}

/** `delete` implies everything `observe` does (spec 118 decision 1). */
export function evidenceLifecycleObserveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return evidenceLifecycleMode(env) !== "off";
}

export function evidenceLifecycleDeleteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return evidenceLifecycleMode(env) === "delete";
}

export type EvidenceProducerGroup = "recall" | "spill" | "bash" | "executor";

export interface UnknownHoldShare {
	readonly present: number;
	readonly unknown: number;
	readonly share: number;
}

export interface EvidenceLifecycleReport {
	readonly mode: "observe" | "delete";
	readonly registered: number;
	readonly present: number;
	readonly presentBytes: number;
	/** Spec 118 D3 primary: bytes still present per producer (only computed when the flag is on). */
	readonly presentBytesByProducer: Readonly<Partial<Record<EvidenceProducer, number>>>;
	readonly removedByExistingPolicy: number;
	readonly byProducer: Readonly<Partial<Record<EvidenceProducer, number>>>;
	readonly holdReasons: Readonly<Partial<Record<EvidenceHoldReason, number>>>;
	/** Present artifacts with an `unknown` hold over present artifacts; 0 when none are present. */
	readonly unknownHoldShare: number;
	readonly unknownHoldShareByProducer: Readonly<Record<EvidenceProducerGroup, UnknownHoldShare>>;
	/** Present artifacts whose goal was blocked with rounds exhausted (still held; counted separately). */
	readonly blockedExhausted: number;
	readonly wouldDelete: { readonly count: number; readonly bytes: number; readonly artifactIds: readonly string[] };
	/** Always 0 in observe mode; kept in the report so a trace proves it. */
	readonly deletes: number;
	/** Spec 118 D2, `delete` mode only: pending deletes by reason and bytes kept only because of a hold. */
	readonly deletion?: {
		readonly pending: number;
		readonly pendingReasons: Readonly<Record<string, number>>;
		readonly heldBytes: number;
		readonly heldCount: number;
		readonly heldReasons: Readonly<Record<string, number>>;
	};
	/** Registrations dropped once this session's registry hit its bound (counts only). */
	readonly overflow: number;
	/** Artifacts registered with no session context (explicit bucket, not part of this report's counts). */
	readonly unattributed: number;
	/** Artifacts registered in this process across every session bucket and `unattributed` (ratio denominator). */
	readonly processRegistered: number;
}
