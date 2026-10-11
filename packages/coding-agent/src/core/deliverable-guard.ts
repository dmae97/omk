/**
 * Deliverable guard (spec 034): the pure part. Finds the output files a task
 * prompt asks for, their size limits, and the steer texts. The extension in
 * `extensions/builtin/deliverable-guard.ts` wires it to events and timers.
 */
import { isAbsolute, resolve } from "node:path";
import type { SizeLimit } from "./fast-check.ts";
import { PRODUCE_WORDS, splitSentences } from "./finish-check-requirements.ts";
import { readRunBudget, resolveTimeBudgetMs } from "./remaining-budget.ts";

/** Past this fraction of the budget a missing deliverable gets one steer. */
export const DELIVERABLE_WATCHDOG_FRACTION = 0.4;
/** Past this fraction a missing or invalid deliverable is restored from its last-good copy (same point as finish-check's skip). */
export const DELIVERABLE_RESTORE_FRACTION = 0.9;
/** Most deliverables guarded per task, in prompt order. */
export const DELIVERABLE_MAX_COUNT = 4;

export type DeliverableGuardMode = "off" | "headless" | "always";

/**
 * `OMK_DELIVERABLE_GUARD`: off unless set. `1/true/on/enable/enabled` = headless runs only
 * (like `shouldAddFinishDiscipline`), `always` = every session. Stays opt-in until the A/B shows a gain.
 */
export function resolveDeliverableGuardMode(value: string | undefined): DeliverableGuardMode {
	const normalized = value?.trim().toLowerCase() ?? "";
	if (normalized === "always") return "always";
	if (["1", "true", "on", "enable", "enabled"].includes(normalized)) return "headless";
	return "off";
}

export interface Deliverable {
	/** Absolute path; relative names are resolved against the session cwd. */
	readonly path: string;
	readonly sizeLimit?: SizeLimit;
}

// The produce words of #62 plus "call your program X" and "name it X".
const DELIVERABLE_WORDS = new RegExp(`${PRODUCE_WORDS.source}|\\b(?:call(?:ed)?|name[d]?)\\b`, "i");
// An absolute path with at least two segments; a trailing "/" makes it a directory.
const ABSOLUTE = /(?:^|[\s`'"(])(\/(?:[\w.@+-]+\/)+[\w.@+-]*[\w@+-])(\/?)/g;
// #62's relative file extensions plus .comp (write-compressor), .xml and .h.
const RELATIVE =
	/(?:^|[\s`'"(])((?:\.\/)?(?:[\w.@+-]+\/)*[\w@+-]+\.(?:json|csv|txt|py|md|bin|pt|so|c|h|js|ts|sh|toml|ya?ml|out|log|scm|png|ppm|html|comp|xml))(?![\w/-])/g;
const SIZE_BOUND =
	/(?:<=|<|≤|\bat most|\bless than|\bunder|\bno more than|\bno larger than)\s*(\d[\d,]*(?:\.\d+)?)\s*(bytes?|[kmg]i?b|b)\b/i;
const UNIT_BYTES: Readonly<Record<string, number>> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

interface Candidate {
	readonly index: number;
	readonly raw: string;
	readonly directory: boolean;
}

function candidatesAfter(sentence: string, from: number): Candidate[] {
	const found: Candidate[] = [];
	for (const match of sentence.matchAll(ABSOLUTE)) {
		const index = (match.index ?? 0) + match[0].indexOf(match[1]);
		if (index >= from) found.push({ index, raw: match[1], directory: match[2] === "/" });
	}
	for (const match of sentence.matchAll(RELATIVE)) {
		const index = (match.index ?? 0) + match[0].indexOf(match[1]);
		if (index >= from) found.push({ index, raw: match[1], directory: false });
	}
	return found.sort((a, b) => a.index - b.index);
}

function parseSizeLimit(sentence: string): SizeLimit | undefined {
	const match = SIZE_BOUND.exec(sentence);
	if (!match) return undefined;
	const value = Number(match[1].replace(/,/g, ""));
	if (!Number.isFinite(value) || value <= 0) return undefined;
	const unit = match[2].toLowerCase();
	const bytes = Math.floor(value * (UNIT_BYTES[unit[0]] ?? 1));
	const bound = match[0].trimStart().toLowerCase();
	return {
		bytes,
		inclusive:
			bound.startsWith("<=") || bound.startsWith("≤") || bound.startsWith("at most") || bound.startsWith("no "),
	};
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function names(sentence: string, path: string): boolean {
	const base = path.slice(path.lastIndexOf("/") + 1);
	return new RegExp(`(?<![\\w.-])(?:${escapeRegExp(path)}|${escapeRegExp(base)})(?![\\w-])`).test(sentence);
}

/**
 * The output files a prompt asks for: in each sentence, the first path after the
 * first produce word. A sentence that bounds a byte size sets the limit of the
 * deliverable it names, or of the only deliverable when it names none.
 */
export function extractDeliverables(prompt: string, cwd: string): Deliverable[] {
	const sentences = splitSentences(prompt);
	const paths: string[] = [];
	for (const sentence of sentences) {
		const word = DELIVERABLE_WORDS.exec(sentence);
		if (!word) continue;
		const first = candidatesAfter(sentence, word.index + word[0].length)[0];
		if (!first || first.directory) continue;
		const path = isAbsolute(first.raw) ? first.raw : resolve(cwd, first.raw);
		if (!paths.includes(path)) paths.push(path);
		if (paths.length >= DELIVERABLE_MAX_COUNT) break;
	}
	const limits = new Map<string, SizeLimit>();
	for (const sentence of sentences) {
		const limit = parseSizeLimit(sentence);
		if (!limit) continue;
		const named = paths.filter((path) => names(sentence, path));
		const targets = named.length > 0 ? named : paths.length === 1 ? paths : [];
		for (const path of targets) if (!limits.has(path)) limits.set(path, limit);
	}
	return paths.map((path) => {
		const sizeLimit = limits.get(path);
		return sizeLimit ? { path, sizeLimit } : { path };
	});
}

/** The 40% steer for deliverables that do not exist yet. */
export function buildWatchdogMessage(missing: readonly string[]): string {
	return [
		"Time check: about 40% of this run's time budget is used and these required outputs do not exist yet:",
		...missing.map((path) => `- ${path}`),
		"Write a simple working version to each path now, then improve it afterwards. Keep a valid version in place at all times.",
	].join("\n");
}

export interface RestoreNote {
	readonly path: string;
	/** `missing` or `invalid:<fast-check reason>`. */
	readonly reason: string;
	/** Size of the file that was replaced, when there was one. */
	readonly currentSize?: number;
	readonly sizeLimit?: SizeLimit;
	readonly restoredSize: number;
	readonly savedAtFraction?: number;
}

function describeProblem(note: RestoreNote): string {
	if (note.reason === "missing") return "was missing";
	if (note.reason === "invalid:size" && note.sizeLimit && note.currentSize !== undefined)
		return `was ${note.currentSize} bytes, over the ${note.sizeLimit.bytes}-byte limit`;
	if (note.reason === "invalid:empty") return "was empty";
	if (note.reason === "invalid:not_file") return "was not a regular file";
	const checker = note.reason.startsWith("invalid:syntax:") ? note.reason.slice("invalid:syntax:".length) : undefined;
	return checker ? `failed a ${checker} syntax check` : `was not valid (${note.reason})`;
}

/** The steer after a restore at the 90% point, so the run does not overwrite the copy with the broken file again. */
export function buildRestoreMessage(notes: readonly RestoreNote[]): string {
	const lines = notes.map((note) => {
		const when =
			note.savedAtFraction === undefined ? "" : ` from ${Math.round(note.savedAtFraction * 100)}% of the budget`;
		return `- \`${note.path}\` ${describeProblem(note)}; restored the ${note.restoredSize}-byte copy${when}.`;
	});
	return [
		"Deliverable guard: about 90% of this run's time budget is used. These required outputs were broken, so their last valid version was put back:",
		...lines,
		"Keep these files in place. Replace one only with a version you have checked is valid.",
	].join("\n");
}

/**
 * Elapsed fraction of the run budget, as finish-check reads it (spec 036): the shared
 * run clock (`readRunBudget()`, origin = run start, bound in print/json mode) when it
 * is bound, else `OMK_TIME_BUDGET_SEC` from `now()` at this call, so `always` in an
 * interactive session still has a clock. Undefined without a budget.
 */
export function runBudgetFraction(env: NodeJS.ProcessEnv, now: () => number): () => number | undefined {
	const budgetMs = resolveTimeBudgetMs(env.OMK_TIME_BUDGET_SEC);
	const startedAt = now();
	return () => {
		const shared = readRunBudget();
		if (shared) return shared.elapsedFraction;
		return budgetMs === undefined ? undefined : (now() - startedAt) / budgetMs;
	};
}
