import { describe, expect, it } from "vitest";
import { routesOutsideScope } from "../src/core/deferred-turn-input.ts";

describe("input scope routing", () => {
	it("keeps explicit budgets and plain text in their scope, but commands outside inference preparation", () => {
		expect(routesOutsideScope(true, undefined, false, false)).toBe(true);
		expect(routesOutsideScope(true, undefined, false, true)).toBe(true);
		expect(routesOutsideScope(true, { runBudget: { maxRequests: 1 } }, false, false)).toBe(false);
		expect(routesOutsideScope(true, { runBudget: { maxRequests: 1 } }, true, true)).toBe(false);
		expect(routesOutsideScope(false, undefined, false, false)).toBe(false);
		expect(routesOutsideScope(false, undefined, false, true)).toBe(false);
		expect(routesOutsideScope(false, undefined, true, false)).toBe(true);
		expect(routesOutsideScope(false, { streamingBehavior: "followUp" }, false, true)).toBe(true);
	});
});
