/**
 * Observed session facts behind a next-task suggestion.
 *
 * Pure and memory-only: reads the session message snapshot the host already holds and
 * returns bounded strings. Nothing here calls a provider, touches the file system, or
 * infers a defect that the transcript does not show.
 */
import { userMessageText } from "./next-suggestion-accept-trace.ts";

export type SuggestionLocale = "ko" | "en";
/** `idle`: no turn has settled yet in this session view. */
export type SuggestionTurnOutcome = "completed" | "failed" | "aborted" | "idle";

export interface SuggestionFacts {
	readonly locale: SuggestionLocale;
	readonly outcome: SuggestionTurnOutcome;
	/** Last user request, whitespace-collapsed and bounded. */
	readonly userRequest?: string;
	/** Paths of `edit`/`write` tool calls in the last run whose result was not an error. */
	readonly changedPaths: readonly string[];
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
	const userRequest = rawRequest ? boundFact(rawRequest) : undefined;
	const pathByCall = new Map<string, string>();
	const lastResult = new Map<string, { readonly error: boolean; readonly text: string }>();
	const changed = new Set<string>();
	let failure: string | undefined;
	for (const message of start >= 0 ? messages.slice(start + 1) : []) {
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
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
			if (path !== undefined && !error) changed.add(path);
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
		failedTools,
		...(failure ? { failure } : {}),
		modelMissing: input.modelMissing === true,
		...(input.generation ? { generation: input.generation } : {}),
	};
}
