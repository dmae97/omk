import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep } from "../src/utils/sleep.ts";

const TIMER_LIMIT_MS = 2_147_483_647;

afterEach(() => {
	vi.useRealTimers();
});

describe("sleep", () => {
	// Node fires a timer longer than 2^31 - 1 ms after 1 ms. Real timers show the early wake.
	it("does not wake early for a delay longer than one timer can hold", async () => {
		const controller = new AbortController();
		let settled = false;
		const pending = sleep(TIMER_LIMIT_MS + 1, controller.signal).then(
			() => {
				settled = true;
			},
			() => undefined,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(settled).toBe(false);
		controller.abort();
		await pending;
	});

	it("wakes at the full delay after re-arming past the timer limit", async () => {
		vi.useFakeTimers();
		let settled = false;
		const pending = sleep(TIMER_LIMIT_MS + 10).then(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(TIMER_LIMIT_MS);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(9);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(settled).toBe(true);
	});

	it("rejects when aborted during a later chunk", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const pending = sleep(TIMER_LIMIT_MS + 10, controller.signal);
		const outcome = pending.then(
			() => "resolved",
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
		await vi.advanceTimersByTimeAsync(TIMER_LIMIT_MS + 5);
		controller.abort();
		expect(await outcome).toBe("Aborted");
		// The chunk armed after the first one is cleared too; a stale handle would keep the process alive.
		expect(vi.getTimerCount()).toBe(0);
	});

	// Node warns about a negative or NaN timer only once per process, so check the delays themselves.
	it("never hands the timer a negative or NaN delay", async () => {
		const timer = vi.spyOn(globalThis, "setTimeout");
		try {
			await sleep(-5);
			await sleep(Number.NaN);
			const delays = timer.mock.calls.map(([, delay]) => delay);
			expect(delays.length).toBeGreaterThanOrEqual(2);
			expect(delays.every((delay) => typeof delay === "number" && Number.isFinite(delay) && delay >= 0)).toBe(true);
		} finally {
			timer.mockRestore();
		}
	});

	it("rejects at once when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(sleep(10, controller.signal)).rejects.toThrow("Aborted");
	});

	it("removes its abort listener once it resolves", async () => {
		const controller = new AbortController();
		await sleep(1, controller.signal);
		await sleep(1, controller.signal);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});
});
