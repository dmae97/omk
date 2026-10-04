/**
 * B12 measurement vocabulary (OMK_MATH_f46a8f6): the turn phases, the span trace record and the
 * one error type the measurement modules throw.
 *
 * A trace line is parsed at the file boundary into exactly the B12 trace fields. Every other
 * field (prompts, arguments, credentials, environment) is dropped rather than copied. Ids and
 * count names must be short tokens, which keeps prose out but not a token-shaped secret such as
 * an API key: writers must not put secrets in ids. Ticks are nonnegative safe integers so phase
 * sums are exact, and an over-long line is refused before it is parsed.
 */
export const MEASUREMENT_PHASES = [
	"startup",
	"fit",
	"count",
	"claims",
	"dag",
	"permit",
	"provider",
	"retry",
	"tool",
	"render",
	"drain",
	"unattributed",
] as const;
export type MeasurementPhase = (typeof MEASUREMENT_PHASES)[number];

export const MEASUREMENT_SPAN_OUTCOMES = ["ok", "error", "aborted", "timeout"] as const;
export type MeasurementSpanOutcome = (typeof MEASUREMENT_SPAN_OUTCOMES)[number];

export interface MeasurementSpan {
	readonly runId: string;
	readonly spanId: string;
	readonly parentId?: string;
	readonly phase: MeasurementPhase;
	/** Monotonic clock ticks (microseconds recommended); nonnegative safe integers. */
	readonly monotonicStart: number;
	readonly monotonicEnd: number;
	readonly outcome: MeasurementSpanOutcome;
	readonly counts: Readonly<Record<string, number>>;
}

export type MeasurementInputErrorCode =
	| "invalid_number"
	| "invalid_tick"
	| "invalid_interval"
	| "invalid_phase"
	| "invalid_order"
	| "invalid_flag"
	| "invalid_id"
	| "duplicate_id"
	| "unknown_parent"
	| "cycle"
	| "family_too_small"
	| "empty_sample"
	| "contradictory_record";

/** Invalid measurement input. `field` names the offending input, never its content. */
export class MeasurementInputError extends Error {
	readonly code: MeasurementInputErrorCode;
	readonly field: string;

	constructor(code: MeasurementInputErrorCode, field: string) {
		super(`measurement input ${code}: ${field}`);
		this.name = "MeasurementInputError";
		this.code = code;
		this.field = field;
	}
}

const PHASES: ReadonlySet<string> = new Set(MEASUREMENT_PHASES);
const OUTCOMES: ReadonlySet<string> = new Set(MEASUREMENT_SPAN_OUTCOMES);
// A leading letter or digit rules out ".", ".." and "__proto__".
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COUNT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_COUNTS = 32;
/** A valid record is under 4 KiB; the cap leaves room for dropped fields without parsing megabytes. */
const MAX_LINE_CHARS = 64 * 1024;

export function isMeasurementPhase(value: unknown): value is MeasurementPhase {
	return typeof value === "string" && PHASES.has(value);
}

export function isTick(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOutcome(value: unknown): value is MeasurementSpanOutcome {
	return typeof value === "string" && OUTCOMES.has(value);
}

function isId(value: unknown): value is string {
	return typeof value === "string" && ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCounts(value: unknown): Record<string, number> | undefined {
	if (!isRecord(value)) return undefined;
	const names = Object.keys(value);
	if (names.length > MAX_COUNTS) return undefined;
	// No prototype: a lookup of an absent name such as `toString` finds nothing instead of a
	// function. Object method names are also refused, so copying counts into a plain object cannot
	// shadow its methods.
	const counts: Record<string, number> = Object.create(null);
	for (const name of names.sort()) {
		const count = value[name];
		if (!COUNT_NAME_PATTERN.test(name) || name in Object.prototype || !isTick(count)) return undefined;
		counts[name] = count;
	}
	return counts;
}

/** Parse one JSONL trace line into a span, or `undefined` when any B12 field is invalid. */
export function parseMeasurementSpan(line: string): MeasurementSpan | undefined {
	if (typeof line !== "string" || line.length > MAX_LINE_CHARS) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const { runId, spanId, phase, monotonicStart, monotonicEnd, outcome } = value;
	const parentId = value.parentId === null ? undefined : value.parentId;
	if (!isId(runId) || !isId(spanId) || !isMeasurementPhase(phase)) return undefined;
	if (parentId !== undefined && (!isId(parentId) || parentId === spanId)) return undefined;
	if (!isTick(monotonicStart) || !isTick(monotonicEnd) || monotonicEnd < monotonicStart) return undefined;
	if (!isOutcome(outcome)) return undefined;
	const counts = parseCounts(value.counts);
	if (counts === undefined) return undefined;
	return {
		runId,
		spanId,
		...(parentId === undefined ? {} : { parentId }),
		phase,
		monotonicStart,
		monotonicEnd,
		outcome,
		counts,
	};
}
