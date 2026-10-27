/**
 * Spec 096 (P0-B): one fact-based, read-only task-result projection shared by
 * TUI, print and RPC.
 *
 * This is a pure projection of facts that already exist (prompt settlement,
 * goal acceptance receipts, finish-check skips and ledger lines). It is not a
 * second canonical task state: nothing here is persisted, and the same inputs
 * always give the same projection.
 *
 * Two orthogonal axes (doc §5.1):
 * - execution: how the prompt run settled (`prompt_settled.outcome`).
 * - check: what host-recorded checks observed.
 *
 * Only a host-recorded receipt can make the check `passed`. Anything the model
 * wrote ("passed", "REQ 1: PASS", a pasted digest) is kept as a `model_text`
 * claim and never counts as a host pass (B2, B6, B10).
 *
 * Behind `OMK_TASK_RESULT` (default off). With the flag off no `task_result`
 * event exists and every surface is unchanged.
 */
import type { FinishCheckSkipReason } from "./finish-check.ts";
import type { FinishCheckLedgerItem } from "./finish-check-requirements.ts";
import type { GoalAcceptanceResult } from "./goal-verification.ts";
import type { PromptSettledEvent, PromptSettlementOutcome } from "./prompt-settlement.ts";
import type { CheckKind } from "./test-counts.ts";

/** v2 (spec 100): check identity, attempts, test counts, unknown coverage and the downgrade event. */
export const TASK_RESULT_VERSION = 2 as const;

/** Check-observation axis (spec 096 change 2). */
export type TaskCheckObservation =
	| "none"
	| "passed"
	| "required_failed"
	| "insufficient"
	| "cancel_pending"
	| "cancelled";

/** Who recorded a fact. Only `host_receipt` can reach `passed`. */
export type TaskResultSource = "host_receipt" | "model_text";

export type TaskCheckFactStatus = "passed" | "failed" | "insufficient" | "cancel_pending" | "cancelled";

/** Why a fact is `insufficient` rather than a pass or a failure. */
export type TaskCheckInsufficientReason =
	| "partial"
	| "missing"
	| "stale"
	| "zero_tests"
	| "skipped"
	| "unavailable"
	| "gate_closed"
	| "aborted"
	/** Spec 100: the check ran and passed but its required check never got a result in this run. */
	| "not_run"
	/** Spec 100: a test runner's counts could not be read from its output (parser, not environment). */
	| "unverified_counts"
	/** Spec 100: the check passed, then the host refused to complete the goal on it. */
	| "completion_refused"
	/** Spec 104: a required tool was absent or could not fit the input ceiling; never `complete`. */
	| "required_capability_missing";

/** A count the runner printed, or `unknown` when it printed none we can read. Never a guessed 0. */
export type TaskTestCount = number | "unknown";

export interface TaskTestCounts {
	readonly executed: TaskTestCount;
	readonly matched: TaskTestCount;
	/** Display only: never changes a status. */
	readonly skipped: TaskTestCount;
}

/** One earlier or current result of the same check in this run. */
export interface TaskCheckAttempt {
	readonly attempt: number;
	readonly status: TaskCheckFactStatus;
	readonly reason?: TaskCheckInsufficientReason;
	readonly receiptId?: string;
}

/** One observation from one registered check. */
export interface TaskCheckFact {
	/** Stable id within the run, e.g. `goal-acceptance:<receiptId>`. */
	readonly id: string;
	readonly source: TaskResultSource;
	readonly status: TaskCheckFactStatus;
	/** A required check gates `passed`; an optional one only adds coverage. */
	readonly required: boolean;
	readonly reason?: TaskCheckInsufficientReason;
	/** The host receipt id, set only for `host_receipt` facts. */
	readonly receiptId?: string;
	/** Spec 100: one id per required check (approved command); attempts of it share the id. */
	readonly checkId?: string;
	readonly checkRevision?: number;
	/** 1-based attempt of `checkId` in this run; a downgrade replaces the same attempt. */
	readonly attempt?: number;
	readonly checkKind?: CheckKind;
	readonly tests?: TaskTestCounts;
	/** Why the host refused completion, bounded, for `completion_refused`. */
	readonly detail?: string;
	/** Earlier attempts of the same check, oldest first; set by the collector. */
	readonly attempts?: readonly TaskCheckAttempt[];
}

/** What the model said about the result. Never promoted to a host fact. */
export interface TaskModelClaim {
	readonly source: "model_text";
	readonly says: "passed" | "failed" | "unknown";
	/** The claim's text, bounded, for the operator. */
	readonly text: string;
}

export interface TaskResultCoverage {
	/** Host-registered checks that ran to a pass or a failure. */
	readonly checksRun: number;
	/** Required checks (one per approved command), run or not; `unknown` with no approved command. Never a guessed 0. */
	readonly checksTotal: number | "unknown";
	/** Host receipts seen in this run, attempts included. */
	readonly receiptsObserved: number;
}

export interface TaskResultProjection {
	readonly version: typeof TASK_RESULT_VERSION;
	readonly promptRunId: string;
	readonly execution: PromptSettlementOutcome;
	readonly check: TaskCheckObservation;
	/** Source of the `check` value: `host_receipt` only when host facts decided it. */
	readonly checkSource: TaskResultSource | "none";
	readonly coverage: TaskResultCoverage;
	readonly facts: readonly TaskCheckFact[];
	readonly modelClaims: readonly TaskModelClaim[];
}

/** Spec 100: the earlier `passed` fact of a check is no longer a pass; emitted the moment it happens. */
export interface TaskResultDowngradeEvent {
	readonly type: "task_result_downgrade";
	readonly version: typeof TASK_RESULT_VERSION;
	readonly promptRunId: string;
	readonly from: "passed";
	readonly fact: TaskCheckFact;
}

/** The new versioned event; `*_settled` events are unchanged (D1). */
export interface TaskResultEvent {
	readonly type: "task_result";
	readonly version: typeof TASK_RESULT_VERSION;
	readonly projection: TaskResultProjection;
}

export interface TaskResultInput {
	readonly settled: Pick<PromptSettledEvent, "promptRunId" | "outcome">;
	readonly facts?: readonly TaskCheckFact[];
	readonly modelClaims?: readonly TaskModelClaim[];
}

/** `OMK_TASK_RESULT` is on only for `1` or `true`; unset, empty and `0` are off. */
export function isTaskResultEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
	const value = env.OMK_TASK_RESULT?.trim().toLowerCase();
	return value === "1" || value === "true";
}

export function hostFacts(facts: readonly TaskCheckFact[]): TaskCheckFact[] {
	return facts.filter((fact) => fact.source === "host_receipt");
}

/** The check axis from facts alone. `model_text` facts are ignored here by construction. */
export function projectCheckObservation(
	facts: readonly TaskCheckFact[],
	execution: PromptSettlementOutcome,
): TaskCheckObservation {
	const host = hostFacts(facts);
	if (host.length === 0) return "none";
	const required = host.filter((fact) => fact.required);
	if (required.some((fact) => fact.status === "failed")) return "required_failed";
	if (host.some((fact) => fact.status === "cancel_pending")) return "cancel_pending";
	if (required.some((fact) => fact.status === "cancelled")) return "cancelled";
	if (required.length === 0) return "none";
	if (required.some((fact) => fact.status !== "passed")) return "insufficient";
	// An aborted run cannot be verified even when every check it ran passed.
	if (execution !== "completed") return "insufficient";
	return "passed";
}

export function projectCoverage(facts: readonly TaskCheckFact[]): TaskResultCoverage {
	const host = hostFacts(facts);
	const receipts = new Set<string>();
	for (const fact of host) {
		for (const attempt of fact.attempts ?? []) if (attempt.receiptId) receipts.add(attempt.receiptId);
		if (fact.receiptId) receipts.add(fact.receiptId);
	}
	return {
		checksRun: host.filter((fact) => fact.status === "passed" || fact.status === "failed").length,
		checksTotal: host.length === 0 ? "unknown" : host.length,
		receiptsObserved: receipts.size,
	};
}

export function projectTaskResult(input: TaskResultInput): TaskResultProjection {
	const facts = input.facts ?? [];
	const check = projectCheckObservation(facts, input.settled.outcome);
	return {
		version: TASK_RESULT_VERSION,
		promptRunId: input.settled.promptRunId,
		execution: input.settled.outcome,
		check,
		checkSource: check === "none" ? "none" : "host_receipt",
		coverage: projectCoverage(facts),
		facts: facts.map((fact) => ({ ...fact })),
		modelClaims: (input.modelClaims ?? []).map((claim) => ({ ...claim })),
	};
}

export function buildTaskResultEvent(input: TaskResultInput): TaskResultEvent {
	return { type: "task_result", version: TASK_RESULT_VERSION, projection: projectTaskResult(input) };
}

// ---------------------------------------------------------------------------
// Read-only adapters (goal acceptance, finish-check). verified-run is out (D2).

export interface GoalAcceptanceFactOptions {
	/** Workspace SHA-256 now; a different value means an edit after the check (stale). */
	readonly currentWorkspaceSha256?: string;
	/** Tests the check matched, when the runner reports it; 0 is never a pass. */
	readonly matchedTests?: number;
	/** Spec 100: tests that ran (passed or failed); 0 is never a pass. */
	readonly executedTests?: number;
	readonly skippedTests?: number;
	readonly checkKind?: CheckKind;
	readonly checkId?: string;
	readonly checkRevision?: number;
	readonly attempt?: number;
	readonly required?: boolean;
}

function countOf(value: number | undefined): TaskTestCount {
	return value === undefined ? "unknown" : value;
}

/** One host fact from a goal acceptance receipt. */
export function factFromGoalAcceptance(
	result: Pick<GoalAcceptanceResult, "receiptId" | "status" | "passed" | "workspace">,
	options: GoalAcceptanceFactOptions = {},
): TaskCheckFact {
	const testRunner = options.checkKind === "test_runner";
	const base = {
		id: options.checkId ?? `goal-acceptance:${result.receiptId}`,
		source: "host_receipt" as const,
		required: options.required ?? true,
		receiptId: result.receiptId,
		...(options.checkId !== undefined ? { checkId: options.checkId } : {}),
		...(options.checkRevision !== undefined ? { checkRevision: options.checkRevision } : {}),
		...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
		...(options.checkKind !== undefined ? { checkKind: options.checkKind } : {}),
		...(testRunner
			? {
					tests: {
						executed: countOf(options.executedTests),
						matched: countOf(options.matchedTests),
						skipped: countOf(options.skippedTests),
					},
				}
			: {}),
	};
	switch (result.status) {
		case "failed":
			return { ...base, status: "failed" };
		case "aborted":
			return { ...base, status: "cancelled" };
		case "timeout":
			return { ...base, status: "insufficient", reason: "unavailable" };
		case "passed":
			break;
	}
	const completeness = result.workspace.completeness;
	if (completeness === "unavailable") return { ...base, status: "insufficient", reason: "unavailable" };
	if (completeness !== "complete") return { ...base, status: "insufficient", reason: "partial" };
	if (!result.passed) return { ...base, status: "insufficient", reason: "gate_closed" };
	if (options.matchedTests === 0 || options.executedTests === 0)
		return { ...base, status: "insufficient", reason: "zero_tests" };
	// Spec 100 decision 3: a test runner whose counts could not be read is never a pass.
	if (testRunner && (options.matchedTests === undefined || options.executedTests === undefined))
		return { ...base, status: "insufficient", reason: "unverified_counts" };
	if (options.currentWorkspaceSha256 !== undefined && options.currentWorkspaceSha256 !== result.workspace.sha256)
		return { ...base, status: "insufficient", reason: "stale" };
	return { ...base, status: "passed" };
}

/** A finish check that was registered but skipped: host-recorded, never a pass. */
export function factFromFinishCheckSkip(reason: FinishCheckSkipReason, required = false): TaskCheckFact {
	return {
		id: `finish-check:skipped:${reason}`,
		source: "host_receipt",
		status: reason === "aborted" ? "cancelled" : "insufficient",
		required,
		...(reason === "aborted" ? {} : { reason: "skipped" as const }),
	};
}

const CLAIM_TEXT_CHARS = 160;

function boundClaim(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= CLAIM_TEXT_CHARS ? flat : `${flat.slice(0, CLAIM_TEXT_CHARS - 1)}…`;
}

/** Finish-check ledger lines are the model's own report: claims, not host facts. */
export function claimsFromFinishCheckLedger(items: readonly FinishCheckLedgerItem[]): TaskModelClaim[] {
	return items
		.filter((item) => item.status !== "unreported")
		.map((item) => ({
			source: "model_text" as const,
			says: item.status === "pass" ? ("passed" as const) : ("failed" as const),
			text: boundClaim(`REQ ${item.id}: ${item.status.toUpperCase()}${item.measured ? ` - ${item.measured}` : ""}`),
		}));
}

const MODEL_PASS = /\b(?:all\s+(?:tests|checks)\s+pass(?:ed)?|tests?\s+pass(?:ed)?|passed|PASS|done|verified)\b/i;
const MODEL_FAIL = /\b(?:failed|FAIL|failing|failures?|errors?)\b/i;
/** Zero-count phrases ("0 failed", "no failures") report the absence of a failure, not a failure. */
const MODEL_ZERO_FAIL =
	/\b(?:0|zero|no)\s+(?:tests?\s+|checks?\s+)?(?:failed|failing|failures?|errors?|fail)\b|\bwithout\s+(?:any\s+)?(?:failures?|errors?)\b/gi;

/**
 * A free-text model claim, if the text makes one. Kept as `model_text` whatever it quotes.
 * Zero-count failure phrases are not failures; any remaining (nonzero) failure phrase is `failed`,
 * even next to a pass phrase. `passed` needs an explicit pass phrase; zero-count-only text is `unknown`.
 */
export function claimFromModelText(text: string): TaskModelClaim | undefined {
	const hasZeroFail = new RegExp(MODEL_ZERO_FAIL.source, "i").test(text);
	const rest = text.replace(MODEL_ZERO_FAIL, " ");
	const fail = MODEL_FAIL.test(rest);
	const pass = MODEL_PASS.test(rest);
	if (fail) return { source: "model_text", says: "failed", text: boundClaim(text) };
	if (pass) return { source: "model_text", says: "passed", text: boundClaim(text) };
	if (hasZeroFail) return { source: "model_text", says: "unknown", text: boundClaim(text) };
	return undefined;
}
