import { FINISH_CHECK_MAX_TOOL_CALLS, FINISH_CHECK_MESSAGE } from "./finish-check.ts";
import { checkComparisons } from "./finish-check-compare.ts";

/** Most checklist items one finish check asks for; longer prompts keep the first ones. */
export const FINISH_CHECK_MAX_REQUIREMENTS = 8;
/** Tool calls allowed for a checklist check never go above this. */
export const FINISH_CHECK_MAX_CHECKLIST_TOOL_CALLS = 12;
const MAX_REQUIREMENT_CHARS = 220;
// Numeric sentences often list several limits (corewars: 75% for three opponents, 33% for two); 220 cut the last one off.
const MAX_NUMERIC_REQUIREMENT_CHARS = 400;

// A bound word right before a number: "at least 0.62", "between 15 and 45", "no more than 150MB", "at least a 75%".
// The number must follow the word; a digit elsewhere (a path, a version) does not make a limit (review M1).
const BOUND_BEFORE_NUMBER =
	/\b(?:at least|at most|no (?:more|less|fewer) than|(?:less|more|fewer|greater|smaller|larger|higher|lower) than|between|within|minimum|maximum|exactly|up to|under|below|above|exceeds?)\s+(?:(?:a|an|of|the)\s+)?(?:[\w.]+\s*[=:]\s*)?[`'"]?[-−$£€]?\d/i;
// "5 or more", "33% or better", "60% of the original time or less".
const NUMBER_BEFORE_BOUND = /\d[\d.,]*\s*%?(?:\s+[a-z]+){0,5}\s+or (?:more|less|fewer|better|higher|lower)\b/i;
// Paths, file names and version strings carry digits that are not limits.
const NOT_A_LIMIT =
	/(?:\S*\/\S*|\S+\.(?:json|csv|txt|py|md|bin|pt|so|c|js|ts|sh|toml|ya?ml|out|log|scm|png|ppm|html|red|img)\b|\bv?\d+(?:\.\d+){2,}\b|\bv\d+(?:\.\d+)*\b|\b(?:python|node|ruby|go|java|gcc|version)\s+\d+(?:\.\d+)+)/gi;
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

// A relative file name such as `image.c` or `out/result.json`, counted only when the sentence asks to produce it.
const RELATIVE_FILE =
	/(?:^|[\s`'"(])(?:\.\/)?(?:[\w.@+-]+\/)*[\w@+-]+\.(?:json|csv|txt|py|md|bin|pt|so|c|js|ts|sh|toml|ya?ml|out|log|scm|png|ppm|html)\b/;
const PRODUCE_WORDS = /\b(?:save[sd]?|write|writes|written|create|output|produce|place|store)\b/i;
const OUTPUT_WORDS = /\b(?:save[sd]?|write|writes|written|create|output|produce|place|store|exists?|configure)\b/i;

/** 1 = bounds a number, 2 = names a path or file it asks for, 3 = names a path; undefined = not a requirement. */
function requirementTier(sentence: string): 1 | 2 | 3 | undefined {
	const prose = sentence.replace(NOT_A_LIMIT, " ");
	if (BOUND_BEFORE_NUMBER.test(prose) || NUMBER_BEFORE_BOUND.test(prose)) return 1;
	if (COMPARATOR.test(prose)) return 1;
	if (UNIT_NUMBER.test(prose) && REQUIRED.test(prose)) return 1;
	if (!ABSOLUTE_PATH.test(sentence))
		return RELATIVE_FILE.test(sentence) && PRODUCE_WORDS.test(sentence) ? 2 : undefined;
	return REQUIRED.test(sentence) || OUTPUT_WORDS.test(sentence) ? 2 : 3;
}

/** Whether a checklist item bounds a number (tier 1), so its result can be compared with a limit. */
export function isNumericRequirement(item: string): boolean {
	return requirementTier(item) === 1;
}

function shorten(sentence: string, tier: 1 | 2 | 3): string {
	const flat = sentence.replace(/\s+/g, " ");
	const max = tier === 1 ? MAX_NUMERIC_REQUIREMENT_CHARS : MAX_REQUIREMENT_CHARS;
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
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
		const item = shorten(sentence, tier);
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

const NUMERIC_REPORT_LINE =
	"For an item that states a numeric limit, write one comparison per limit as `<label> <measured> <op> <limit>`, separated by `;`, for example `REQ 1: FAIL - stone 74 >= 75; snake 39 >= 33`. A comparison that does not hold makes the item FAIL.";

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
		...(requirements.some(isNumericRequirement) ? [NUMERIC_REPORT_LINE] : []),
	].join("\n");
}

export interface FinishCheckLedgerItem {
	readonly id: number;
	readonly requirement: string | undefined;
	readonly status: "pass" | "fail" | "unreported";
	readonly measured: string | undefined;
	/** The item bounds a number, so it needs a `<measured> <op> <limit>` comparison. */
	readonly numeric: boolean;
	/** False for a numeric item with no evaluable comparison; path items are always true. */
	readonly hasMeasurement: boolean;
	/** Reported comparisons that do not hold, e.g. `stone 74 >= 75`. */
	readonly gaps: string[];
	/** `compared` when omk turned a reported PASS into a fail because its own comparison does not hold. */
	readonly source: "reported" | "compared";
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
		const requirement = requirements[id - 1];
		const numeric = requirement !== undefined && isNumericRequirement(requirement);
		const { evaluated, gaps } = checkComparisons(entry?.measured);
		const compared = entry?.status === "pass" && gaps.length > 0;
		items.push({
			id,
			requirement,
			status: compared ? "fail" : (entry?.status ?? "unreported"),
			measured: entry?.measured,
			numeric,
			hasMeasurement: !numeric || evaluated > 0,
			gaps,
			source: compared ? "compared" : "reported",
		});
	}
	return items;
}

/** Numeric items the extra turn acts on: failed ones, and ones with no evaluable comparison. */
export function extraTurnItems(ledger: readonly FinishCheckLedgerItem[]): {
	failing: FinishCheckLedgerItem[];
	unmeasured: FinishCheckLedgerItem[];
} {
	const numeric = ledger.filter((item) => item.numeric);
	return {
		failing: numeric.filter((item) => item.status === "fail"),
		unmeasured: numeric.filter((item) => item.status !== "fail" && !item.hasMeasurement),
	};
}

const label = (item: FinishCheckLedgerItem) => `REQ ${item.id}: ${item.requirement ?? ""}`;

/** The one follow-up after a check with failed or unmeasured numeric items (spec 035). */
export function buildFinishCheckContinueMessage(ledger: readonly FinishCheckLedgerItem[]): string {
	const { failing, unmeasured } = extraTurnItems(ledger);
	const lines: string[] = [];
	if (failing.length > 0) {
		lines.push(
			"Finish check result: the task is not complete. These limits are not met by your own measurement:",
			...failing.map((item) => `${label(item)}\n  measured: ${item.gaps.join("; ") || item.measured || "FAIL"}`),
			"Keep working on these items; the quick-fix-only rule of the check no longer applies to them. Keep the currently saved output in place until a new version measures better, and never leave a required output worse or missing.",
		);
	}
	if (unmeasured.length > 0) {
		lines.push(
			"These numeric requirements were not measured:",
			...unmeasured.map(label),
			"Run a command that measures each one on the current outputs. Change the outputs only if the new measurement misses a limit.",
		);
	}
	lines.push(
		"When done, end your reply with one line per item above: `REQ <n>: PASS|FAIL - <label> <measured> <op> <limit>`, one comparison per limit, separated by `;`.",
	);
	return lines.join("\n");
}
