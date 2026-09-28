import fc from "fast-check";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "omk-ai";
import { describe, expect, it } from "vitest";
import {
	computeRetryDelayMs,
	failoverModelKey,
	isEmptyStreamedCompletion,
	isFailoverTriggerError,
	isRetryableAssistantError,
	nextRetryAttempt,
	retryBudgetForAssistantError,
} from "../src/core/provider-retry.ts";

function errorMessage(text: string | undefined) {
	return fauxAssistantMessage([], { stopReason: "error", ...(text === undefined ? {} : { errorMessage: text }) });
}

describe("isRetryableAssistantError", () => {
	it("rejects non-error stops and missing error text", () => {
		expect(isRetryableAssistantError(errorMessage(undefined), 0)).toBe(false);
	});

	it("never retries context overflow — compaction owns that path", () => {
		expect(isRetryableAssistantError(errorMessage("maximum context length is 128000 tokens"), 128000)).toBe(false);
	});

	it("retries quota exhaustion so failover can save the turn", () => {
		expect(isRetryableAssistantError(errorMessage("usage limit reached for this cycle"), 0)).toBe(true);
	});

	it("retries transient provider errors including safety stops", () => {
		expect(isRetryableAssistantError(errorMessage("overloaded"), 0)).toBe(true);
		expect(isRetryableAssistantError(errorMessage("content/safety stop"), 0)).toBe(true);
		expect(isRetryableAssistantError(errorMessage("stop_reason=refusal"), 0)).toBe(true);
	});

	it("retries empty streamed completions — relay first-token timeout shape", () => {
		// 2026-08-22 contract change: stop=stop with zero usable output is a dead
		// stream (silent relay first-token kill on long thinking turns), not an answer.
		expect(isRetryableAssistantError(fauxAssistantMessage([]), 0)).toBe(true);
		expect(isRetryableAssistantError(fauxAssistantMessage("   "), 0)).toBe(true);
		// real output blocks disqualify
		expect(isRetryableAssistantError(fauxAssistantMessage([fauxThinking("reasoning happened")]), 0)).toBe(false);
	});

	it("rejects permanent errors", () => {
		expect(isRetryableAssistantError(errorMessage("Permission denied: read-only filesystem"), 0)).toBe(false);
	});
});

describe("isEmptyStreamedCompletion", () => {
	it("detects stop-shaped completions with no usable output", () => {
		expect(isEmptyStreamedCompletion(fauxAssistantMessage([]))).toBe(true);
		expect(isEmptyStreamedCompletion(fauxAssistantMessage("   "))).toBe(true);
		expect(isEmptyStreamedCompletion(fauxAssistantMessage([fauxText("")]))).toBe(true);
	});

	it("treats any real output block as a completed stream", () => {
		expect(isEmptyStreamedCompletion(fauxAssistantMessage([fauxText("answer")]))).toBe(false);
		expect(isEmptyStreamedCompletion(fauxAssistantMessage([fauxThinking("reasoning")]))).toBe(false);
		expect(isEmptyStreamedCompletion(fauxAssistantMessage([fauxToolCall("read", { path: "a.ts" })]))).toBe(false);
	});

	it("ignores non-stop messages — the error path owns those", () => {
		expect(isEmptyStreamedCompletion(errorMessage("overloaded"))).toBe(false);
	});
});

describe("retryBudgetForAssistantError", () => {
	it("caps refusal retries at one while preserving the configured budget for transport failures", () => {
		expect(retryBudgetForAssistantError(errorMessage("stop_reason=refusal"), 3)).toBe(1);
		expect(retryBudgetForAssistantError(errorMessage("content/safety stop"), 0)).toBe(0);
		expect(retryBudgetForAssistantError(errorMessage("overloaded"), 3)).toBe(3);
	});

	// `attempt > NaN` is always false, so a count that converts to NaN never ran out of retries.
	it("treats a retry count that converts to NaN as no retries", () => {
		expect(retryBudgetForAssistantError(errorMessage("overloaded"), Number.NaN)).toBe(0);
		expect(retryBudgetForAssistantError(errorMessage("overloaded"), "many" as unknown as number)).toBe(0);
		expect(retryBudgetForAssistantError(errorMessage("content/safety stop"), Number.NaN)).toBe(0);
		// A numeric string from hand-edited settings keeps its budget, as the old comparisons read it.
		expect(Number(retryBudgetForAssistantError(errorMessage("overloaded"), "5" as unknown as number))).toBe(5);
	});
});

describe("nextRetryAttempt", () => {
	it("stays disabled or capped without advancing", () => {
		expect(nextRetryAttempt({ enabled: false, completedAttempts: 0, maxRetries: 3 })).toBeUndefined();
		expect(nextRetryAttempt({ enabled: true, completedAttempts: 3, maxRetries: 3 })).toBeUndefined();
	});

	it("advances within budget", () => {
		expect(nextRetryAttempt({ enabled: true, completedAttempts: 0, maxRetries: 3 })).toBe(1);
		expect(nextRetryAttempt({ enabled: true, completedAttempts: 2, maxRetries: 3 })).toBe(3);
	});
});

describe("computeRetryDelayMs", () => {
	it("backs off exponentially on same-model retry", () => {
		expect(computeRetryDelayMs(1000, 1, false)).toBe(1000);
		expect(computeRetryDelayMs(1000, 3, false)).toBe(4000);
	});

	it("caps the post-failover delay because safety stops fail fast", () => {
		expect(computeRetryDelayMs(1000, 5, true)).toBe(400);
		expect(computeRetryDelayMs(100, 1, true)).toBe(100);
	});

	// A Node timer fires a delay above 2^31 - 1 ms after 1 ms, so an uncapped exponent turns a
	// late backoff into an immediate retry: attempt 22 at the 2 s default computed 4,194,304,000.
	it("stops at the timer limit instead of overflowing into an immediate retry", () => {
		expect(computeRetryDelayMs(2000, 21, false)).toBe(2000 * 2 ** 20);
		expect(computeRetryDelayMs(2000, 22, false)).toBe(2_147_483_647);
		expect(computeRetryDelayMs(2000, 5000, false)).toBe(2_147_483_647);
		expect(computeRetryDelayMs(3_000_000_000, 1, false)).toBe(2_147_483_647);
		// JSON's 1e400 parses to +Infinity: a larger setting never waits less than a smaller one.
		expect(computeRetryDelayMs(Number.POSITIVE_INFINITY, 1, false)).toBe(2_147_483_647);
		expect(computeRetryDelayMs(1e300, 1, false)).toBe(2_147_483_647);
		expect(computeRetryDelayMs(0, 5000, false)).toBe(0);
	});

	it("equals min(2^31 - 1, base * 2^(attempt - 1)) and never shrinks as attempts grow", () => {
		let belowCap = 0;
		// A base drawn on a log scale keeps many cases below the cap, where doubling is observable.
		// Integer thousandths, because fc.double piles up at its bounds and 2^(e + f) then rounds to 2^e.
		const logBase = fc
			.tuple(fc.integer({ min: 0, max: 34 }), fc.integer({ min: 0, max: 1000 }))
			.map(([exponent, thousandths]) => Math.floor(2 ** (exponent + thousandths / 1000)));
		fc.assert(
			fc.property(logBase, fc.integer({ min: 1, max: 64 }), (base, attempt) => {
				const exact = BigInt(base) * 2n ** BigInt(attempt - 1);
				const expected = exact > 2_147_483_647n ? 2_147_483_647 : Number(exact);
				if (expected < 2_147_483_647 && attempt > 1) belowCap++;
				const delay = computeRetryDelayMs(base, attempt, false);
				expect(delay).toBe(expected);
				expect(computeRetryDelayMs(base, attempt + 1, false)).toBeGreaterThanOrEqual(delay);
			}),
			{ numRuns: 1000, seed: 924_820 },
		);
		expect(belowCap).toBeGreaterThan(200);
	});

	// computeRetryDelayMs is a public export: below the cap every result matches the old arithmetic.
	it("keeps the old result wherever it was a valid timer delay, including out-of-contract attempts", () => {
		expect(computeRetryDelayMs(2000, 0, false)).toBe(1000);
		expect(computeRetryDelayMs(2000, 2.5, false)).toBe(2000 * 2 ** 1.5);
		// A numeric string from hand-edited settings converts as the old arithmetic did.
		expect(computeRetryDelayMs("3000" as unknown as number, 2, false)).toBe(6000);
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 1e10, noNaN: true }),
				fc.integer({ min: 1, max: 64 }),
				(base, attempt) => {
					const old = base * 2 ** (attempt - 1);
					expect(computeRetryDelayMs(base, attempt, false)).toBe(old <= 2_147_483_647 ? old : 2_147_483_647);
				},
			),
			{ numRuns: 1000, seed: 924_820 },
		);
	});

	it("uses the documented 2 s base when the setting converts to NaN or a negative number", () => {
		expect(computeRetryDelayMs(Number.NaN, 1, false)).toBe(2000);
		expect(computeRetryDelayMs(-5, 2, false)).toBe(4000);
		expect(computeRetryDelayMs("abc" as unknown as number, 1, false)).toBe(2000);
		expect(computeRetryDelayMs(Number.NaN, 1, true)).toBe(400);
	});
});

describe("isFailoverTriggerError", () => {
	it("triggers on safety stops and quota exhaustion", () => {
		expect(isFailoverTriggerError("content/safety stop")).toBe(true);
		expect(isFailoverTriggerError("usage limit reached for this cycle")).toBe(true);
	});

	it("does not trigger on plain transient or permanent errors", () => {
		expect(isFailoverTriggerError("overloaded")).toBe(false);
		expect(isFailoverTriggerError("Permission denied")).toBe(false);
		expect(isFailoverTriggerError(undefined)).toBe(false);
	});
});

describe("failoverModelKey", () => {
	it("builds the provider/id bookkeeping key", () => {
		expect(failoverModelKey("anthropic", "claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
		expect(failoverModelKey("xai", "grok-4.5")).toBe("xai/grok-4.5");
	});
});
