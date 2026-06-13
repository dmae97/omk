import { describe, expect, it } from "vitest";
import { buildWorkingLoaderMessage } from "../src/modes/interactive/interactive-mode.ts";

describe("buildWorkingLoaderMessage", () => {
	it("adds thinking suffix for reasoning model with non-off level", () => {
		expect(buildWorkingLoaderMessage("Working...", true, "high")).toBe("Working... · thinking: high");
	});

	it("omits suffix when level is off", () => {
		expect(buildWorkingLoaderMessage("Working...", true, "off")).toBe("Working...");
	});

	it("omits suffix for non-reasoning model", () => {
		expect(buildWorkingLoaderMessage("Working...", false, "high")).toBe("Working...");
	});

	it("omits suffix when level is undefined", () => {
		expect(buildWorkingLoaderMessage("Working...", true, undefined)).toBe("Working...");
	});

	it("preserves custom working message base", () => {
		expect(buildWorkingLoaderMessage("Analyzing code...", true, "medium")).toBe(
			"Analyzing code... · thinking: medium",
		);
	});
});
