/**
 * Per-response reasoning cap (spec 033).
 *
 * A thinking stream that keeps emitting deltas never trips the HTTP idle
 * timeout, so one runaway response can eat most of a timed run. When enabled
 * (`OMK_RESPONSE_REASONING_CAP=1`), this wrapper aborts a response that passes
 * the reasoning-token or wall-time cap before it starts answering, and retries
 * it once at one lower reasoning effort. The retry is measured, not cut.
 */
import type { StreamFn } from "omk-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageDiagnostic,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type ThinkingLevel,
	type Usage,
} from "omk-ai";
import { getActiveRemainingBudget, type RemainingBudget } from "./remaining-budget.ts";
import { logReasoningCapRetry, type ReasoningCapDetails } from "./response-reasoning-cap-run-log.ts";

export const DEFAULT_RESPONSE_REASONING_CAP_TOKENS = 20_000;
export const DEFAULT_RESPONSE_WALL_CAP_MS = 240_000;
/** Share of the run budget one response may use before it is cut. */
export const RESPONSE_WALL_CAP_BUDGET_FRACTION = 0.15;
export const RESPONSE_WALL_CAP_FLOOR_MS = 30_000;

export const RESPONSE_CAP_RETRY_DIAGNOSTIC = "response_reasoning_cap_retry";
export const RESPONSE_CAP_OVERRUN_AFTER_RETRY_DIAGNOSTIC = "response_reasoning_cap_overrun_after_retry";

export type ResponseCapReason = "reasoning_tokens" | "wall_time";

export interface ResponseReasoningCapConfig {
	readonly maxReasoningTokens: number;
	/** Fixed wall cap; the live cap may be lower when a RemainingBudget clock is active. */
	readonly maxWallMs: number;
	/** Shared run clock (#63). Read on every attempt so the cap shrinks as the run goes on. */
	readonly budget?: () => RemainingBudget | undefined;
}

const LOWER_EFFORT: Record<ThinkingLevel, ThinkingLevel | undefined> = {
	ultra: "xhigh",
	max: "xhigh",
	xhigh: "high",
	high: "medium",
	medium: "low",
	low: "minimal",
	minimal: undefined,
};

export function lowerReasoningEffort(level: ThinkingLevel | undefined): ThinkingLevel | undefined {
	return level === undefined ? undefined : LOWER_EFFORT[level];
}

function positiveNumber(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** `undefined` means the feature is off and the stream function must be left untouched. */
export function resolveResponseReasoningCapConfig(
	env: NodeJS.ProcessEnv = process.env,
): ResponseReasoningCapConfig | undefined {
	if (env.OMK_RESPONSE_REASONING_CAP !== "1") return undefined;
	return {
		maxReasoningTokens: Math.floor(
			positiveNumber(env.OMK_RESPONSE_REASONING_CAP_TOKENS, DEFAULT_RESPONSE_REASONING_CAP_TOKENS),
		),
		maxWallMs: Math.round(positiveNumber(env.OMK_RESPONSE_WALL_CAP_SEC, DEFAULT_RESPONSE_WALL_CAP_MS / 1000) * 1000),
		// Read-only: the clock is started at run start (spec 036), so both A/B arms share one origin.
		budget: () => getActiveRemainingBudget(),
	};
}

/** `min(cap, 15% of budget, remaining − reserve)`, floored at 30 s, when a run clock is active. */
export function resolveResponseWallCapMs(maxWallMs: number, budget: RemainingBudget | undefined): number {
	if (!budget) return maxWallMs;
	const byBudget = Math.min(
		budget.budgetMs * RESPONSE_WALL_CAP_BUDGET_FRACTION,
		budget.remainingMs() - budget.reserveMs(),
	);
	return Math.round(Math.min(maxWallMs, Math.max(RESPONSE_WALL_CAP_FLOOR_MS, byBudget)));
}

interface AttemptOutcome {
	readonly capped?: ResponseCapReason;
	readonly overrun?: ResponseCapReason;
	readonly reasoningTokens: number;
	readonly elapsedMs: number;
	readonly message: AssistantMessage;
}

/**
 * Final usage after a retry. Token fields stay the retry's own: compaction reads
 * `totalTokens` (or the sum of the token fields) as the context size, and summing
 * would make the context look up to 2x. Only cost is summed, since both requests are billed.
 */
export function mergeRetryUsage(retry: Usage, aborted: Usage): Usage {
	return {
		...retry,
		cost: {
			input: retry.cost.input + aborted.cost.input,
			output: retry.cost.output + aborted.cost.output,
			cacheRead: retry.cost.cacheRead + aborted.cost.cacheRead,
			cacheWrite: retry.cost.cacheWrite + aborted.cost.cacheWrite,
			total: retry.cost.total + aborted.cost.total,
		},
	};
}

/**
 * Wrap a StreamFn with the per-response cap. Pass the config from
 * {@link resolveResponseReasoningCapConfig}; with `undefined` the inner function is returned as is.
 */
export function createResponseReasoningCapStreamFn(
	inner: StreamFn,
	config: ResponseReasoningCapConfig | undefined,
): StreamFn {
	if (!config) return inner;
	return async (model, context, options) => {
		const callerSignal = options?.signal;
		const firstEffort = options?.reasoning;
		const retryEffort = lowerReasoningEffort(firstEffort);
		const controller = new AbortController();
		const linkAbort = () => controller.abort(callerSignal?.reason);
		if (callerSignal?.aborted) linkAbort();
		else callerSignal?.addEventListener("abort", linkAbort, { once: true });
		// The first call stays awaited here so setup errors (auth) surface exactly as before,
		// but the caller-signal link must not outlive a throw (review #96 M2).
		let first: AssistantMessageEventStream;
		try {
			first = await inner(model, context, { ...options, signal: controller.signal });
		} catch (error) {
			callerSignal?.removeEventListener("abort", linkAbort);
			throw error;
		}
		const out = createAssistantMessageEventStream();

		const capMs = () => resolveResponseWallCapMs(config.maxWallMs, config.budget?.());
		const runAttempt = async (
			response: AssistantMessageEventStream,
			enforce: boolean,
			forwardStart: boolean,
			abort: () => void,
		): Promise<AttemptOutcome> => {
			const startedAt = Date.now();
			const wallCapMs = capMs();
			let thinkingChars = 0;
			let reasoningTokens = 0;
			let answering = false;
			let hit: ResponseCapReason | undefined;
			const trip = (reason: ResponseCapReason) => {
				if (hit || answering) return;
				hit = reason;
				if (enforce) abort();
			};
			const timer = setTimeout(() => trip("wall_time"), wallCapMs);
			try {
				for await (const event of response) {
					if (hit && enforce) continue; // drain the aborted attempt without forwarding it
					if (event.type === "text_start" || event.type === "toolcall_start") answering = true;
					if (event.type === "thinking_delta") thinkingChars += event.delta.length;
					if (!answering && "partial" in event) {
						reasoningTokens = Math.max(Math.ceil(thinkingChars / 4), event.partial.usage?.output ?? 0);
						if (reasoningTokens > config.maxReasoningTokens) trip("reasoning_tokens");
						if (hit && enforce) continue;
					}
					if (event.type === "start" && !forwardStart) continue;
					if (event.type === "done" || event.type === "error") continue;
					out.push(event as AssistantMessageEvent);
				}
			} finally {
				clearTimeout(timer);
			}
			const message = await response.result();
			const elapsedMs = Date.now() - startedAt;
			return enforce && hit
				? { capped: hit, reasoningTokens, elapsedMs, message }
				: { overrun: hit, reasoningTokens, elapsedMs, message };
		};

		const finish = (message: AssistantMessage) => {
			const reason = message.stopReason;
			if (reason === "aborted" || reason === "error") out.push({ type: "error", reason, error: message });
			else out.push({ type: "done", reason, message });
			out.end(message);
		};
		const capDetails = (
			outcome: AttemptOutcome,
			reason: ResponseCapReason,
			wallCapMs: number,
		): ReasoningCapDetails => ({
			reason,
			fromEffort: firstEffort,
			toEffort: retryEffort,
			reasoningTokens: outcome.reasoningTokens,
			elapsedMs: outcome.elapsedMs,
			capTokens: config.maxReasoningTokens,
			capMs: wallCapMs,
		});
		const diagnostic = (type: string, details: ReasoningCapDetails, extra?: Record<string, unknown>) =>
			({ type, timestamp: Date.now(), details: { ...details, ...extra } }) satisfies AssistantMessageDiagnostic;

		void (async () => {
			try {
				const firstCapMs = capMs();
				const firstOutcome = await runAttempt(first, retryEffort !== undefined, true, () => controller.abort());
				if (!firstOutcome.capped || callerSignal?.aborted) {
					finish(firstOutcome.message);
					return;
				}
				const retryDetails = capDetails(firstOutcome, firstOutcome.capped, firstCapMs);
				// spec 042 run log: one `retry` line now, exactly one terminal line below (or in the catch).
				const retryLog = logReasoningCapRetry(retryDetails, firstOutcome.message.usage);
				const retryController = new AbortController();
				const linkRetry = () => retryController.abort(callerSignal?.reason);
				callerSignal?.addEventListener("abort", linkRetry, { once: true });
				try {
					const retry = await inner(model, context, {
						...options,
						reasoning: retryEffort,
						signal: retryController.signal,
					});
					const retryCapMs = capMs();
					const retryOutcome = await runAttempt(retry, false, false, () => {});
					const overrunDetails = retryOutcome.overrun
						? capDetails(retryOutcome, retryOutcome.overrun, retryCapMs)
						: undefined;
					retryLog.end(retryOutcome.message.usage, retryOutcome.message.stopReason, overrunDetails);
					const diagnostics = [
						...(retryOutcome.message.diagnostics ?? []),
						diagnostic(RESPONSE_CAP_RETRY_DIAGNOSTIC, retryDetails, {
							abortedAttemptUsage: firstOutcome.message.usage,
						}),
					];
					if (overrunDetails) {
						diagnostics.push(diagnostic(RESPONSE_CAP_OVERRUN_AFTER_RETRY_DIAGNOSTIC, overrunDetails));
					}
					finish({
						...retryOutcome.message,
						usage: mergeRetryUsage(retryOutcome.message.usage, firstOutcome.message.usage),
						diagnostics,
					});
				} catch (error) {
					// The retry threw or its stream failed: still close the `retry` line (no-op if already ended).
					retryLog.end(undefined, callerSignal?.aborted ? "aborted" : "error");
					throw error;
				} finally {
					callerSignal?.removeEventListener("abort", linkRetry);
				}
			} catch (error) {
				const message: AssistantMessage = {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: callerSignal?.aborted ? "aborted" : "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				};
				finish(message);
			} finally {
				callerSignal?.removeEventListener("abort", linkAbort);
			}
		})();
		return out;
	};
}
