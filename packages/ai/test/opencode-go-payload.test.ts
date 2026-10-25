import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { SimpleStreamOptions } from "../src/types.ts";

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

async function capture(id: string, reasoning: SimpleStreamOptions["reasoning"]) {
	const model = getModels("opencode-go").find((entry) => entry.id === id);
	if (!model) throw new Error(`Missing Go model ${id}`);
	let payload: unknown;
	const fetch = vi.fn(() => {
		throw new Error("Unexpected network call");
	});
	vi.stubGlobal("fetch", fetch);
	await streamSimple(
		model,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{
			apiKey: "fixture-key",
			reasoning,
			maxTokens: 4096,
			onPayload: (body) => {
				payload = body;
				throw new PayloadCaptured();
			},
		},
	).result();
	expect(fetch).not.toHaveBeenCalled();
	return payload;
}

describe("OpenCode Go reasoning payloads", () => {
	it.each([
		["glm-5.2", "max", "max"],
		["glm-5.3", "max", "max"],
		["glm-5.3-flash", "low", "low"],
		["kimi-k3", "max", "max"],
		["hy3", "low", "low"],
		["hy4-preview", "high", "high"],
		["beam-free", "max", "max"],
		["space-bunny", "xhigh", "xhigh"],
		["step-5-preview", "high", "high"],
	] as const)("forwards %s %s without an invented toggle", async (id, reasoning, effort) => {
		const payload = await capture(id, reasoning);
		expect(payload).toMatchObject({ model: id, max_tokens: 4096, reasoning_effort: effort });
		expect(payload).not.toHaveProperty("thinking");
		expect(payload).not.toHaveProperty("enable_thinking");
	});

	it.each(["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.6-flash", "mimo-v2.6-pro", "longcat-2.0", "kimi-k2.6", "glm-5.1"])(
		"uses only the thinking toggle on %s",
		async (id) => {
			for (const reasoning of ["high", undefined] as const) {
				const payload = await capture(id, reasoning);
				expect(payload).toMatchObject({ thinking: { type: reasoning ? "enabled" : "disabled" } });
				expect(payload).not.toHaveProperty("reasoning_effort");
			}
		},
	);

	it.each(["kimi-k2.7-code", "minimax-m2.5", "minimax-m2.7"])("leaves fixed reasoning enabled on %s", async (id) => {
		const payload = await capture(id, "high");
		expect(payload).not.toHaveProperty("reasoning_effort");
		expect(payload).not.toHaveProperty("thinking");
	});

	it.each(["deepseek-v4.1-flash", "deepseek-v4-pro"])("keeps the native toggle and max effort on %s", async (id) => {
		expect(await capture(id, "max")).toMatchObject({
			thinking: { type: "enabled" },
			reasoning_effort: "max",
			max_tokens: 4096,
		});
	});

	it.each(["gpt-5.6-luna", "gpt-6-luna", "grok-4.7", "muse-spark-1.3-contributor"])(
		"uses Responses effort on %s",
		async (id) => {
			const payload = await capture(id, id.startsWith("muse") ? "max" : "xhigh");
			expect(payload).toMatchObject({ reasoning: { effort: "xhigh" }, max_output_tokens: 4096 });
		},
	);

	it.each(["gpt-5.6-luna", "gpt-6-luna"])("sends Responses none when %s thinking is off", async (id) => {
		expect(await capture(id, undefined)).toMatchObject({ reasoning: { effort: "none" } });
	});

	it.each(["low", "medium", "high", "xhigh", "max"] as const)("sends Haiku adaptive effort %s", async (reasoning) => {
		const payload = await capture("claude-haiku-5-5", reasoning);
		expect(payload).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: reasoning } });
		expect(payload).not.toHaveProperty("thinking.budget_tokens");
	});

	it("explicitly disables Haiku thinking at the supported default effort", async () => {
		expect(await capture("claude-haiku-5-5", undefined)).toMatchObject({ thinking: { type: "disabled" } });
	});

	it.each(["low", "medium", "high"] as const)(
		"sends Argon native thinkingLevel %s, not a token budget",
		async (reasoning) => {
			const payload = await capture("gemini-4-argon", reasoning);
			expect(payload).toMatchObject({
				config: { thinkingConfig: { includeThoughts: true, thinkingLevel: reasoning.toUpperCase() } },
			});
			expect(payload).not.toHaveProperty("config.thinkingConfig.thinkingBudget");
		},
	);

	it("uses the lowest supported Argon level when off is requested through the SDK", async () => {
		const payload = await capture("gemini-4-argon", undefined);
		expect(payload).toMatchObject({ config: { thinkingConfig: { thinkingLevel: "LOW" } } });
		expect(payload).not.toHaveProperty("config.thinkingConfig.thinkingBudget");
	});

	it("retains the actual Go GPT-5.6 context declaration", () => {
		expect(getModels("opencode-go").find((model) => model.id === "gpt-5.6-luna")?.contextWindow).toBe(1050000);
	});
});
