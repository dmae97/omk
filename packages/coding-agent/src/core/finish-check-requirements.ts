import { FINISH_CHECK_MAX_TOOL_CALLS, FINISH_CHECK_MESSAGE } from "./finish-check.ts";

/** Most checklist items one finish check asks for; longer prompts keep the first ones. */
export const FINISH_CHECK_MAX_REQUIREMENTS = 8;
/** Tool calls allowed for a checklist check never go above this. */
export const FINISH_CHECK_MAX_CHECKLIST_TOOL_CALLS = 12;
const MAX_REQUIREMENT_CHARS = 220;

// Words that bound a number: "at least 0.62", "between 15 and 45", "no more than 150MB".
const BOUND_WORDS =
	/\b(?:at least|at most|no (?:more|less|fewer) than|(?:less|more|fewer|greater|smaller|larger|higher|lower) than|between|within|minimum|maximum|exactly|up to|under|below|above|exceeds?|or (?:more|less|fewer|better|higher|lower))\b/i;
const NUMBER = /\d/;
const COMPARATOR = /(?:[<>]=?|[≤≥])\s*-?\d/;
// A number with a unit or percentage, counted only when the sentence also says it is required.
const UNIT_NUMBER =
	/\d(?:[\d.,]*)\s*(?:%|percent\b|[kmg]i?b\b|bytes?\b|ms\b|seconds?\b|minutes?\b|nt\b|bp\b|lines?\b|chars?\b|characters?\b)/i;
const REQUIRED = /\b(?:must|should|needs? to|required?|has to|have to|ensure|make sure)\b/i;
// An absolute path with at least two segments, optionally in backticks or quotes.
const ABSOLUTE_PATH = /(?:^|[\s`'"(])(\/(?:[\w.@+-]+\/)+[\w.@+-]*[\w@+-])/;

function splitSentences(prompt: string): string[] {
	const sentences: string[] = [];
	let inCodeBlock = false;
	for (const line of prompt.split(/\r?\n/)) {
		// Code samples restate paths and numbers the prose already gives; skip them.
		if (/^\s*(?:```|~~~)/.test(line)) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock || /^(?: {4}|\t)/.test(line)) continue;
		const trimmed = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
		if (!trimmed) continue;
		// Split on sentence ends, but not inside numbers (0.62) or file names (win311.img).
		for (const part of trimmed.split(/(?<=[.!?])\s+(?=[A-Z`"(])/)) {
			const sentence = part.trim();
			if (sentence) sentences.push(sentence);
		}
	}
	return sentences;
}

const OUTPUT_WORDS = /\b(?:save[sd]?|write|writes|written|create|output|produce|place|store|exists?|configure)\b/i;

/** 1 = bounds a number, 2 = names a path it asks for, 3 = names a path; undefined = not a requirement. */
function requirementTier(sentence: string): 1 | 2 | 3 | undefined {
	if (BOUND_WORDS.test(sentence) && NUMBER.test(sentence)) return 1;
	if (COMPARATOR.test(sentence)) return 1;
	if (UNIT_NUMBER.test(sentence) && REQUIRED.test(sentence)) return 1;
	if (!ABSOLUTE_PATH.test(sentence)) return undefined;
	return REQUIRED.test(sentence) || OUTPUT_WORDS.test(sentence) ? 2 : 3;
}

function shorten(sentence: string): string {
	const flat = sentence.replace(/\s+/g, " ");
	return flat.length <= MAX_REQUIREMENT_CHARS ? flat : `${flat.slice(0, MAX_REQUIREMENT_CHARS - 1)}…`;
}

/**
 * Pulls the measurable requirements out of a task prompt: sentences that bound
 * a number or name an absolute path. Plain-language goals are left to the
 * general finish check. When there are more than `limit`, numeric limits are
 * kept first, then paths the task asks for, then other paths.
 */
export function extractRequirements(prompt: string, limit = FINISH_CHECK_MAX_REQUIREMENTS): string[] {
	const seen = new Set<string>();
	const candidates: { index: number; tier: number; item: string }[] = [];
	for (const sentence of splitSentences(prompt)) {
		const tier = requirementTier(sentence);
		if (tier === undefined) continue;
		const item = shorten(sentence);
		const key = item.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		candidates.push({ index: candidates.length, tier, item });
	}
	// Numeric limits are what runs most often miss, so they win the slots; the list keeps prompt order.
	const kept = [...candidates].sort((a, b) => a.tier - b.tier || a.index - b.index).slice(0, limit);
	return kept.sort((a, b) => a.index - b.index).map((candidate) => candidate.item);
}

/** Tool calls for a check with this many checklist items: one measurement each plus a little room. */
export function finishCheckToolCap(requirementCount: number): number {
	return Math.min(FINISH_CHECK_MAX_CHECKLIST_TOOL_CALLS, Math.max(FINISH_CHECK_MAX_TOOL_CALLS, requirementCount + 3));
}

/** The finish-check message, with a measured checklist when the prompt has measurable requirements. */
export function buildFinishCheckMessage(requirements: readonly string[]): string {
	if (requirements.length === 0) return FINISH_CHECK_MESSAGE;
	const cap = finishCheckToolCap(requirements.length);
	const base = FINISH_CHECK_MESSAGE.replace(
		`Use at most ${FINISH_CHECK_MAX_TOOL_CALLS} tool calls`,
		`Use at most ${cap} tool calls`,
	);
	return [
		base,
		"",
		"Measured checklist. These lines from the task state limits or paths. For each one, run a command that measures it on the current outputs; restating your plan is not a measurement. When the task's test data is hidden, measure on data you did not train or tune on. Fix a failing item only if the fix is quick and keeps the saved outputs valid.",
		...requirements.map((item, index) => `REQ ${index + 1}: ${item}`),
		"End your reply with one line per item: `REQ <n>: PASS|FAIL - <measured value>`.",
	].join("\n");
}

export interface FinishCheckLedgerItem {
	readonly id: number;
	readonly requirement: string | undefined;
	readonly status: "pass" | "fail" | "unreported";
	readonly measured: string | undefined;
}

const LEDGER_LINE = /^[\s>*`-]*REQ\s+(\d+)\s*:\s*(PASS|FAIL)\b[\s`*]*(?:[-–—:]\s*)?(.*)$/gim;

/** Reads the `REQ n: PASS|FAIL - value` lines from the check's reply, one entry per requirement. */
export function parseFinishCheckLedger(reply: string, requirements: readonly string[]): FinishCheckLedgerItem[] {
	const reported = new Map<number, { status: "pass" | "fail"; measured: string | undefined }>();
	for (const match of reply.matchAll(LEDGER_LINE)) {
		const id = Number(match[1]);
		const measured = match[3]?.replace(/[`*]+$/g, "").trim();
		reported.set(id, {
			status: match[2].toUpperCase() === "PASS" ? "pass" : "fail",
			measured: measured || undefined,
		});
	}
	const count = Math.max(requirements.length, ...reported.keys(), 0);
	const items: FinishCheckLedgerItem[] = [];
	for (let id = 1; id <= count; id++) {
		const entry = reported.get(id);
		items.push({
			id,
			requirement: requirements[id - 1],
			status: entry?.status ?? "unreported",
			measured: entry?.measured,
		});
	}
	return items;
}
