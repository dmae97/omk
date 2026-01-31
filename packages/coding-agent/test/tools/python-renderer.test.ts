import { describe, expect, it } from "bun:test";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { pythonToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/python";

describe("pythonToolRenderer", () => {
	it("renders truncated output when collapsed and full output when expanded", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const fullOutput = ["line 1", "line 2", "line 3", "line 4"].join("\n");

		const result = {
			content: [{ type: "text", text: fullOutput }],
			details: {
				cells: [
					{
						index: 0,
						title: "run",
						code: "print('hello')",
						output: fullOutput,
						status: "complete" as const,
						durationMs: 12,
					},
				],
			},
		};

		const collapsed = pythonToolRenderer.renderResult(
			result,
			{ expanded: false, isPartial: false, renderContext: { previewLines: 2 } },
			uiTheme,
		);
		const collapsedLines = Bun.stripANSI(collapsed.render(80).join("\n"));
		expect(collapsedLines).toContain("line 4");
		expect(collapsedLines).not.toContain("line 1");
		expect(collapsedLines).toContain("more lines");

		const expanded = pythonToolRenderer.renderResult(result, { expanded: true, isPartial: false }, uiTheme);
		const expandedLines = Bun.stripANSI(expanded.render(80).join("\n"));
		expect(expandedLines).toContain("line 1");
		expect(expandedLines).toContain("line 4");
		expect(expandedLines).not.toContain("more lines");
	});
});
