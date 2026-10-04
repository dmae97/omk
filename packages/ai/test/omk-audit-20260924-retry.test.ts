import { describe, expect, it } from "vitest";
import { retryProviderRequest } from "../src/utils/provider-retry.ts";
import { computeProviderRetryDelay } from "../src/utils/provider-retry-delay.ts";
import { sleepProviderRetry } from "../src/utils/provider-retry-sleep.ts";

describe("OMK 20260924 provider retry boundary", () => {
	it("does not dispatch on an already aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		await expect(
			retryProviderRequest(
				async () => {
					calls++;
					return 1;
				},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(calls).toBe(0);
	});
	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])("rejects invalid retry budget %s", async (maxRetries) => {
		let calls = 0;
		await expect(
			retryProviderRequest(
				async () => {
					calls++;
					return 1;
				},
				{ maxRetries },
			),
		).rejects.toBeInstanceOf(RangeError);
		expect(calls).toBe(0);
	});
	it("invalid delay metadata uses bounded jitter", () => {
		expect(computeProviderRetryDelay(new Headers({ "retry-after": "not-a-date" }), 0, undefined, "x", 0, 0.5)).toBe(
			437.5,
		);
	});
	it("uses a valid seconds header when the millisecond header is malformed", () => {
		expect(
			computeProviderRetryDelay(
				new Headers({ "retry-after-ms": "-1", "retry-after": "2" }),
				0,
				undefined,
				"x",
				0,
				0.5,
			),
		).toBe(2000);
		expect(
			computeProviderRetryDelay(
				new Headers({ "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" }),
				0,
				undefined,
				"x",
				Date.parse("Wed, 21 Oct 2015 07:28:00 GMT") + 1,
				0.5,
			),
		).toBe(0);
	});
	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
		"rejects invalid server-delay cap %s before dispatch",
		async (maxRetryDelayMs) => {
			let calls = 0;
			await expect(
				retryProviderRequest(
					async () => {
						calls++;
						return 1;
					},
					{ maxRetryDelayMs },
				),
			).rejects.toBeInstanceOf(RangeError);
			expect(calls).toBe(0);
		},
	);
	it("maxRetries means retries after the initial attempt", async () => {
		let calls = 0;
		const error = Object.assign(new Error("transient"), {
			status: 503,
			headers: new Headers({ "retry-after-ms": "0" }),
		});
		await expect(
			retryProviderRequest(
				async () => {
					calls++;
					throw error;
				},
				{ maxRetries: 2 },
			),
		).rejects.toBe(error);
		expect(calls).toBe(3);
	});
	it("a large delay remains cancellable rather than overflowing the timer", async () => {
		const controller = new AbortController();
		const sleep = sleepProviderRetry(3_000_000_000, controller.signal);
		controller.abort();
		await expect(sleep).rejects.toMatchObject({ name: "AbortError" });
	});
});
