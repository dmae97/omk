import { describe, expect, it } from "vitest";
import { IMAGE_MODELS } from "../src/image-models.generated.ts";

describe("image catalog pricing", () => {
	it("does not treat unknown router prices as negative token charges", () => {
		for (const model of Object.values(IMAGE_MODELS.openrouter)) {
			for (const cost of Object.values(model.cost)) {
				expect(Number.isFinite(cost), model.id).toBe(true);
				expect(cost, model.id).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
