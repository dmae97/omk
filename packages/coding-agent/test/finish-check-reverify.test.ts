import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import { resolveFinishCheckExtraTurn, resolveFinishCheckReverify } from "../src/core/finish-check.ts";

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
