import { describe, expect, it } from "bun:test";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import planModeApprovedPrompt from "@oh-my-pi/pi-coding-agent/prompts/system/plan-mode-approved.md" with {
	type: "text",
};

describe("plan-mode-approved prompt", () => {
	it("includes final plan artifact path in injected execution prompt", () => {
		const rendered = renderPromptTemplate(planModeApprovedPrompt, {
			planContent: "1. Do work",
			finalPlanFilePath: "local://WP_MIGRATION_PLAN.md",
		});

		expect(rendered).toContain("local://WP_MIGRATION_PLAN.md");
	});
});
