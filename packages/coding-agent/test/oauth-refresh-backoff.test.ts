import { describe, expect, it } from "vitest";
import { OAuthRefreshBackoff } from "../src/core/oauth-refresh-backoff.ts";

describe("OAuthRefreshBackoff", () => {
	function backoffAt(startMs = 0) {
		const clock = { nowMs: startMs };
		return { clock, backoff: new OAuthRefreshBackoff(() => clock.nowMs) };
	}

	it("defers nothing before a refresh has failed", () => {
		const { backoff } = backoffAt();
		expect(backoff.isDeferred("kimi-code", "refresh-a")).toBe(false);
	});

	it("defers the failed refresh token for a minute, then lets one attempt through", () => {
		const { backoff, clock } = backoffAt();
		backoff.recordFailure("kimi-code", "refresh-a");

		clock.nowMs = 59_999;
		expect(backoff.isDeferred("kimi-code", "refresh-a")).toBe(true);
		clock.nowMs = 60_000;
		expect(backoff.isDeferred("kimi-code", "refresh-a")).toBe(false);
	});

	it("doubles the wait with each consecutive failure up to thirty minutes", () => {
		const { backoff, clock } = backoffAt();
		const waits: number[] = [];
		for (let failure = 0; failure < 8; failure++) {
			backoff.recordFailure("kimi-code", "refresh-a");
			const failedAt = clock.nowMs;
			let waitMs = 0;
			while (backoff.isDeferred("kimi-code", "refresh-a")) {
				waitMs += 60_000;
				clock.nowMs = failedAt + waitMs;
			}
			waits.push(waitMs / 60_000);
		}
		expect(waits).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
	});

	it("does not defer a different refresh token: a new login or another account starts fresh", () => {
		const { backoff } = backoffAt();
		backoff.recordFailure("kimi-code", "refresh-a");
		backoff.recordFailure("kimi-code", "refresh-a");

		expect(backoff.isDeferred("kimi-code", "refresh-b")).toBe(false);
		backoff.recordFailure("kimi-code", "refresh-b");
		expect(backoff.isDeferred("kimi-code", "refresh-a")).toBe(false);
	});

	it("keeps providers apart and forgets a provider once its refresh succeeds", () => {
		const { backoff } = backoffAt();
		backoff.recordFailure("kimi-code", "refresh-a");
		expect(backoff.isDeferred("meta", "refresh-a")).toBe(false);

		backoff.clear("kimi-code");
		expect(backoff.isDeferred("kimi-code", "refresh-a")).toBe(false);
	});
});
