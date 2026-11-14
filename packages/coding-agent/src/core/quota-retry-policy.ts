/**
 * Spec 090: quota exhaustion gets zero retry waits.
 *
 * Quota/billing exhaustion is classified by {@link classifyProviderError}
 * (`kind: "quota_exhausted"`), which keeps it apart from a transient 429
 * (`rate_limit` / `transient_transport`). Same-model retry cannot heal an
 * exhausted quota, so the turn either fails over at once (when
 * `providerResilience.autoFailoverOnQuotaExhaustion` is on, pinned or not) or
 * ends at once with {@link QuotaExhaustedNoRetryError}. Other retryable errors
 * keep the exponential backoff and honor a Retry-After hint, capped at
 * {@link MAX_RETRY_WAIT_MS}. A rate limit with no hint waits longer than that
 * backoff; see {@link rateLimitBackoffMs}.
 */
import type { AssistantMessage, RetryPolicy } from "omk-ai";
import { hasStatusCodeLike } from "omk-ai";
import { classifyProviderError } from "./provider-error-classification.ts";
import {
	isUpstreamUnavailableMessage,
	type ProviderResilienceSettings,
	resolveProviderResilience,
} from "./provider-resilience.ts";
import { computeRetryDelayMs, isEmptyStreamedCompletion } from "./provider-retry.ts";
import { appendRunLog } from "./run-log.ts";

export const MAX_RETRY_WAIT_MS = 60_000;

export type QuotaRetryAction = "not_quota" | "failover" | "end";

/** Typed terminal error: quota exhausted, no retry. */
export class QuotaExhaustedNoRetryError extends Error {
	readonly code = "quota_exhausted";
	readonly retryable = false;
	readonly providerMessage: string;

	constructor(providerMessage: string) {
		super(`quota exhausted, no retry: ${providerMessage}`, { cause: providerMessage });
		this.name = "QuotaExhaustedNoRetryError";
		this.providerMessage = providerMessage;
	}
}

export function isQuotaExhaustedError(errorMessage: string | undefined): boolean {
	return errorMessage !== undefined && classifyProviderError({ text: errorMessage }).kind === "quota_exhausted";
}

export function quotaRetryAction(errorMessage: string | undefined, autoFailoverOnQuota: boolean): QuotaRetryAction {
	if (!isQuotaExhaustedError(errorMessage)) return "not_quota";
	return autoFailoverOnQuota ? "failover" : "end";
}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000 };

/** Retry-After hint carried in provider error text, in milliseconds. */
export function retryAfterHintMs(errorMessage: string | undefined): number | undefined {
	if (!errorMessage) return undefined;
	const ms = /retry[-_ ]after[-_ ]ms["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(errorMessage);
	if (ms) return Math.round(Number(ms[1]));
	const match =
		/retry[-_ ]after["']?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|secs?|seconds?|s)?\b/i.exec(errorMessage) ??
		/(?:try again|retry) in\s+(\d+(?:\.\d+)?)\s*(ms|secs?|seconds?|s)\b/i.exec(errorMessage);
	if (!match) return undefined;
	const value = Number(match[1]) * UNIT_MS[(match[2] ?? "s").toLowerCase()];
	return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** A rate-limited retry waits this many times the configured backoff, up to {@link MAX_RETRY_WAIT_MS}. */
export const RATE_LIMIT_BACKOFF_FACTOR = 8;

/** Share of a rate-limit wait that jitter may take off. */
const RATE_LIMIT_JITTER = 0.25;

/** Provider throttling that the next request may clear: a 429 or `rate_limit_error`, never an exhausted quota. */
export function isRateLimitError(errorMessage: string | undefined): boolean {
	if (!errorMessage || isQuotaExhaustedError(errorMessage)) return false;
	return /rate.?limit|too many requests/i.test(errorMessage) || hasStatusCodeLike(errorMessage, [429]);
}

/**
 * Backoff for a rate limit that came without a Retry-After hint.
 *
 * Observed 2026-11-11: five sessions on one account were throttled together. With `maxRetries: 3`
 * the 2 s, 4 s and 8 s backoff spent every retry 14 s after the first 429 and each turn ended,
 * though the prompt the user typed next went through. Three retries at the 2 s base now span 81
 * to 108 s, and the jitter keeps sessions that were throttled together from retrying together.
 * `randomValue` is a draw from [0, 1). A backoff already past the cap is returned unchanged.
 */
export function rateLimitBackoffMs(backoffMs: number, randomValue: number): number {
	const stretched = Math.min(backoffMs * RATE_LIMIT_BACKOFF_FACTOR, MAX_RETRY_WAIT_MS);
	return Math.max(backoffMs, Math.round(stretched * (1 - randomValue * RATE_LIMIT_JITTER)));
}

/** One retry wait: 0 after a quota failover, else Retry-After (capped at 60s) or backoff, within the run budget. */
export function retryWaitMs(input: {
	readonly quotaFailover: boolean;
	readonly backoffMs: number;
	readonly errorMessage: string | undefined;
	readonly remainingMs?: number;
}): number {
	if (input.quotaFailover) return 0;
	// The 60 s cap bounds provider-directed Retry-After waits; the configured
	// exponential backoff is left as-is (its default never reaches 60 s).
	const hint = retryAfterHintMs(input.errorMessage);
	const requested = hint === undefined ? input.backoffMs : Math.min(hint, MAX_RETRY_WAIT_MS);
	return Math.min(requested, input.remainingMs ?? Number.POSITIVE_INFINITY);
}

/**
 * `settings.retry` for the summarization retry loop in omk-ai, which compaction and branch summaries
 * use. Their calls go to the same account as the agent turn, so a rate limit and a Retry-After
 * hint get the same waits. That loop never retries quota exhaustion and has no route to switch.
 */
export function summarizationRetryPolicy(settings: RetryPolicy, random: () => number = Math.random): RetryPolicy {
	return {
		...settings,
		delayMs: (backoffMs, errorMessage) =>
			retryWaitMs({
				quotaFailover: false,
				backoffMs: isRateLimitError(errorMessage) ? rateLimitBackoffMs(backoffMs, random()) : backoffMs,
				errorMessage,
			}),
	};
}

/** Retry gate: quota exhaustion is retryable only through failover. */
export function quotaAllowsRetry(
	errorMessage: string | undefined,
	settings: ProviderResilienceSettings | undefined,
): boolean {
	const { autoFailoverOnQuotaExhaustion } = resolveProviderResilience(settings);
	return quotaRetryAction(errorMessage, autoFailoverOnQuotaExhaustion) !== "end";
}

/**
 * Wait before the next agent-turn retry, or undefined when the turn must end now:
 * quota exhaustion with no failover target never retries the same route.
 */
export function planRetryWait(
	message: AssistantMessage,
	settings: { readonly baseDelayMs: number },
	attempt: number,
	failoverTo: string | undefined,
	rotatedTo: string | undefined,
	remainingMs: number | undefined,
	random: () => number = Math.random,
): number | undefined {
	const quota = isQuotaExhaustedError(message.errorMessage);
	if (quota && failoverTo === undefined) return undefined;
	const switched = failoverTo !== undefined || rotatedTo !== undefined;
	const configuredMs = computeRetryDelayMs(settings.baseDelayMs, attempt, switched);
	// A route that was just switched to is not the one being throttled.
	const rateLimited = !switched && isRateLimitError(message.errorMessage);
	const backoffMs = rateLimited ? rateLimitBackoffMs(configuredMs, random()) : configuredMs;
	return retryWaitMs({ quotaFailover: quota, backoffMs, errorMessage: message.errorMessage, remainingMs });
}

const quotaNoRetryErrors = new WeakMap<object, QuotaExhaustedNoRetryError>();

/**
 * Settle a turn that is ending without a retry. A quota-exhausted provider
 * error ends the session with {@link QuotaExhaustedNoRetryError} (provider
 * message kept as `cause`); any other outcome clears the previous one.
 */
export function recordQuotaOutcome(
	session: object,
	message: AssistantMessage,
	settings: ProviderResilienceSettings | undefined,
): void {
	if (message.errorMessage !== undefined && isQuotaExhaustedError(message.errorMessage)) {
		const error = new QuotaExhaustedNoRetryError(message.errorMessage);
		quotaNoRetryErrors.set(session, error);
		const failover = resolveProviderResilience(settings).autoFailoverOnQuotaExhaustion;
		// Privacy (spec 042): code, route and booleans only — never the provider message text.
		appendRunLog("quota-no-retry", {
			code: error.code,
			provider: message.provider,
			model: message.model,
			failover,
			// Failover was on yet the turn still ended on quota: no usable candidate was left.
			noCandidate: failover,
		});
	} else {
		quotaNoRetryErrors.delete(session);
	}
}

/** The typed error the session's last turn ended with, if it ended on quota exhaustion. */
export function quotaNoRetryErrorOf(session: object): QuotaExhaustedNoRetryError | undefined {
	return quotaNoRetryErrors.get(session);
}

/**
 * Same-model route rotation runs before the wait is planned, so it must never
 * fire for quota exhaustion: quota only fails over, and a quota turn with no
 * failover target must end with the route unchanged.
 */
export function shouldRotateRoute(message: AssistantMessage): boolean {
	if (isQuotaExhaustedError(message.errorMessage)) return false;
	return isUpstreamUnavailableMessage(message.errorMessage) || isEmptyStreamedCompletion(message);
}
