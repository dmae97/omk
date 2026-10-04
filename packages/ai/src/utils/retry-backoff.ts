import { MAX_RETRY_TIMER_MS } from "./provider-retry-sleep.ts";

/** The coding-agent `retry.baseDelayMs` default, which {@link RetryPolicy} mirrors. */
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;

/**
 * Backoff before 1-indexed retry `attempt`: `baseDelayMs * 2^(attempt-1)`, capped at the longest
 * delay a Node timer holds, because a longer timer fires after 1 ms. The base converts as the old
 * arithmetic did; `+Infinity` takes the cap, and a base that converts to NaN or a negative number
 * uses the 2 s default. A NaN attempt yields the cap rather than an immediate retry.
 */
export function retryBackoffDelayMs(baseDelayMs: number, attempt: number): number {
	const requested = Number(baseDelayMs);
	// `>= 0` is false for NaN; +Infinity passes and takes the cap.
	const base = requested >= 0 ? Math.min(requested, MAX_RETRY_TIMER_MS) : DEFAULT_RETRY_BASE_DELAY_MS;
	if (base === 0) return 0;
	const delay = base * 2 ** (attempt - 1);
	return delay <= MAX_RETRY_TIMER_MS ? delay : MAX_RETRY_TIMER_MS;
}
