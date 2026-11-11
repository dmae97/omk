import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermitDeadline } from "../src/core/permit-deadline.ts";

afterEach(() => vi.useRealTimers());

function expectRangeError(fn: () => void, message: string): void {
	let caught: unknown;
	try {
		fn();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(RangeError);
	expect((caught as Error).message).toBe(message);
}

describe("createPermitDeadline", () => {
	it("throws RangeError for non-positive or non-finite durations", () => {
		for (const duration of [0, -1, NaN, Infinity, -Infinity]) {
			expectRangeError(
				() => createPermitDeadline(duration, () => {}),
				"Deadline duration must be finite and positive",
			);
		}
	});

	it("throws RangeError when the clock returns a non-finite value", () => {
		for (const value of [NaN, Infinity, -Infinity]) {
			expectRangeError(
				() =>
					createPermitDeadline(
						100,
						() => {},
						() => value,
					),
				"Deadline clock must be finite",
			);
		}
	});

	it("follows the injected clock in expired()", () => {
		let t = 0;
		const clock = (): number => t;
		const deadline = createPermitDeadline(100, () => {}, clock);

		expect(deadline.expired()).toBe(false);
		t = 50;
		expect(deadline.expired()).toBe(false);
		t = 100;
		expect(deadline.expired()).toBe(true);
		t = 200;
		expect(deadline.expired()).toBe(true);

		deadline.cancel();
	});

	it("calls onExpire exactly once when the deadline elapses", async () => {
		vi.useFakeTimers();
		let t = 0;
		const clock = (): number => t;
		const onExpire = vi.fn();
		const deadline = createPermitDeadline(100, onExpire, clock);

		t = 100;
		await vi.advanceTimersByTimeAsync(100);
		expect(onExpire).toHaveBeenCalledTimes(1);

		t = 200;
		await vi.advanceTimersByTimeAsync(100);
		expect(onExpire).toHaveBeenCalledTimes(1);

		deadline.cancel();
	});

	it("re-arms instead of expiring when the clock has not reached the deadline", async () => {
		vi.useFakeTimers();
		const t = 0;
		const clock = (): number => t;
		const onExpire = vi.fn();
		const deadline = createPermitDeadline(100, onExpire, clock);

		await vi.advanceTimersByTimeAsync(100);
		expect(onExpire).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		deadline.cancel();
	});

	it("follows an early timer re-arm through actual expiration", async () => {
		vi.useFakeTimers();
		let t = 0;
		const clock = (): number => t;
		const onExpire = vi.fn();
		const deadline = createPermitDeadline(100, onExpire, clock);

		// Clock lags behind timer
		t = 60;
		await vi.advanceTimersByTimeAsync(100);
		expect(onExpire).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		// Monotonic clock reaches deadline
		t = 100;
		await vi.advanceTimersByTimeAsync(40);
		expect(onExpire).toHaveBeenCalledTimes(1);

		deadline.cancel();
	});

	it("never calls onExpire after cancel()", async () => {
		vi.useFakeTimers();
		let t = 0;
		const clock = (): number => t;
		const onExpire = vi.fn();
		const deadline = createPermitDeadline(100, onExpire, clock);

		deadline.cancel();
		t = 1000;
		await vi.advanceTimersByTimeAsync(200);
		expect(onExpire).not.toHaveBeenCalled();
	});

	it("chunks delays larger than the 32-bit setTimeout maximum", async () => {
		vi.useFakeTimers();
		const MAX = 2_147_483_647;
		let t = 0;
		const clock = (): number => t;
		const onExpire = vi.fn();
		const deadline = createPermitDeadline(MAX + 1000, onExpire, clock);

		expect(vi.getTimerCount()).toBe(1);

		t = MAX;
		await vi.advanceTimersByTimeAsync(MAX);
		expect(onExpire).not.toHaveBeenCalled();
		expect(deadline.expired()).toBe(false);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		t = MAX + 1000;
		await vi.advanceTimersByTimeAsync(1000);
		expect(onExpire).toHaveBeenCalledTimes(1);
		expect(deadline.expired()).toBe(true);

		deadline.cancel();
	});

	it("operates with default performance.now clock", async () => {
		vi.useFakeTimers();
		const onExpire = vi.fn();

		const deadline = createPermitDeadline(50, onExpire);
		expect(deadline.expired()).toBe(false);

		await vi.advanceTimersByTimeAsync(50);
		expect(deadline.expired()).toBe(true);
		expect(onExpire).toHaveBeenCalledTimes(1);

		deadline.cancel();
	});
});
