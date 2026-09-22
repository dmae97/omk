import type { AssistantMessage } from "omk-ai";
import { Container, Markdown, Text, visibleWidth } from "omk-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function contentBlocks(component: AssistantMessageComponent): (Markdown | Text)[] {
	const container = component.children[0];
	if (!(container instanceof Container)) throw new Error("Missing assistant content container");
	return container.children.filter(
		(child): child is Markdown | Text => child instanceof Markdown || child instanceof Text,
	);
}

afterEach(() => vi.restoreAllMocks());

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("reuses real Markdown blocks and cached lines across 1000 streaming updates", () => {
		initTheme("dark");
		const tail = { type: "text", text: "tail" } as const;
		const message = createAssistantMessage([
			...Array.from({ length: 20 }, (_, i) => ({ type: "text", text: `fixed **block ${i}**` }) as const),
			{ ...tail },
		]);
		const component = new AssistantMessageComponent(message);
		const blocks = contentBlocks(component);
		const cachedLines = blocks[0].render(80);
		const seen = new Set(blocks);
		const setText = vi.spyOn(Markdown.prototype, "setText");
		component.updateContent(message);
		expect(setText).not.toHaveBeenCalled();
		for (let i = 0; i < 1000; i++) {
			message.content[20] = { type: "text", text: `tail ${i}` };
			component.updateContent(message);
			for (const block of contentBlocks(component)) seen.add(block);
		}
		expect(seen.size).toBe(21);
		expect(contentBlocks(component)[0].render(80)).toBe(cachedLines);
		expect(setText).toHaveBeenCalledTimes(1000);
		expect(component.render(80)).toEqual(new AssistantMessageComponent(message).render(80));
	});

	test("observes in-place edits and drops removed, blank, and replaced block views", () => {
		initTheme("dark");
		const text = { type: "text", text: "original" } as const;
		const message = createAssistantMessage([{ ...text }, { type: "text", text: "remove me" }]);
		const component = new AssistantMessageComponent(message);
		const original = contentBlocks(component)[0];
		const content = message.content[0];
		if (content.type !== "text") throw new Error("Expected text fixture");
		content.text = "changed **in place**";
		component.updateContent(message);
		expect(contentBlocks(component)[0]).toBe(original);
		expect(component.render(40)).toEqual(new AssistantMessageComponent(message).render(40));
		message.content = [{ type: "thinking", thinking: "reason" }];
		component.updateContent(message);
		expect(contentBlocks(component)).toHaveLength(1);
		expect(contentBlocks(component)[0]).not.toBe(original);
		message.content = [{ type: "text", text: " " }];
		component.updateContent(message);
		expect(component.render(40)).toEqual([]);
		message.content = [{ type: "text", text: "original" }];
		component.updateContent(message);
		expect(contentBlocks(component)[0]).not.toBe(original);
	});

	test("updates hidden thinking labels and changes representation when toggled", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "answer" },
		]);
		const component = new AssistantMessageComponent(message, true);
		const [hidden, answer] = contentBlocks(component);
		expect(hidden).toBeInstanceOf(Text);
		component.setHiddenThinkingLabel("Working...");
		expect(contentBlocks(component)[0]).toBe(hidden);
		expect(component.render(60).join("\n")).toContain("Working...");
		expect(component.render(60).join("\n")).not.toContain("private reasoning");
		component.setHideThinkingBlock(false);
		expect(contentBlocks(component)[0]).toBeInstanceOf(Markdown);
		expect(contentBlocks(component)[0]).not.toBe(hidden);
		expect(contentBlocks(component)[1]).toBe(answer);
		expect(component.render(60)).toEqual(new AssistantMessageComponent(message).render(60));
	});

	test("retains CJK, links, code fences, spacing and OSC markers across widths", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "분석🙂" },
			{ type: "toolCall", id: "t1", name: "read", arguments: { path: "file.ts" } },
			{ type: "thinking", thinking: "more" },
			{ type: "text", text: "[링크](https://example.com)\n\n```ts\nconst 답 = 1;\n```\n\n긴 문장🙂" },
		]);
		const component = new AssistantMessageComponent(message);
		for (const width of [80, 24, 40, 80]) {
			component.updateContent(message);
			const lines = component.render(width);
			expect(lines).toEqual(new AssistantMessageComponent(message).render(width));
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(lines.join("\n")).not.toContain(OSC133_ZONE_START);
		}
		message.content = [{ type: "thinking", thinking: "reason" }, message.content[1]];
		component.updateContent(message);
		expect(component.render(40).map((line) => line.trim())).toHaveLength(2);
	});

	test("rebuilds theme-dependent views on invalidate, including hidden labels and errors", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "reason" },
			{ type: "text", text: "**answer**" },
		]);
		message.stopReason = "error";
		message.errorMessage = "failure";
		for (const hidden of [false, true]) {
			initTheme("dark");
			const component = new AssistantMessageComponent(message, hidden);
			const before = component.render(60);
			const blocks = contentBlocks(component);
			initTheme("light");
			component.invalidate();
			expect(contentBlocks(component)[0]).not.toBe(blocks[0]);
			expect(component.render(60)).not.toEqual(before);
			expect(component.render(60)).toEqual(new AssistantMessageComponent(message, hidden).render(60));
		}
	});

	test.each([
		["aborted", undefined, "Operation aborted"],
		["aborted", "Request was aborted", "Operation aborted"],
		["aborted", "Cancelled explicitly", "Cancelled explicitly"],
		["error", undefined, "Error: Unknown error"],
		["error", "failure", "Error: failure"],
	] as const)("keeps %s status visible after updates (%s)", (stopReason, errorMessage, expected) => {
		initTheme("dark");
		const message = createAssistantMessage([{ type: "text", text: "partial answer" }]);
		const component = new AssistantMessageComponent(message);
		message.stopReason = stopReason;
		message.errorMessage = errorMessage;
		component.updateContent(message);
		expect(component.render(80).join("\n")).toContain(expected);
		expect(component.render(80)).toEqual(new AssistantMessageComponent(message).render(80));
		message.content.push({ type: "toolCall", id: "t1", name: "read", arguments: {} });
		component.updateContent(message);
		expect(component.render(80).join("\n")).not.toContain(expected);
	});
});
