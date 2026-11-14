import { describe, expect, it } from "vitest";
import { deriveSchedulerFields } from "../src/core/loadouts.ts";

describe("lane scheduler grant safety", () => {
	it("serializes a product writer whose write scope is unknown", () => {
		expect(deriveSchedulerFields({ role: "executor" }).parallelizable).toBe(false);
	});

	it("keeps read-only lanes parallelizable", () => {
		expect(deriveSchedulerFields({ role: "explorer", assignedReadPaths: ["src"] }).parallelizable).toBe(true);
	});

	it("keeps declared write-scoped lanes serialized until disjointness is enforced", () => {
		expect(deriveSchedulerFields({ role: "executor", assignedWritePaths: ["src/a"] }).parallelizable).toBe(false);
	});
});
