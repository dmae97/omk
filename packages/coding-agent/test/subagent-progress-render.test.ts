import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import registerSubagent from "../examples/extensions/subagent/index.ts";
import { emptyUsage, type SingleResult } from "../examples/extensions/subagent/subagent-runtime-types.ts";
import type { ExtensionAPI, ToolDefinition, ToolRenderContext } from "../src/core/extensions/types.ts";
import { getThemeByName } from "../src/modes/interactive/theme/theme.ts";

function partial(agent: string, values: Partial<SingleResult> = {}): SingleResult {
	return {
		agent,
		agentSource: "unknown",
		task: "render only",
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		...values,
	};
}

function render(results: SingleResult[], text: string, mode = "parallel"): string {
	let tool: ToolDefinition | undefined;
	registerSubagent({
		registerTool(definition: ToolDefinition) {
			tool = definition;
		},
	} as ExtensionAPI);
	const theme = getThemeByName("dark");
	if (!tool?.renderResult || !theme) throw new Error("renderer fixture unavailable");
	const context: ToolRenderContext = {
		args: {},
		toolCallId: "render-only",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: true,
		expanded: false,
		showImages: false,
		isError: false,
	};
	const component = tool.renderResult(
		{ content: [{ type: "text", text }], details: { mode, results } },
		{ isPartial: true, expanded: false },
		theme,
		context,
	);
	if (!component) throw new Error("missing partial component");
	return stripVTControlCharacters(component.render(200).join("\n"));
}

describe("subagent partial renderer without execution", () => {
	it("retains all sibling rows and the current tool call", () => {
		const first = partial("first", {
			messages: [
				fauxAssistantMessage(
					{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "example.ts" } },
					{ stopReason: "toolUse" },
				),
			],
		});
		const text = render([first, partial("second")], "Parallel: 0/2 done, 2 running...");
		expect(text).toContain("⏳ first");
		expect(text).toContain("read");
		expect(text).toContain("example.ts");
		expect(text).toContain("⏳ second");
		expect(text).not.toContain("✓");
	});

	it("separates a completed sibling from a running preview without changing receipts", () => {
		const active = partial("active", { nodeId: "B", progress: { text: "live preview", sequence: 2 } });
		const text = render([partial("done", { exitCode: 0, output: "finished" }), active], "summary", "graph");
		expect(text).toContain("✓ done");
		expect(text).toContain("finished");
		expect(text).toContain("⏳ B");
		expect(text).toContain("live preview");
		expect(active.messages).toEqual([]);
		expect(active.usage.turns).toBe(0);
	});

	it("bounds completed text shown during partial rendering", () => {
		const longText = "x".repeat(60000);
		const text = render([partial("stream", { messages: [fauxAssistantMessage(longText)] })], longText, "single");
		expect(text.length).toBeLessThan(4500);
		expect(text).toContain("⏳ stream");
	});

	it("shows a failed sibling as failed rather than running or successful", () => {
		const text = render(
			[partial("failed", { exitCode: 1, errorMessage: "closed with error" }), partial("active")],
			"summary",
		);
		expect(text).toContain("✗ failed");
		expect(text).toContain("closed with error");
		expect(text).toContain("⏳ active");
	});
});
