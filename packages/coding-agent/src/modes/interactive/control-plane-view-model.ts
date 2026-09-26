import type { ResourceGovernorMode } from "../../core/resource-admission-config.ts";
import type { SessionTermination } from "../../core/session-termination-types.ts";
import type { ThemeColor } from "./theme/theme.ts";

/** Typed authority vocabulary. UI code never maps free-form strings to colours. */
export type UiAuthorityState = "ok" | "active" | "blocked" | "degraded" | "unknown" | "stale" | "inconclusive";
export const UI_AUTHORITY_STATES: readonly UiAuthorityState[] = [
	"ok",
	"active",
	"blocked",
	"degraded",
	"unknown",
	"stale",
	"inconclusive",
];

/** Evidence verdict the UI may show. Prompt settlement / agent_end / model narration are never inputs. */
export type EvidenceUiVerdict = "verified" | "failed" | "inconclusive" | "stale" | "unverified";

/** Protocol evidence (verified-run projection vocabulary). Absent => no evidence workflow attached. */
export interface EvidenceSignal {
	readonly verification: "not_requested" | "verified" | "violated" | "inconclusive";
	readonly receiptPresent: boolean;
	readonly receiptFresh: boolean;
}

export type TerminationSignal = Pick<
	SessionTermination,
	"kind" | "phase" | "causeCode" | "sideEffects" | "retryable" | "safeToAutoRetry" | "nextAction"
>;

/** Raw signals. `undefined` always means "no source" and must never render as healthy. */
export interface ControlPlaneSignals {
	readonly isStreaming?: boolean;
	readonly isCompacting?: boolean;
	readonly isRetrying?: boolean;
	readonly pendingMessageCount?: number;
	readonly lastTermination?: TerminationSignal;
	readonly evidence?: EvidenceSignal;
	readonly contextPercent?: number | null;
	readonly contextWindowTokens?: number;
	readonly autoCompactEnabled?: boolean;
	readonly governorMode?: ResourceGovernorMode;
	readonly busyCpuPercent?: number;
	/** Host CPU busy percent across all cores: the quantity the governor compares with `busyCpuPercent`. */
	readonly systemCpuPercent?: number | null;
	readonly memoryRssBytes?: number | null;
}

export interface AuthorityCell {
	readonly state: UiAuthorityState;
	readonly label: string;
}

export interface FailureCard {
	readonly causeCode: string;
	readonly phase: string;
	readonly sideEffects: "none" | "possible" | "confirmed";
	readonly retry: "auto" | "manual" | "none";
	readonly nextAction: string;
}

export interface RunView extends AuthorityCell {
	readonly queued: number | null;
	readonly failure: FailureCard | null;
}
export interface VerifyView extends AuthorityCell {
	readonly verdict: EvidenceUiVerdict;
}
export type ContextPressure = "unknown" | "normal" | "elevated" | "critical";
export interface ContextView extends AuthorityCell {
	readonly percent: number | null;
	readonly windowTokens: number;
	readonly pressure: ContextPressure;
	readonly compacting: boolean;
	readonly autoCompact: boolean | null;
}
export interface ResourceView extends AuthorityCell {
	readonly governorMode: ResourceGovernorMode | null;
	readonly systemCpuPercent: number | null;
	readonly memoryRssBytes: number | null;
}

export interface ControlPlaneViewModel {
	readonly run: RunView;
	readonly verify: VerifyView;
	readonly context: ContextView;
	readonly resources: ResourceView;
}

export interface AuthorityStyle {
	readonly color: ThemeColor;
	readonly glyph: string;
}

export const CONTEXT_ELEVATED_PERCENT = 70;
export const CONTEXT_CRITICAL_PERCENT = 90;
export const DEFAULT_BUSY_CPU_PERCENT = 85; // mirrors DEFAULT_RESOURCE_ADMISSION_THRESHOLDS.busyCpuPercent

const NO_SOURCE: AuthorityCell = { state: "unknown", label: "unknown" };

const VERDICT_STATE: Readonly<Record<EvidenceUiVerdict, UiAuthorityState>> = {
	verified: "ok",
	failed: "blocked",
	inconclusive: "inconclusive",
	stale: "stale",
	unverified: "unknown",
};

const PRESSURE_STATE: Readonly<Record<ContextPressure, UiAuthorityState>> = {
	unknown: "unknown",
	normal: "ok",
	elevated: "degraded",
	critical: "blocked",
};

const AUTHORITY_STYLES: Readonly<Record<UiAuthorityState, AuthorityStyle>> = {
	ok: { color: "success", glyph: "✓" },
	active: { color: "accent", glyph: "●" },
	blocked: { color: "error", glyph: "!" },
	degraded: { color: "warning", glyph: "▲" },
	unknown: { color: "muted", glyph: "?" },
	stale: { color: "warning", glyph: "~" },
	inconclusive: { color: "warning", glyph: "◐" },
};

function finiteOrNull(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentOrNull(value: number | null | undefined): number | null {
	const finite = finiteOrNull(value);
	return finite === null ? null : Math.min(100, Math.max(0, finite));
}

function nonNegativeOrNull(value: number | null | undefined): number | null {
	const finite = finiteOrNull(value);
	return finite !== null && finite >= 0 ? finite : null;
}

export function evidenceVerdict(signal: EvidenceSignal | undefined): EvidenceUiVerdict {
	if (signal === undefined || signal.verification === "not_requested" || !signal.receiptPresent) {
		return "unverified";
	}
	if (!signal.receiptFresh) return "stale";
	if (signal.verification === "violated") return "failed";
	if (signal.verification === "inconclusive") return "inconclusive";
	// Any value outside the typed vocabulary fails closed.
	return signal.verification === "verified" ? "verified" : "unverified";
}

export function contextPressure(percent: number | null | undefined): ContextPressure {
	const finite = finiteOrNull(percent);
	if (finite === null) return "unknown";
	if (finite < CONTEXT_ELEVATED_PERCENT) return "normal";
	if (finite < CONTEXT_CRITICAL_PERCENT) return "elevated";
	return "critical";
}

function retryPolicy(termination: TerminationSignal): FailureCard["retry"] {
	if (termination.safeToAutoRetry) return "auto";
	return termination.retryable ? "manual" : "none";
}

function failureCard(termination: TerminationSignal): FailureCard {
	return {
		causeCode: termination.causeCode,
		phase: termination.phase,
		sideEffects: termination.sideEffects,
		retry: retryPolicy(termination),
		nextAction: termination.nextAction,
	};
}

/** RUN precedence: first match wins; only a settled, non-completed turn carries a failure card. */
function runCell(signals: ControlPlaneSignals): { cell: AuthorityCell; failure: FailureCard | null } {
	if (signals.isStreaming === undefined) return { cell: NO_SOURCE, failure: null };
	if (signals.isCompacting) return { cell: { state: "active", label: "compacting" }, failure: null };
	if (signals.isRetrying) return { cell: { state: "degraded", label: "retrying" }, failure: null };
	if (signals.isStreaming) return { cell: { state: "active", label: "running" }, failure: null };
	const termination = signals.lastTermination;
	if (termination === undefined || termination.kind === "completed") {
		return { cell: { state: "ok", label: "idle" }, failure: null };
	}
	const failure = failureCard(termination);
	if (termination.kind === "user_abort") return { cell: { state: "degraded", label: "aborted" }, failure };
	return { cell: { state: termination.retryable ? "degraded" : "blocked", label: termination.kind }, failure };
}

function runView(signals: ControlPlaneSignals): RunView {
	const { cell, failure } = runCell(signals);
	const pending = nonNegativeOrNull(signals.pendingMessageCount);
	return { ...cell, queued: pending === null ? null : Math.trunc(pending), failure };
}

function verifyView(evidence: EvidenceSignal | undefined): VerifyView {
	const verdict = evidenceVerdict(evidence);
	return { state: VERDICT_STATE[verdict], label: verdict, verdict };
}

function contextView(signals: ControlPlaneSignals): ContextView {
	const pressure = contextPressure(signals.contextPercent);
	return {
		state: PRESSURE_STATE[pressure],
		label: pressure,
		percent: percentOrNull(signals.contextPercent),
		windowTokens: signals.contextWindowTokens ?? 0,
		pressure,
		compacting: signals.isCompacting === true,
		autoCompact: signals.autoCompactEnabled ?? null,
	};
}

function busyThreshold(value: number | undefined): number {
	const finite = finiteOrNull(value);
	return finite !== null && finite >= 1 && finite <= 100 ? finite : DEFAULT_BUSY_CPU_PERCENT;
}

function resourceCell(systemCpuPercent: number | null, busyCpuPercent: number): AuthorityCell {
	if (systemCpuPercent === null) return NO_SOURCE;
	return systemCpuPercent >= busyCpuPercent ? { state: "degraded", label: "busy" } : { state: "ok", label: "normal" };
}

function resourceView(signals: ControlPlaneSignals): ResourceView {
	const systemCpuPercent = percentOrNull(signals.systemCpuPercent);
	return {
		...resourceCell(systemCpuPercent, busyThreshold(signals.busyCpuPercent)),
		governorMode: signals.governorMode ?? null,
		systemCpuPercent,
		memoryRssBytes: nonNegativeOrNull(signals.memoryRssBytes),
	};
}

export function buildControlPlaneViewModel(signals: ControlPlaneSignals): ControlPlaneViewModel {
	return {
		run: runView(signals),
		verify: verifyView(signals.evidence),
		context: contextView(signals),
		resources: resourceView(signals),
	};
}

/** The only state -> presentation mapping. Status is glyph + text, never colour alone. */
export function authorityStyle(state: UiAuthorityState): AuthorityStyle {
	return AUTHORITY_STYLES[state];
}

/** Plain text for a cell: `${authorityStyle(cell.state).glyph} ${cell.label}` (renderers add colour). */
export function authorityText(cell: AuthorityCell): string {
	return `${authorityStyle(cell.state).glyph} ${cell.label}`;
}
