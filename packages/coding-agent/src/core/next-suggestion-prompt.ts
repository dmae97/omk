/**
 * Host-built next-task suggestion: one title plus a prompt in the fixed order
 * input → verification → evidence → result.
 *
 * The host owns the structure. A local suggestion is built from observed session facts
 * alone, so it exists whether or not a model answers; a model reply contributes at most
 * one validated sentence (the proposed next request) and never the section layout.
 * `result` lists expected deliverables: nothing here reports work as done.
 */
import { type SituationCopy, type SuggestionSituation, situationCopy } from "./next-suggestion-copy.ts";
import { boundFact, type SuggestionFacts, type SuggestionLocale } from "./next-suggestion-facts.ts";

export type { SuggestionSituation } from "./next-suggestion-copy.ts";

export const SUGGESTION_SECTION_ORDER = ["input", "verification", "evidence", "result"] as const;
export type SuggestionSectionKey = (typeof SUGGESTION_SECTION_ORDER)[number];

export interface StructuredSuggestion {
	readonly title: string;
	readonly locale: SuggestionLocale;
	readonly situation: SuggestionSituation;
	readonly source: "local" | "model";
	/** False when the session cannot run a request yet; `blockedReason` says why. */
	readonly executable: boolean;
	readonly blockedReason?: string;
	readonly sections: Readonly<Record<SuggestionSectionKey, readonly string[]>>;
}

const HEADINGS: Readonly<Record<SuggestionLocale, Readonly<Record<SuggestionSectionKey, string>>>> = {
	ko: { input: "입력", verification: "검증", evidence: "증거", result: "결과" },
	en: { input: "Input", verification: "Verification", evidence: "Evidence", result: "Result" },
};

const LABELS = {
	ko: {
		problem: "해결할 문제",
		scope: "대상 범위",
		state: "현재 상태",
		constraints: "제약과 사용 가능한 입력",
		unknown: "미확인",
		check: "확인과 통과 조건",
		userPath: "사용자 경로",
		regression: "실패와 회귀",
		notRun: "실행 불가",
		observed: "관측(세션 기록)",
		collect: "수집할 증거",
		inferred: "추정",
		deliverable: "기대 산출물",
		done: "완료 조건",
		report: "최종 보고",
	},
	en: {
		problem: "Problem",
		scope: "Scope",
		state: "Current state",
		constraints: "Constraints and available input",
		unknown: "Unconfirmed",
		check: "Checks and pass condition",
		userPath: "User path",
		regression: "Failure and regression",
		notRun: "Cannot run",
		observed: "Observed (session transcript)",
		collect: "Evidence to collect",
		inferred: "Inferred",
		deliverable: "Expected deliverable",
		done: "Completion condition",
		report: "Final report",
	},
} as const;

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
	modelTask: string | undefined,
): StructuredSuggestion["sections"] {
	const ko = facts.locale === "ko";
	const label = LABELS[facts.locale];
	const paths = facts.changedPaths.join(", ");
	const none = ko ? "없음" : "none";
	const outcome = facts.outcome === "idle" ? (ko ? "아직 실행된 턴 없음" : "no turn has run yet") : facts.outcome;
	const request = facts.userRequest ? `"${facts.userRequest}"` : none;
	const inputs = [
		ko ? "세션 기록" : "session transcript",
		...(paths
			? [ko ? `변경 경로 ${facts.changedPaths.length}건` : `${facts.changedPaths.length} changed path(s)`]
			: []),
		...(facts.failure ? [ko ? "실패 출력" : "failure output"] : []),
	].join(", ");
	const observed = [
		ko ? `직전 턴 결과 ${outcome}` : `last turn outcome ${outcome}`,
		...(paths ? [ko ? `변경 파일 ${paths}` : `changed files ${paths}`] : []),
		...(facts.failedTools.length > 0
			? [`${ko ? "실패한 도구" : "failed tools"} ${facts.failedTools.join(", ")}`]
			: []),
		...(facts.failure ? [`${ko ? "오류" : "error"} "${facts.failure}"`] : []),
	].join("; ");
	const local = ko ? "없음. 이 제안은 세션 기록에서 로컬로 생성됨" : "none. This suggestion was built locally";
	const skipped = facts.generation
		? ko
			? ` (모델 보강 미사용: ${facts.generation})`
			: ` (no model input: ${facts.generation})`
		: "";
	const inferred = modelTask
		? ko
			? "해결할 문제는 모델이 제안한 다음 요청이며 사실로 확인되지 않음"
			: "the problem is the model's proposed next request and is not a confirmed fact"
		: `${local}${skipped}`;
	return {
		input: [
			`${label.problem}: ${modelTask ?? copy.problem}`,
			`${label.scope}: ${paths || (ko ? "미확인. 대상 파일이나 모듈을 먼저 특정" : "unconfirmed. Identify the target files or module first")}`,
			`${label.state}: ${ko ? `직전 요청 ${request}, 직전 턴 결과 ${outcome}` : `last request ${request}, last turn outcome ${outcome}`}`,
			`${label.constraints}: ${ko ? `기존 권한과 승인 경계 안에서만 실행. 사용 가능한 입력: ${inputs}` : `run only inside the existing permission and approval boundaries. Available input: ${inputs}`}`,
			`${label.unknown}: ${copy.unknown}`,
		],
		verification: [
			`${label.check}: ${copy.check}`,
			`${label.userPath}: ${copy.userPath}`,
			`${label.regression}: ${copy.regression}`,
			`${label.notRun}: ${ko ? "이 제안을 만든 시점에는 어떤 검증도 실행하지 않았음. 실행할 수 없는 검증은 이유와 함께 보고" : "no check had run when this suggestion was built. Report any check that cannot run, with the reason"}`,
		],
		evidence: [
			`${label.observed}: ${observed}`,
			`${label.collect}: ${copy.collect}`,
			`${label.inferred}: ${inferred}`,
			`${label.unknown}: ${copy.unknown}. ${ko ? "위 검증으로 확보" : "Obtain it through the checks above"}`,
		],
		result: [
			`${label.deliverable}: ${copy.deliverable}`,
			`${label.done}: ${copy.done}`,
			`${label.report}: ${ko ? "변경 경로, 실행한 명령과 종료 상태, 미검증 항목" : "changed paths, commands run with exit status, unverified items"}`,
		],
	};
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
		sections: buildSections(facts, copy, task),
	};
}

/** Undefined when the suggestion satisfies the contract, otherwise the first violation. */
export function suggestionViolation(suggestion: StructuredSuggestion): string | undefined {
	if (suggestion.title.trim() === "" || suggestion.title.includes("\n")) return "title";
	for (const key of SUGGESTION_SECTION_ORDER) {
		const items = suggestion.sections[key];
		if (items.length === 0 || items.some((item) => item.trim() === "" || item.includes("\n"))) return key;
	}
	return undefined;
}

/** The one renderer: title, then the four sections in {@link SUGGESTION_SECTION_ORDER}. */
export function renderSuggestionPrompt(suggestion: StructuredSuggestion): string {
	const heading = HEADINGS[suggestion.locale];
	return [
		suggestion.title,
		...SUGGESTION_SECTION_ORDER.flatMap((key) => [
			`## ${heading[key]}`,
			...suggestion.sections[key].map((item) => `- ${item}`),
		]),
	].join("\n");
}

/** Structural check of rendered text: a title, then all four headings in order, each with a non-empty item. */
export function isWellFormedSuggestionPrompt(text: string): boolean {
	const lines = text.split("\n");
	if ((lines[0] ?? "").trim() === "" || lines[0]?.startsWith("## ")) return false;
	return (["ko", "en"] as const).some((locale) => {
		let cursor = 1;
		for (const key of SUGGESTION_SECTION_ORDER) {
			if (lines[cursor] !== `## ${HEADINGS[locale][key]}`) return false;
			cursor += 1;
			const first = cursor;
			while (cursor < lines.length && /^- \S/.test(lines[cursor] ?? "")) cursor += 1;
			if (cursor === first) return false;
		}
		return cursor === lines.length;
	});
}
