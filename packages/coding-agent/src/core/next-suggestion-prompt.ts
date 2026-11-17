/**
 * Host-built next-task suggestion (v3): a title sentence plus three labelled sentences,
 * context, scope and done-when, so the whole prompt is four sentences.
 *
 * The host owns the structure. A local suggestion is built from observed session facts
 * alone, so it exists whether or not a model answers; a model reply contributes at most
 * one validated sentence (the proposed next request) and never the layout.
 * Nothing here reports work as done: the last sentence is a pass condition, not a result.
 */
import { type SituationCopy, type SuggestionSituation, situationCopy } from "./next-suggestion-copy.ts";
import { boundFact, type SuggestionFacts, type SuggestionLocale } from "./next-suggestion-facts.ts";

export type { SuggestionSituation } from "./next-suggestion-copy.ts";

export const SUGGESTION_SECTION_ORDER = ["context", "scope", "check"] as const;
export type SuggestionSectionKey = (typeof SUGGESTION_SECTION_ORDER)[number];

export interface StructuredSuggestion {
	readonly title: string;
	readonly locale: SuggestionLocale;
	readonly situation: SuggestionSituation;
	readonly source: "local" | "model";
	/** False when the session cannot run a request yet; `blockedReason` says why. */
	readonly executable: boolean;
	readonly blockedReason?: string;
	/** One single-line sentence per key. */
	readonly sections: Readonly<Record<SuggestionSectionKey, string>>;
}

const LABELS: Readonly<Record<SuggestionLocale, Readonly<Record<SuggestionSectionKey, string>>>> = {
	ko: { context: "맥락", scope: "범위", check: "완료 기준" },
	en: { context: "Context", scope: "Scope", check: "Done when" },
};
const REQUEST_CHARS = 120;

export function classifySituation(facts: SuggestionFacts): SuggestionSituation {
	if (facts.modelMissing) return "blocked";
	if (facts.outcome === "failed") return "reconnect";
	if (facts.failedTools.length > 0) return "diagnose";
	if (facts.changedPaths.length > 0) return "verify";
	return facts.userRequest ? "continue" : "clarify";
}

/**
 * Accept one model sentence as the proposed next request, or reject it. The reply is
 * external input: structured or fenced output, an echo of the instruction, text without
 * letters, and a repeat of the request that just completed are all refused.
 */
export function sanitizeModelTask(raw: string | undefined, facts: SuggestionFacts): string | undefined {
	if (raw === undefined) return undefined;
	const task = boundFact(raw);
	if (task.length < 4 || !/\p{L}/u.test(task)) return undefined;
	if (/^[[{<`#]/.test(task) || task.includes("[next-task suggestion]")) return undefined;
	const same = (value: string | undefined) => value !== undefined && value.toLowerCase() === task.toLowerCase();
	return same(facts.userRequest) ? undefined : task;
}

function subjectOf(facts: SuggestionFacts, situation: SuggestionSituation, ko: boolean): string {
	if (situation === "diagnose") return facts.failedTools.join(", ");
	const [first, ...rest] = facts.changedPaths;
	if (first === undefined) return "";
	if (rest.length === 0) return first;
	return ko ? `${first} 외 ${rest.length}건` : `${first} and ${rest.length} more`;
}

function buildSections(
	facts: SuggestionFacts,
	copy: SituationCopy,
	situation: SuggestionSituation,
): StructuredSuggestion["sections"] {
	const ko = facts.locale === "ko";
	const parts: string[] = [];
	if (facts.outcome === "idle") parts.push(ko ? "아직 실행된 턴 없음" : "no turn has run yet");
	else if (facts.userRequest) {
		const request = boundFact(facts.userRequest, REQUEST_CHARS);
		parts.push(ko ? `직전 요청 "${request}"(${facts.outcome})` : `last request "${request}" (${facts.outcome})`);
	} else parts.push(ko ? `직전 턴 ${facts.outcome}` : `last turn ${facts.outcome}`);
	if (facts.changedPaths.length > 0)
		parts.push(`${ko ? "변경 파일" : "changed files"} ${facts.changedPaths.join(", ")}`);
	if (facts.failedTools.length > 0)
		parts.push(`${ko ? "실패한 도구" : "failed tools"} ${facts.failedTools.join(", ")}`);
	if (facts.failure) parts.push(`${ko ? "오류" : "error"} "${facts.failure}"`);
	// The title already names the block; context says how to clear it.
	if (situation === "blocked") parts.push(copy.userPath);
	const scope =
		facts.changedPaths.join(", ") ||
		(ko ? "미확인, 대상 파일이나 모듈을 먼저 특정" : "unconfirmed, identify the target files or module first");
	return { context: parts.join("; "), scope, check: copy.check };
}

/** Deterministic suggestion from observed facts; `modelTask` must come from {@link sanitizeModelTask}. */
export function buildSuggestion(facts: SuggestionFacts, modelTask?: string): StructuredSuggestion {
	const situation = classifySituation(facts);
	const copy = situationCopy(situation, facts.locale, subjectOf(facts, situation, facts.locale === "ko"));
	// A blocked session keeps the blocking reason as its title: a model sentence must not hide it.
	const task = situation === "blocked" ? undefined : modelTask;
	return {
		title: task ?? copy.title,
		locale: facts.locale,
		situation,
		source: task ? "model" : "local",
		executable: situation !== "blocked",
		...(situation === "blocked" ? { blockedReason: copy.problem } : {}),
		sections: buildSections(facts, copy, situation),
	};
}

/** Undefined when the suggestion satisfies the contract, otherwise the first violation. */
export function suggestionViolation(suggestion: StructuredSuggestion): string | undefined {
	if (suggestion.title.trim() === "" || suggestion.title.includes("\n")) return "title";
	for (const key of SUGGESTION_SECTION_ORDER) {
		const value = suggestion.sections[key];
		if (value.trim() === "" || value.includes("\n")) return key;
	}
	return undefined;
}

/** The one renderer: the title, then one `label: sentence` line per key. */
export function renderSuggestionPrompt(suggestion: StructuredSuggestion): string {
	const label = LABELS[suggestion.locale];
	return [
		suggestion.title,
		...SUGGESTION_SECTION_ORDER.map((key) => `${label[key]}: ${suggestion.sections[key]}`),
	].join("\n");
}

function labelled(line: string | undefined, label: string): string | undefined {
	const prefix = `${label}: `;
	if (!line?.startsWith(prefix)) return undefined;
	const value = line.slice(prefix.length);
	return value.trim() === "" ? undefined : value;
}

/** Structural check of rendered text: a title line, then the three labelled lines in order. */
export function isWellFormedSuggestionPrompt(text: string): boolean {
	const lines = text.split("\n");
	const title = lines[0] ?? "";
	if (lines.length !== 1 + SUGGESTION_SECTION_ORDER.length || title.trim() === "") return false;
	return (["ko", "en"] as const).some(
		(locale) =>
			labelled(title, LABELS[locale].context) === undefined &&
			SUGGESTION_SECTION_ORDER.every((key, index) => labelled(lines[index + 1], LABELS[locale][key]) !== undefined),
	);
}

/**
 * Skill-selection query for an accepted suggestion prompt: its title and scope. The other
 * lines are host wording about context and checks, which describes no capability of the task.
 * Undefined for text that is not a host-rendered suggestion prompt.
 */
export function suggestionSkillQuery(text: string): string | undefined {
	if (!isWellFormedSuggestionPrompt(text)) return undefined;
	const lines = text.split("\n");
	const scope = (lines[2] ?? "").replace(/^[^:]+:\s*/, "");
	return `${lines[0]}\n${scope}`;
}
