/**
 * Spec 091 stage 1: one next-task sentence after a completed turn.
 *
 * Default off (`OMK_NEXT_SUGGESTIONS`). When off, nothing here is installed:
 * no stream wrapper, no extra provider call, request bytes unchanged.
 *
 * When on, {@link MainRequestRecorder} wraps the agent's stream function and
 * passes every main request through unchanged, only remembering the last
 * `(model, context, options)`. The suggestion request reuses that context
 * byte-for-byte (same system prompt, tools and message objects), appends the
 * turn's final assistant message and then the suggestion instruction at the
 * very end, so the provider prompt cache covers the shared prefix.
 *
 * The suggestion request and its response never touch agent state, the
 * session log, compaction input, or the next main request.
 */
import type { StreamFn } from "omk-agent-core";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, Usage, UserMessage } from "omk-ai";
import { linkAbortSignals } from "./abort-link.ts";
import {
	cappedSuggestionOptions,
	checkSuggestionCache,
	estimateSuggestionCostUsd,
	type SuggestionBudget,
} from "./next-suggestion-budget.ts";
import { suggestionEffectiveMaxTokens, suggestionMaxTokens } from "./next-suggestion-options.ts";
import { tagRequestPurpose } from "./request-purpose.ts";

export { SUGGESTION_MAX_TOKENS, suggestionEffectiveMaxTokens, suggestionMaxTokens } from "./next-suggestion-options.ts";

export const NEXT_SUGGESTIONS_ENV = "OMK_NEXT_SUGGESTIONS";
/** PREREG: skip when ≥ 90% of the active quota window is used. */
export const NEAR_USAGE_LIMIT_PERCENT = 90;
/** Cache considered cold this long after the last main request (default/`short` retention). */
export const SHORT_CACHE_TTL_MS = 5 * 60_000;
/** Cache considered cold this long after the last main request with `long` retention. */
export const LONG_CACHE_TTL_MS = 60 * 60_000;
export const MAX_SUGGESTION_CHARS = 200;
/** The quota check is abandoned (and the suggestion skipped) after this long. */
export const USAGE_CHECK_TIMEOUT_MS = 2_000;

/**
 * Quota usage for the 90% rule: a used percent, `"no_quota"` when the provider
 * has no quota window at all, or `"unavailable"` when the check failed or timed
 * out (fail closed: the suggestion is skipped).
 */
export type QuotaUsage = number | "no_quota" | "unavailable";

export const SUGGESTION_INSTRUCTION =
	"[next-task suggestion] Based on the conversation so far, write the single next request the user is most " +
	"likely to send. Reply with that one sentence only, in the user's language, with no quotes, no preamble, " +
	"and no tool calls.";

export function isNextSuggestionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(?:1|on|true|yes)$/i.test(env[NEXT_SUGGESTIONS_ENV]?.trim() ?? "");
}

export interface RecordedMainRequest {
	readonly model: Model<Api>;
	readonly context: Context;
	readonly options: SimpleStreamOptions | undefined;
	readonly atMs: number;
}

/** Pass-through stream wrapper that remembers the last main request. */
export class MainRequestRecorder {
	private last: RecordedMainRequest | undefined;
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	wrap(inner: StreamFn): StreamFn {
		const wrapped: StreamFn = (model, context, options) => {
			this.last = { model, context, options, atMs: this.now() };
			return inner(model, context, options);
		};
		// Preserve source-owned identity brands used by mandatory credential checks.
		for (const key of Object.getOwnPropertySymbols(inner)) {
			const descriptor = Object.getOwnPropertyDescriptor(inner, key);
			if (descriptor) Object.defineProperty(wrapped, key, descriptor);
		}
		return wrapped;
	}

	get lastRequest(): RecordedMainRequest | undefined {
		return this.last;
	}
}

export type SuggestionSkipReason =
	| "no_record"
	| "not_completed"
	| "error"
	| "aborted"
	| "model_changed"
	| "no_cache_support"
	| "cache_cold"
	| "near_usage_limit"
	| "usage_unavailable"
	// Spec 103, caps flag on only:
	| "over_cost_cap"
	| "cache_capability_unknown"
	| "budget_unset";

export interface SuggestionPlanInput {
	readonly record: RecordedMainRequest | undefined;
	readonly outcome: "completed" | "failed" | "aborted";
	readonly finalAssistant: AssistantMessage | undefined;
	readonly currentModel: { readonly provider: string; readonly id: string } | undefined;
	readonly nowMs: number;
	readonly usage: QuotaUsage;
	/** Spec 103: present only with `OMK_NEXT_SUGGESTIONS_CAPS` on; `budget` undefined ⇒ skip `budget_unset`. */
	readonly caps?: { readonly budget: SuggestionBudget | undefined };
}

/** Caps-flag-only request fields: the (possibly lower-reasoning) options and the wall-time deadline. */
export interface SuggestionCapsPlan {
	readonly options: SimpleStreamOptions | undefined;
	readonly deadlineMs: number;
	readonly estimatedCostUsd: number;
	/** Spec 103b: `cappedSuggestionOptions` lowered the recorded reasoning level. */
	readonly reasoningCapped: boolean;
}

/** Spec 103b: numbers attached to an `over_cost_cap` skip (caps flag on only). */
export interface SuggestionCostCapHit {
	readonly estimatedCostUsd: number;
	readonly maxCostUsd: number;
}

export type SuggestionPlan =
	| { readonly kind: "skip"; readonly reason: SuggestionSkipReason; readonly costCap?: SuggestionCostCapHit }
	| {
			readonly kind: "request";
			readonly record: RecordedMainRequest;
			readonly finalAssistant: AssistantMessage;
			readonly caps?: SuggestionCapsPlan;
	  };

export function cacheTtlMs(options: SimpleStreamOptions | undefined): number {
	if (options?.cacheRetention === "none") return 0;
	return options?.cacheRetention === "long" ? LONG_CACHE_TTL_MS : SHORT_CACHE_TTL_MS;
}

export function supportsPromptCache(model: Model<Api>, options: SimpleStreamOptions | undefined): boolean {
	return options?.cacheRetention !== "none" && (model.cost?.cacheRead ?? 0) > 0;
}

export function planSuggestion(input: SuggestionPlanInput): SuggestionPlan {
	const skip = (reason: SuggestionSkipReason): SuggestionPlan => ({ kind: "skip", reason });
	if (input.outcome === "aborted") return skip("aborted");
	if (input.outcome !== "completed") return skip("not_completed");
	const final = input.finalAssistant;
	if (final?.stopReason === "aborted") return skip("aborted");
	if (!final || final.stopReason === "error") return skip("error");
	const record = input.record;
	if (!record || record.atMs > final.timestamp + 1) return skip("no_record");
	const model = input.currentModel;
	if (!model || model.provider !== record.model.provider || model.id !== record.model.id) {
		return skip("model_changed");
	}
	if (input.caps) {
		const cache = checkSuggestionCache(record.model, record.options, input.nowMs - record.atMs);
		if (cache !== "ok") return skip(cache);
	} else {
		if (!supportsPromptCache(record.model, record.options)) return skip("no_cache_support");
		if (input.nowMs - record.atMs >= cacheTtlMs(record.options)) return skip("cache_cold");
	}
	if (input.usage === "unavailable") return skip("usage_unavailable");
	if (typeof input.usage === "number" && !(input.usage < NEAR_USAGE_LIMIT_PERCENT)) {
		return skip("near_usage_limit");
	}
	if (!input.caps) return { kind: "request", record, finalAssistant: final };
	const budget = input.caps.budget;
	if (!budget) return skip("budget_unset");
	const options = cappedSuggestionOptions(record.options, budget);
	const context = buildSuggestionContext(record, final);
	const estimatedCostUsd = estimateSuggestionCostUsd(
		record.model,
		context,
		suggestionEffectiveMaxTokens(record.model, options),
	);
	if (!(estimatedCostUsd <= budget.maxCostUsd)) {
		return { kind: "skip", reason: "over_cost_cap", costCap: { estimatedCostUsd, maxCostUsd: budget.maxCostUsd } };
	}
	return {
		kind: "request",
		record,
		finalAssistant: final,
		caps: {
			options,
			deadlineMs: budget.deadlineMs,
			estimatedCostUsd,
			reasoningCapped: options?.reasoning !== record.options?.reasoning,
		},
	};
}

/** The recorded main context with the final answer and the instruction appended at the end only. */
export function buildSuggestionContext(record: RecordedMainRequest, finalAssistant: AssistantMessage): Context {
	const instruction: UserMessage = {
		role: "user",
		content: [{ type: "text", text: SUGGESTION_INSTRUCTION }],
		timestamp: finalAssistant.timestamp + 1,
	};
	return { ...record.context, messages: [...record.context.messages, finalAssistant, instruction] };
}

export function extractSuggestion(message: AssistantMessage): string | undefined {
	if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
	const text = message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join(" ");
	const line = text
		.split(/\r?\n/)
		.map((part) => part.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""))
		.find((part) => part.length > 0);
	if (!line) return undefined;
	return line.length > MAX_SUGGESTION_CHARS ? `${line.slice(0, MAX_SUGGESTION_CHARS - 1)}…` : line;
}

export type SuggestionOutcome = "shown" | "empty" | "aborted" | "timeout" | "error";

/** Spec 103 §2.2. `usage: undefined` is missing coverage, never 0. */
export interface SuggestionResult {
	readonly text?: string;
	readonly usage?: Usage;
	readonly outcome: SuggestionOutcome;
	readonly latencyMs: number;
}

export interface SuggestionRequestExtras {
	readonly caps?: SuggestionCapsPlan;
	readonly now?: () => number;
	/** Test seam for the wall-time deadline; defaults to `AbortSignal.timeout`. */
	readonly timeoutSignal?: (ms: number) => AbortSignal;
}

function reportedUsage(message: unknown): Usage | undefined {
	const usage = (message as { usage?: Usage } | undefined)?.usage;
	return usage && typeof usage === "object" && typeof usage.input === "number" ? usage : undefined;
}

/**
 * Run the background suggestion request; never throws. Without caps the
 * provider request is byte-identical to spec 091; the result now carries the
 * provider-reported usage so it can be settled as `purpose: "suggestion"`.
 */
export async function requestNextSuggestion(
	streamFn: StreamFn,
	record: RecordedMainRequest,
	finalAssistant: AssistantMessage,
	signal: AbortSignal,
	extras: SuggestionRequestExtras = {},
): Promise<SuggestionResult> {
	const now = extras.now ?? Date.now;
	const started = now();
	const caps = extras.caps;
	const deadline = caps ? (extras.timeoutSignal ?? AbortSignal.timeout)(caps.deadlineMs) : undefined;
	const link = deadline ? linkAbortSignals(signal, deadline) : undefined;
	const requestSignal = link?.signal ?? signal;
	const options = caps ? caps.options : record.options;
	const finish = (outcome: SuggestionOutcome, usage?: Usage, text?: string): SuggestionResult => {
		link?.dispose();
		const settled = deadline?.aborted && !signal.aborted ? "timeout" : signal.aborted ? "aborted" : outcome;
		return {
			...(settled === "shown" && text ? { text } : {}),
			...(usage ? { usage } : {}),
			outcome: settled,
			latencyMs: Math.max(0, now() - started),
		};
	};
	let stream: Awaited<ReturnType<StreamFn>>;
	try {
		const requestOptions = {
			...options,
			maxTokens: suggestionMaxTokens(record.model, options),
			signal: requestSignal,
		};
		stream = await streamFn(
			record.model,
			buildSuggestionContext(record, finalAssistant),
			tagRequestPurpose(requestOptions, "suggestion"),
		);
	} catch {
		return finish("error");
	}
	let result: AssistantMessage;
	try {
		result = await stream.result();
	} catch (error) {
		return finish("error", reportedUsage(error));
	}
	const usage = reportedUsage(result);
	if (requestSignal.aborted || result.stopReason === "aborted") return finish("aborted", usage);
	if (result.stopReason === "error") return finish("error", usage);
	const text = extractSuggestion(result);
	return finish(text ? "shown" : "empty", usage, text);
}
