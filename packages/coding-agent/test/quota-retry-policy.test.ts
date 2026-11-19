import { describe, expect, it } from "vitest";
import {
	isRateLimitError,
	MAX_RETRY_WAIT_MS,
	planRetryWait,
	QuotaExhaustedNoRetryError,
	quotaAllowsRetry,
	quotaRetryAction,
	retryAfterHintMs,
	retryWaitMs,
	summarizationRetryPolicy,
} from "../src/core/quota-retry-policy.ts";

const QUOTA = "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).";

describe("spec 090 quota retry policy", () => {
	it("separates quota exhaustion from a transient 429 using the existing classifier", () => {
		expect(quotaRetryAction(QUOTA, true)).toBe("failover");
		expect(quotaRetryAction(QUOTA, false)).toBe("end");
		expect(quotaRetryAction("429 Too Many Requests", true)).toBe("not_quota");
		expect(quotaRetryAction("429 Too Many Requests", false)).toBe("not_quota");
		expect(quotaRetryAction(undefined, true)).toBe("not_quota");
	});

	it("types the no-retry quota error", () => {
		const error = new QuotaExhaustedNoRetryError(QUOTA);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("QuotaExhaustedNoRetryError");
		expect(error.code).toBe("quota_exhausted");
		expect(error.retryable).toBe(false);
		expect(error.message).toContain("quota exhausted, no retry");
	});

	it("parses Retry-After hints from provider error text", () => {
		expect(retryAfterHintMs("429 Too Many Requests. Retry-After: 2")).toBe(2000);
		expect(retryAfterHintMs("please retry after 600 seconds")).toBe(600_000);
		expect(retryAfterHintMs("Rate limited. Try again in 1.5s")).toBe(1500);
		expect(retryAfterHintMs("retry-after-ms: 250")).toBe(250);
		expect(retryAfterHintMs("overloaded_error")).toBeUndefined();
		expect(retryAfterHintMs(undefined)).toBeUndefined();
	});

	it("waits 0 on quota failover, caps Retry-After at 60s, leaves backoff unchanged", () => {
		expect(MAX_RETRY_WAIT_MS).toBe(60_000);
		expect(retryWaitMs({ quotaFailover: true, backoffMs: 4000, errorMessage: QUOTA })).toBe(0);
		expect(retryWaitMs({ quotaFailover: false, backoffMs: 4000, errorMessage: "529 overloaded" })).toBe(4000);
		expect(retryWaitMs({ quotaFailover: false, backoffMs: 4000, errorMessage: "429 retry after 2" })).toBe(2000);
		expect(retryWaitMs({ quotaFailover: false, backoffMs: 4000, errorMessage: "429 retry after 999" })).toBe(60_000);
		expect(retryWaitMs({ quotaFailover: false, backoffMs: 500_000, errorMessage: "529" })).toBe(500_000);
		expect(retryWaitMs({ quotaFailover: false, backoffMs: 4000, errorMessage: "529", remainingMs: 100 })).toBe(100);
	});
});

describe("spec 090 session retry gate", () => {
	const msg = (errorMessage: string) => ({ stopReason: "error", errorMessage }) as never;

	it("allows quota retry only when quota failover is on", () => {
		expect(quotaAllowsRetry(QUOTA, { autoFailoverOnQuotaExhaustion: false })).toBe(false);
		expect(quotaAllowsRetry(QUOTA, { autoFailoverOnQuotaExhaustion: true })).toBe(true);
		expect(quotaAllowsRetry(QUOTA, undefined)).toBe(true);
		expect(quotaAllowsRetry("429 Too Many Requests", { autoFailoverOnQuotaExhaustion: false })).toBe(true);
	});

	it("ends quota without failover and keeps the backoff formula for other errors", () => {
		const settings = { baseDelayMs: 2000 };
		expect(planRetryWait(msg(QUOTA), settings, 1, undefined, undefined, undefined)).toBeUndefined();
		expect(planRetryWait(msg(QUOTA), settings, 1, "deepseek/x", undefined, undefined)).toBe(0);
		expect(planRetryWait(msg("529 overloaded"), settings, 1, undefined, undefined, undefined)).toBe(2000);
		expect(planRetryWait(msg("529 overloaded"), settings, 3, undefined, undefined, undefined)).toBe(8000);
		expect(planRetryWait(msg("529 overloaded"), settings, 6, undefined, undefined, undefined)).toBe(64_000);
		expect(planRetryWait(msg("502 bad gateway"), settings, 3, undefined, "r/x", undefined)).toBe(400);
	});
});

describe("rate-limit retry waits", () => {
	const msg = (errorMessage: string) => ({ stopReason: "error", errorMessage }) as never;
	const settings = { baseDelayMs: 2000 };
	// Observed 2026-11-11 on five sessions sharing one account: the body carries no Retry-After,
	// the three retries were spent 14 s after the first 429, and the limit lifted within a minute.
	const RATE_LIMIT =
		'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your' +
		' account\'s rate limit. Please try again later."},"request_id":"req_x"}';
	const plan = (text: string, attempt: number, random: number, switchedTo?: string) =>
		planRetryWait(msg(text), settings, attempt, undefined, switchedTo, undefined, () => random);

	it("spreads the default retry budget over more than a minute", () => {
		const longest = [1, 2, 3].map((attempt) => plan(RATE_LIMIT, attempt, 0));
		expect(longest).toEqual([16_000, 32_000, 60_000]);
		const shortest = [1, 2, 3].map((attempt) => plan(RATE_LIMIT, attempt, 0.999999) ?? 0);
		expect(shortest.reduce((sum, wait) => sum + wait, 0)).toBeGreaterThan(75_000);
		for (const [index, wait] of shortest.entries()) expect(wait).toBeLessThan(longest[index] ?? 0);
	});

	it("recognizes rate limits and leaves quota exhaustion to failover", () => {
		expect(isRateLimitError(RATE_LIMIT)).toBe(true);
		expect(isRateLimitError("429 Too Many Requests")).toBe(true);
		expect(isRateLimitError("org_rate_limit reached")).toBe(true);
		expect(isRateLimitError("529 overloaded")).toBe(false);
		expect(isRateLimitError("503 Upstream request failed")).toBe(false);
		expect(isRateLimitError(QUOTA)).toBe(false);
		expect(isRateLimitError(undefined)).toBe(false);
	});

	it("keeps a provider Retry-After, a switched route and a zero base as they were", () => {
		expect(plan("429 Too Many Requests. Retry-After: 2", 1, 0)).toBe(2000);
		expect(plan(RATE_LIMIT, 1, 0, "route/x")).toBe(400);
		expect(planRetryWait(msg(RATE_LIMIT), { baseDelayMs: 0 }, 2, undefined, undefined, undefined, () => 0)).toBe(0);
		expect(planRetryWait(msg(RATE_LIMIT), settings, 1, undefined, undefined, 5000, () => 0)).toBe(5000);
	});

	it("gives summarization retries the same waits", () => {
		const policy = summarizationRetryPolicy({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }, () => 0);
		expect(policy).toMatchObject({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
		expect(policy.delayMs?.(2000, RATE_LIMIT)).toBe(16_000);
		expect(policy.delayMs?.(4000, RATE_LIMIT)).toBe(32_000);
		expect(policy.delayMs?.(2000, "terminated")).toBe(2000);
		expect(policy.delayMs?.(2000, "429 Too Many Requests. Retry-After: 3")).toBe(3000);
		expect(policy.delayMs?.(0, RATE_LIMIT)).toBe(0);
	});

	it("never shortens a backoff that is already past the cap", () => {
		expect(plan(RATE_LIMIT, 6, 0.999999)).toBe(64_000);
	});
});
