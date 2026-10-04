import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { retryAssistantCall } from "../src/utils/retry.ts";
import { retryBackoffDelayMs as backoff } from "../src/utils/retry-backoff.ts";

const TIMER_LIMIT_MS = 2_147_483_647;

const transient = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" });
const done = () => fauxAssistantMessage("summary");

// Compaction and branch-summary retries back off with the same `retry.baseDelayMs` as the agent
// turn. A Node timer fires a delay above 2^31 - 1 ms after 1 ms, so an uncapped exponent retried
// such a backoff at once.
afterEach(() => {
	vi.useRealTimers();
});

describe("retryAssistantCall backoff at the timer limit", () => {
	it("keeps waiting when the backoff is longer than one timer can hold", async () => {
		const scheduled: number[] = [];
		let calls = 0;
		const controller = new AbortController();
		const pending = retryAssistantCall(
			async () => (++calls === 1 ? transient() : done()),
			{ enabled: true, maxRetries: 1, baseDelayMs: 3_000_000_000 },
			controller.signal,
			{ onRetryScheduled: (_attempt, _max, delayMs) => void scheduled.push(delayMs) },
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(calls).toBe(1);
		expect(scheduled).toEqual([TIMER_LIMIT_MS]);

		controller.abort();
		// An abort during the backoff is still an aborted message, not a thrown error.
		expect((await pending).stopReason).toBe("aborted");
		expect(calls).toBe(1);
	});

	// A deadline re-armed from performance.now() never elapses under fake timers that leave the
	// clock alone; the capped delay needs one timer.
	it("finishes the backoff under fake timers that do not fake performance.now", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let calls = 0;
		const pending = retryAssistantCall(
			async () => (++calls === 1 ? transient() : done()),
			{ enabled: true, maxRetries: 1, baseDelayMs: 1000 },
			undefined,
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect((await pending).stopReason).toBe("stop");
		expect(calls).toBe(2);
	});

	it("doubles the delay once per retry below the cap", async () => {
		const scheduled: number[] = [];
		await retryAssistantCall(async () => transient(), { enabled: true, maxRetries: 3, baseDelayMs: 2 }, undefined, {
			onRetryScheduled: (_attempt, _max, delayMs) => void scheduled.push(delayMs),
		});
		expect(scheduled).toEqual([2, 4, 8]);
	});

	// `attempt >= NaN` is always false, so a count that converts to NaN never ran out of retries.
	it("does not retry when the retry count converts to NaN", async () => {
		let calls = 0;
		const result = await retryAssistantCall(
			async () => {
				if (++calls > 5) throw new Error("retried without end");
				return transient();
			},
			{ enabled: true, maxRetries: Number.NaN, baseDelayMs: 0 },
			undefined,
		);
		expect(result.stopReason).toBe("error");
		expect(calls).toBe(1);
	});

	it("removes its abort listener after each completed backoff", async () => {
		const controller = new AbortController();
		let calls = 0;
		const result = await retryAssistantCall(
			async () => (++calls < 3 ? transient() : done()),
			{ enabled: true, maxRetries: 2, baseDelayMs: 1 },
			controller.signal,
		);
		expect(result.stopReason).toBe("stop");
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});
});

describe("retryBackoffDelayMs", () => {
	it("doubles up to the timer limit", () => {
		expect(backoff(2000, 1)).toBe(2000);
		expect(backoff(2000, 21)).toBe(2000 * 2 ** 20);
		expect(backoff(2000, 22)).toBe(TIMER_LIMIT_MS);
		expect(backoff(2000, 5000)).toBe(TIMER_LIMIT_MS);
		expect(backoff(3_000_000_000, 1)).toBe(TIMER_LIMIT_MS);
		expect(backoff(Number.POSITIVE_INFINITY, 1)).toBe(TIMER_LIMIT_MS);
		expect(backoff(0, 5000)).toBe(0);
	});

	it("keeps the old arithmetic wherever it was a valid timer delay", () => {
		expect(backoff(2000, 0)).toBe(1000);
		expect(backoff(2000, 2.5)).toBe(2000 * 2 ** 1.5);
		expect(backoff("3000" as unknown as number, 2)).toBe(6000);
		let seed = 924_820;
		const next = (): number => {
			seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
			return seed / 2 ** 32;
		};
		for (let run = 0; run < 2000; run++) {
			const base = Math.floor(2 ** (next() * 36));
			const attempt = 1 + Math.floor(next() * 64);
			const exact = BigInt(base) * 2n ** BigInt(attempt - 1);
			const expected = exact > BigInt(TIMER_LIMIT_MS) ? TIMER_LIMIT_MS : Number(exact);
			expect(backoff(base, attempt)).toBe(expected);
			expect(backoff(base, attempt + 1)).toBeGreaterThanOrEqual(expected);
		}
	});

	it("uses the 2 s settings default for a base that converts to NaN or a negative number", () => {
		expect(backoff(Number.NaN, 1)).toBe(2000);
		expect(backoff(-5, 2)).toBe(4000);
		expect(backoff("abc" as unknown as number, 1)).toBe(2000);
	});
});
