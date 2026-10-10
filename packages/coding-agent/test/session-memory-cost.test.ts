import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "omk-agent-core";
import { getModel } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFallbackTokenCounter, type TokenCounterAdapter } from "../src/core/context-budget-token-counter.ts";
import { memoryTokenCounter } from "../src/core/memory-token-counter.ts";
import { estimateContextInputTokens } from "../src/core/prompt-budget.ts";
import { SessionMemory } from "../src/core/session-memory.ts";
import { VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("request-local memory pricing", () => {
	it("prices static prompt/tool text once per request without caching source recall", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-memory-cost-"));
		roots.push(root);
		const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
		const store = new VerifiedMemoryStore(root);
		for (const word of words) {
			writeFileSync(join(root, `${word}.txt`), `${word} storage fact`);
			expect(store.remember({ path: `${word}.txt`, startLine: 1, endLine: 1 }).verdict).toBe("accept");
		}
		const fallback = createFallbackTokenCounter();
		const count = vi.fn(fallback.countText.bind(fallback));
		const counter: TokenCounterAdapter = { ...fallback, countText: count };
		const agent = new Agent({
			initialState: {
				model: getModel("openai", "gpt-4o-mini"),
				systemPrompt: "STATIC_BASE_SENTINEL ".repeat(100),
				tools: [
					{
						name: "fixture",
						label: "fixture",
						description: "STATIC_TOOL_SENTINEL",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
					},
				],
			},
		});
		const messages: AgentMessage[] = [{ role: "user", content: words.join(" "), timestamp: 1 }];
		vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
		vi.stubEnv("OMK_MEMORY_SELECTION", "v2");
		const memory = new SessionMemory(
			agent,
			root,
			() => ({ maxPromptTokens: 20000, queryContext: words.join(" "), tokenCounter: counter }),
			(_messages, window) => window,
		);
		try {
			const transformed = await agent.transformContext?.(messages);
			expect(transformed?.length).toBeGreaterThan(messages.length);
			expect(count.mock.calls.filter(([text]) => text.includes("STATIC_BASE_SENTINEL"))).toHaveLength(1);
			expect(count.mock.calls.filter(([text]) => text.includes("STATIC_TOOL_SENTINEL"))).toHaveLength(1);
			const first = JSON.stringify(transformed);
			writeFileSync(join(root, "alpha.txt"), "changed");
			count.mockClear();
			const next = await agent.transformContext?.(messages);
			expect(JSON.stringify(next)).not.toContain("alpha storage fact");
			expect(first).toContain("alpha storage fact");
			expect(count.mock.calls.filter(([text]) => text.includes("STATIC_BASE_SENTINEL"))).toHaveLength(1);
			expect(count.mock.calls.filter(([text]) => text.includes("STATIC_TOOL_SENTINEL"))).toHaveLength(1);
		} finally {
			memory.close();
		}
	});
	it("keeps model keys, uncached message parts, and full-envelope estimates identical", () => {
		const fallback = createFallbackTokenCounter();
		const countText = vi.fn(fallback.countText.bind(fallback));
		const countTextParts = vi.fn((parts: readonly string[], model: string) =>
			fallback.countText(parts.join(""), model),
		);
		const source: TokenCounterAdapter = { ...fallback, countText, countTextParts };
		const cached = memoryTokenCounter(source, "fixture", "system", "[]");
		for (let i = 0; i < 2; i++) {
			expect(cached.countText("system", "fixture")).toEqual(fallback.countText("system", "fixture"));
			cached.countText("system", "other");
			cached.countText("message", "fixture");
			cached.countTextParts?.(["message"], "fixture");
		}
		expect(countText.mock.calls.filter(([text, model]) => text === "system" && model === "fixture")).toHaveLength(1);
		expect(countText.mock.calls.filter(([, model]) => model === "other")).toHaveLength(2);
		expect(countText.mock.calls.filter(([text]) => text === "message")).toHaveLength(2);
		expect(countTextParts).toHaveBeenCalledTimes(2);
		const input = {
			systemPrompt: "system",
			tools: [],
			modelId: "fixture",
			messages: [{ role: "user" as const, content: `alpha 雪 "quoted"`, timestamp: 1 }],
		};
		for (const projectedUsageTokens of [0, 10000]) {
			expect(estimateContextInputTokens({ ...input, projectedUsageTokens, tokenCounter: cached })).toEqual(
				estimateContextInputTokens({ ...input, projectedUsageTokens, tokenCounter: fallback }),
			);
		}
		memoryTokenCounter(source, "fixture", "system", "[]").countText("system", "fixture");
		expect(countText.mock.calls.filter(([text, model]) => text === "system" && model === "fixture")).toHaveLength(2);
	});
});
