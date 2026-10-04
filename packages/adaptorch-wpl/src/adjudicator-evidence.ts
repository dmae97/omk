/** Structural checks only; none establish execution or semantic correctness. */
import { ADJUDICATION_REASON_CODES, type AdjudicationReasonCode } from "./adjudicator-registry.ts";

/** A rejected check cannot attach a success/unknown code to a negative verdict. */
export function failedCheckReasonCode(code: unknown, fallback: AdjudicationReasonCode): AdjudicationReasonCode {
	return ADJUDICATION_REASON_CODES.find((known) => known === code && known !== "ALL_CHECKS_PASSED") ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, keys: string[]): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const field = value[key];
		if (typeof field === "string") return field;
	}
	return undefined;
}

/**
 * Reads arrays and recognized collection envelopes. Unknown scalars/objects are
 * malformed evidence, never an implicit one-item list.
 */
export function asList(value: unknown): unknown[] | undefined {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value;
	if (isRecord(value)) {
		for (const key of ["items", "artifacts", "traces", "spans", "entries", "data", "results"]) {
			const field = value[key];
			if (Array.isArray(field)) return field;
		}
	}
	return undefined;
}

/** True unless the item is a recognizably empty/whitespace-only value (Part 2 section 2.3). */
export function hasSubstance(item: unknown): boolean {
	if (typeof item === "string") return item.trim().length > 0;
	if (isRecord(item)) {
		const size = item.size_bytes ?? item.size ?? item.byteLength ?? item.length;
		if (typeof size === "number") return Number.isFinite(size) && size > 0;
		const text = readStringField(item, ["content", "text", "body"]);
		if (text !== undefined) return text.trim().length > 0;
	}
	return isRecord(item) && Object.keys(item).length > 0;
}

/** Heuristic ERROR-severity span scan (Part 2 section 2.3), tolerant of unknown span shapes. */
export function countErrorSpans(traces: unknown[]): number {
	let count = 0;
	for (const span of traces) {
		if (!isRecord(span)) continue;
		const level = readStringField(span, ["level", "severity", "status"]);
		if (level !== undefined && level.toLowerCase() === "error") {
			count += 1;
			continue;
		}
		if (span.error === true || span.isError === true) count += 1;
	}
	return count;
}

/**
 * Heuristic count of "action" spans for the `expected_min_actions` check (Part 2 sections
 * 2.3/4). Recognizes a handful of common marker fields; if none of the spans carry any of
 * them, falls back to the total span count so the check degrades to a coarse presence
 * signal instead of always failing.
 */
export function countActionSpans(traces: unknown[]): number {
	let recognized = 0;
	let matched = 0;
	for (const span of traces) {
		if (!isRecord(span)) continue;
		const marker = readStringField(span, ["action", "tool_call", "toolCall", "kind", "type"]);
		if (marker !== undefined) {
			recognized += 1;
			if (/action|tool|write|edit|call/i.test(marker)) matched += 1;
		}
	}
	return recognized > 0 ? matched : traces.length;
}
