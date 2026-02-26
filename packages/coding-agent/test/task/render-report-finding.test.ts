import { describe, expect, it } from "bun:test";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { taskToolRenderer } from "../../src/task/render";
import type { TaskToolDetails } from "../../src/task/types";

describe("taskToolRenderer report_finding safety", () => {
	it("renders progress without crashing when report_finding payload is malformed", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 42,
			progress: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					status: "running",
					task: "Review patch",
					recentTools: [],
					recentOutput: [],
					toolCount: 1,
					tokens: 0,
					durationMs: 42,
					extractedToolData: {
						report_finding: [{}],
					},
				},
			],
		};

		const rendered = taskToolRenderer.renderResult(
			{
				content: [{ type: "text", text: "" }],
				details,
			},
			{ expanded: false, isPartial: true },
			uiTheme,
		);

		expect(() => rendered.render(120)).not.toThrow();
	});
});
