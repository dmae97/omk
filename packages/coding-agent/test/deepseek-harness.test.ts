import type { AgentMessage } from "omk-agent-core";
import type { ToolResultMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { DeepSeekHarnessEngine, isDeepSeekHarnessModel } from "../src/core/deepseek-harness.ts";

function result(text = "H".repeat(5000) + "M".repeat(5000) + "T".repeat(2000)): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
		details: { fullOutputPath: "/fixture/full.txt" },
		timestamp: 1,
	};
}

const model = { provider: "deepseek", id: "deepseek-flash" };

describe("DeepSeek harness model boundary", () => {
	it.each([
		{ provider: "deepseek", id: "deepseek-reasoner" },
		{ provider: "deepseek", id: "future-native-model" },
		{ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash:free" },
		{ provider: "opencode-go", id: "deepseek-v4.1-flash" },
		{ provider: "nvidia", id: "deepseek-ai/deepseek-v3.2" },
		{ provider: "custom", id: "DeepSeek-R1-Distill-Qwen-32B" },
	])("selects known DeepSeek identities: %j", (candidate) => {
		expect(isDeepSeekHarnessModel(candidate)).toBe(true);
	});

	it.each([
		undefined,
		{ provider: "openai", id: "gpt-6-astra" },
		{ provider: "deepseek-proxy", id: "gpt-5.5" },
		{ provider: "custom", id: "not-deepseek-v4" },
		{ provider: "custom", id: "docs/deepseek-harness" },
		{ provider: "custom", id: "deepseek/auto" },
		{ provider: "opencode-go", id: "kimi-k3" },
		{ provider: "openrouter", id: "openrouter/auto" },
	])("does not infer models from provider names or substrings: %j", (candidate) => {
		expect(isDeepSeekHarnessModel(candidate)).toBe(false);
	});
});

describe("DeepSeek harness outbound projection", () => {
	it("retains full output below pressure and when pressure is unknown", () => {
		const engine = new DeepSeekHarnessEngine();
		const messages = [result()];
		for (const pressure of [undefined, null, 0, 79.99, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(engine.projectContext(messages, model, pressure)).toBe(messages);
		}
	});

	it("trims the middle once at 80%, preserving the source, ids and metadata", () => {
		const engine = new DeepSeekHarnessEngine();
		const source = result();
		const messages = [source];
		const before = structuredClone(messages);
		const projected = engine.projectContext(messages, model, 80);
		expect(projected).not.toBe(messages);
		const trimmed = projected[0];
		expect(trimmed).toMatchObject({ ...source, content: [{ type: "text", text: expect.any(String) }] });
		if (trimmed.role !== "toolResult" || trimmed.content[0].type !== "text") throw new Error("Expected text result");
		expect(trimmed.content[0].text).toMatch(/^H{4096}\n\n\[deepseek_harness:/);
		expect(trimmed.content[0].text).toMatch(/T{1024}$/);
		expect(trimmed.content[0].text).not.toContain("MMMM");
		expect(Array.from(trimmed.content[0].text).length).toBeLessThanOrEqual(8192);
		expect(messages).toEqual(before);
		expect(trimmed.details).toBe(source.details);
		// Keep an already projected prefix stable even after measured pressure drops.
		expect(engine.projectContext(messages, model, 10)[0]).toBe(trimmed);
		expect(engine.projectContext(projected, model, 90)).toBe(projected);
	});

	it("keeps non-DeepSeek context byte-for-byte even after a DeepSeek projection", () => {
		const engine = new DeepSeekHarnessEngine();
		const messages = [result()];
		engine.projectContext(messages, model, 90);
		expect(engine.projectContext(messages, { provider: "openai", id: "gpt-5.5" }, 90)).toBe(messages);
	});

	it("preserves errors, short results, user content and rich block order", () => {
		const engine = new DeepSeekHarnessEngine();
		const short = result("x".repeat(8192));
		const error = { ...result(), isError: true };
		const user = { role: "user" as const, content: "x".repeat(20000), timestamp: 0 };
		const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
		const rich: ToolResultMessage = {
			...result(),
			content: [{ type: "text", text: "😀".repeat(5000) }, image, { type: "text", text: "한".repeat(5000) }],
		};
		const messages: AgentMessage[] = [user, short, error, rich];
		const projected = engine.projectContext(messages, model, 90);
		expect(projected.slice(0, 3)).toEqual([user, short, error]);
		const trimmed = projected[3];
		if (trimmed.role !== "toolResult") throw new Error("Expected result");
		expect(trimmed.content.map((block) => block.type)).toEqual(["text", "image", "text"]);
		expect(trimmed.content[1]).toBe(image);
		const text = trimmed.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
		expect(text.startsWith("😀".repeat(4096))).toBe(true);
		expect(text.endsWith("한".repeat(1024))).toBe(true);
		expect(text).not.toMatch(/[\uD800-\uDFFF]/u);
		expect(Array.from(text).length).toBeLessThanOrEqual(8192);
	});

	it("uses a combined budget across small text blocks and invalidates in-place text changes", () => {
		const engine = new DeepSeekHarnessEngine();
		const source = result();
		source.content = [
			{ type: "text", text: "a".repeat(5000) },
			{ type: "text", text: "b".repeat(5000) },
		];
		const projected = engine.projectContext([source], model, 90)[0];
		expect(projected).not.toBe(source);
		if (source.content[0].type !== "text") throw new Error("Expected text");
		source.content[0].text = "changed";
		expect(engine.projectContext([source], model, 10)[0]).toBe(source);
	});

	it("does not reuse stale projections after content is replaced", () => {
		const engine = new DeepSeekHarnessEngine();
		const source = result();
		engine.projectContext([source], model, 90);
		source.content = [{ type: "text", text: "updated" }];
		expect(engine.projectContext([source], model, 10)[0]).toBe(source);
	});
});
