/**
 * Observed session facts behind a next-task suggestion.
 *
 * Pure and memory-only: reads the session message snapshot the host already holds and
 * returns bounded strings. Nothing here calls a provider, touches the file system, or
 * infers a defect that the transcript does not show.
 */
import { userMessageText } from "./next-suggestion-accept-trace.ts";
import { allSituationChecks, type SuggestionLocale } from "./next-suggestion-copy.ts";

export type { SuggestionLocale };
/** `idle`: no turn has settled yet in this session view. */
export type SuggestionTurnOutcome = "completed" | "failed" | "aborted" | "idle";

export interface SuggestionFacts {
	readonly locale: SuggestionLocale;
	readonly outcome: SuggestionTurnOutcome;
	/** Last user request, whitespace-collapsed and bounded. */
	readonly userRequest?: string;
	/** Paths of `edit`/`write` tool calls in the last run whose result was not an error. */
	readonly changedPaths: readonly string[];
	readonly freshCheck?: boolean;
	/** null: a task snapshot exists but has no actionable entry. */
	readonly nextTask?: string | null;
	/** Tools whose last result in the run is still an error. */
	readonly failedTools: readonly string[];
	/** First line of the unresolved failure, bounded. */
	readonly failure?: string;
	/** Session has no selected model, so nothing can be sent yet. */
	readonly modelMissing: boolean;
	/** Why model-based generation did not contribute (skip reason or request outcome). */
	readonly generation?: string;
}

export const MAX_FACT_CHARS = 200;
export const MAX_FACT_PATHS = 6;
const WRITE_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

interface LooseMessage {
	readonly role?: unknown;
	readonly content?: unknown;
	readonly details?: { readonly tasks?: unknown; readonly error?: unknown };
	readonly stopReason?: unknown;
	readonly errorMessage?: unknown;
	readonly toolCallId?: unknown;
	readonly toolName?: unknown;
	readonly isError?: unknown;
}

/** Collapse whitespace and control characters, then bound the length. */
export function boundFact(value: string, max: number = MAX_FACT_CHARS): string {
	const flat = value
		.replace(/\p{Cc}+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// Labels of host-rendered suggestions (v2 sectioned and v3 short form), both locales.
const HOST_LABEL =
	/^(?:- )?(?:해결할 문제|대상 범위|현재 상태|제약과 사용 가능한 입력|미확인|확인과 통과 조건|사용자 경로|실패와 회귀|실행 불가|관측\(세션 기록\)|수집할 증거|추정|기대 산출물|완료 조건|최종 보고|맥락|범위|완료 기준|Problem|Scope|Current state|Constraints and available input|Unconfirmed|Checks and pass condition|User path|Failure and regression|Cannot run|Observed \(session transcript\)|Evidence to collect|Inferred|Expected deliverable|Completion condition|Final report|Context|Done when): /;
const HOST_MARKER = /^(?:## (?:입력|Input)|맥락: |Context: )/m;
const HOST_TAILS = [
	"변경 경로, 실행한 명령과 종료 상태, 미검증 항목",
	"changed paths, commands run with exit status, unverified items",
	...allSituationChecks(),
];

/**
 * The user's own words in a request that may be an accepted host suggestion: the host
 * checklist is dropped, text typed after its canned last value is kept. A prompt without a
 * host marker is returned unchanged.
 */
export function requestText(raw: string): string {
	if (!HOST_MARKER.test(raw)) return raw;
	const kept: string[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("## ")) continue;
		if (!HOST_LABEL.test(trimmed)) {
			kept.push(line);
			continue;
		}
		const tail = HOST_TAILS.find((value) => trimmed.includes(value));
		const extra = tail ? trimmed.slice(trimmed.lastIndexOf(tail) + tail.length).trim() : "";
		if (extra) kept.push(extra);
	}
	return kept.join("\n");
}

function firstText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const part of content) {
		if (part?.type === "text" && typeof part.text === "string" && part.text.trim() !== "") return part.text;
	}
	return "";
}

function detectLocale(text: string | undefined, env: NodeJS.ProcessEnv): SuggestionLocale {
	if (text !== undefined && text !== "") return /[\uac00-\ud7a3]/.test(text) ? "ko" : "en";
	return /^ko/i.test(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "") ? "ko" : "en";
}

export interface CollectFactsInput {
	readonly messages: readonly unknown[];
	readonly outcome: SuggestionTurnOutcome;
	readonly modelMissing?: boolean;
	readonly generation?: string;
	readonly env?: NodeJS.ProcessEnv;
}

/** Facts of the last run: everything from the last user message to the end of the snapshot. */
export function collectSuggestionFacts(input: CollectFactsInput): SuggestionFacts {
	const messages = input.messages as readonly (LooseMessage | undefined)[];
	let start = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") {
			start = index;
			break;
		}
	}
	const rawRequest = start >= 0 ? userMessageText(messages[start]) : undefined;
	const userRequest = rawRequest ? boundFact(requestText(rawRequest)) || undefined : undefined;
	const pathByCall = new Map<string, string>();
	const checks = new Map<string, number>();
	let revision = 0;
	let freshCheck = false;
	let nextTask: string | null | undefined;
	const lastResult = new Map<string, { readonly error: boolean; readonly text: string }>();
	const changed = new Set<string>();
	let failure: string | undefined;
	for (const message of start >= 0 ? messages.slice(start + 1) : []) {
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (
					block?.type === "toolCall" &&
					block.name === "bash" &&
					typeof block.id === "string" &&
					/^(?:npm (?:run check|test)|pnpm (?:check|test)|cargo test|go test \.\/\.\.\.)$/.test(
						block.arguments?.command ?? "",
					)
				)
					checks.set(block.id, revision);
				const path = block?.arguments?.path;
				if (block?.type === "toolCall" && WRITE_TOOLS.has(block.name) && typeof path === "string") {
					pathByCall.set(String(block.id), path);
				}
			}
			if (message.stopReason === "error" && typeof message.errorMessage === "string") {
				failure = boundFact(message.errorMessage);
			}
		} else if (message?.role === "toolResult" && typeof message.toolName === "string") {
			const error = message.isError === true;
			lastResult.set(message.toolName, { error, text: firstText(message.content) });
			const path = pathByCall.get(String(message.toolCallId));
			if (error || (path !== undefined && WRITE_TOOLS.has(message.toolName))) {
				revision++;
				freshCheck = false;
				if (!error && path !== undefined) changed.add(path);
			} else if (
				message.toolName === "bash" &&
				message.isError === false &&
				checks.get(String(message.toolCallId)) === revision
			) {
				freshCheck = true;
			}
			if (
				message.toolName === "todo" &&
				!error &&
				!message.details?.error &&
				Array.isArray(message.details?.tasks)
			) {
				const tasks = message.details.tasks;
				const done = new Set(tasks.filter((t) => t?.status === "completed").map((t) => t.id));
				const ready = tasks.filter(
					(t) =>
						typeof t?.subject === "string" &&
						Array.isArray(t.blockedBy) &&
						t.blockedBy.every((id: unknown) => done.has(id)),
				);
				const task = ready.find((t) => t.status === "in_progress") ?? ready.find((t) => t.status === "pending");
				nextTask = task ? boundFact(task.subject) : null;
			}
		}
	}
	const failedTools = [...lastResult].filter(([, result]) => result.error).map(([name]) => name);
	if (failure === undefined && failedTools.length > 0) {
		const text = lastResult.get(failedTools[0] ?? "")?.text ?? "";
		failure = text.trim() === "" ? undefined : boundFact(text.split(/\r?\n/).find((line) => line.trim()) ?? text);
	}
	return {
		locale: detectLocale(userRequest, input.env ?? process.env),
		outcome: input.outcome,
		...(userRequest ? { userRequest } : {}),
		changedPaths: [...changed].slice(0, MAX_FACT_PATHS).map((path) => boundFact(path, 120)),
		...(freshCheck ? { freshCheck } : {}),
		...(nextTask !== undefined ? { nextTask } : {}),
		failedTools,
		...(failure ? { failure } : {}),
		modelMissing: input.modelMissing === true,
		...(input.generation ? { generation: input.generation } : {}),
	};
}
