import { describe, expect, it } from "bun:test";
import planModeApprovedPrompt from "@oh-my-pi/pi-coding-agent/prompts/system/plan-mode-approved.md" with {
	type: "text",
};
import { prompt } from "@oh-my-pi/pi-utils";

describe("plan-mode-approved prompt", () => {
	it("includes final plan artifact path in injected execution prompt", () => {
		const rendered = prompt.render(planModeApprovedPrompt, {
			planContent: "1. Do work",
			finalPlanFilePath: "local://WP_MIGRATION_PLAN.md",
		});

		expect(rendered).toContain("local://WP_MIGRATION_PLAN.md");
	});
});
