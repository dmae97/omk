import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import {
	FINISH_CHECK_EXTRA_TURN_FRACTION,
	FINISH_CHECK_REVERIFY_FRACTION,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SKIP_FRACTION,
	resolveFinishCheckExtraTurn,
	resolveFinishCheckReverify,
	shouldReverify,
} from "../src/core/finish-check.ts";

// spec 032: fresh-context re-verification for early finishes.

describe("finish-check reverify: flag", () => {
	it("reads OMK_FINISH_CHECK_REVERIFY exactly like OMK_FINISH_CHECK_EXTRA_TURN", () => {
		for (const value of ["on", "1", "true", "ON", " enabled ", "enable"]) {
			expect(resolveFinishCheckReverify(value), value).toBe(true);
		}
		for (const value of [undefined, "", "off", "0", "false", "always", "yes please"]) {
			expect(resolveFinishCheckReverify(value), String(value)).toBe(false);
		}
		for (const value of ["on", "1", "off", "maybe", undefined]) {
			expect(resolveFinishCheckReverify(value)).toBe(resolveFinishCheckExtraTurn(value));
		}
	});

	it("is never passed to subagent workers, even when they opt into the finish check", () => {
		const env = subagentWorkerEnv({
			OMK_FINISH_CHECK_REVERIFY: "on",
			OMK_FINISH_CHECK_WORKERS: "1",
			OMK_TIME_BUDGET_SEC: "900",
		});
		expect(env.OMK_FINISH_CHECK_REVERIFY).toBeUndefined();
		expect(env.OMK_TIME_BUDGET_SEC).toBeUndefined();
		expect(env.OMK_FINISH_CHECK).toBe("1");
	});
});

describe("finish-check reverify: trigger", () => {
	const base = {
		enabled: true,
		hasUI: false,
		firstSettleFraction: 0.2,
		aborted: false,
		hasPendingMessages: false,
		alreadyVerified: false,
	};

	it("fires on an early first settle in a headless run with the flag on", () => {
		expect(shouldReverify(base)).toBe(true);
	});

	it("uses 0.3 as the cutoff, below the other finish-check thresholds", () => {
		expect(FINISH_CHECK_REVERIFY_FRACTION).toBe(0.3);
		expect(FINISH_CHECK_REVERIFY_FRACTION).toBeLessThan(FINISH_CHECK_SAVE_NOW_FRACTION);
		expect(FINISH_CHECK_SAVE_NOW_FRACTION).toBeLessThan(FINISH_CHECK_EXTRA_TURN_FRACTION);
		expect(FINISH_CHECK_EXTRA_TURN_FRACTION).toBeLessThan(FINISH_CHECK_SKIP_FRACTION);
		expect(shouldReverify({ ...base, firstSettleFraction: 269 / 900 })).toBe(true);
		expect(shouldReverify({ ...base, firstSettleFraction: FINISH_CHECK_REVERIFY_FRACTION })).toBe(false);
		expect(shouldReverify({ ...base, firstSettleFraction: 0.5 })).toBe(false);
	});

	it("never fires without the flag, without a budget, with a UI, after an abort or pending input, or twice", () => {
		expect(shouldReverify({ ...base, enabled: false })).toBe(false);
		expect(shouldReverify({ ...base, firstSettleFraction: undefined })).toBe(false);
		expect(shouldReverify({ ...base, hasUI: true })).toBe(false);
		expect(shouldReverify({ ...base, aborted: true })).toBe(false);
		expect(shouldReverify({ ...base, hasPendingMessages: true })).toBe(false);
		expect(shouldReverify({ ...base, alreadyVerified: true })).toBe(false);
	});
});
