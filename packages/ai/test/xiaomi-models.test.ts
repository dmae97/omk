import { describe, expect, it } from "vitest";
import { getModel, getModels } from "../src/models.ts";

describe("Xiaomi MiMo models", () => {
	// models.dev dropped mimo-v2-flash from xiaomi (2026-10-26). The generator still filters it from
	// the token plans, so a re-listing upstream cannot leak it into a plan that does not bill it.
	it("keeps the current flash model on the API billing provider", () => {
		expect(getModel("xiaomi", "mimo-v2.6-flash")).toBeDefined();
	});

	it.each(["xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"] as const)(
		"omits mimo-v2-flash from %s",
		(provider) => {
			expect(getModels(provider).some((model) => model.id === "mimo-v2-flash")).toBe(false);
		},
	);
});
