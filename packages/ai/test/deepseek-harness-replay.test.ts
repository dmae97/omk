import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Context, Model } from "../src/types.ts";

const native = getModel("deepseek", "deepseek-flash");
const gateway = getModel("openrouter", "deepseek/deepseek-v4.1-flash");
if (!native || !gateway) throw new Error("Missing DeepSeek fixtures");
const routes: Model<"openai-completions">[] = [native, gateway];

afterEach(() => vi.unstubAllGlobals());

function sse(delta: object, finishReason: string): Response {
	return new Response(
		`data: ${JSON.stringify({
			id: "fixture-response",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
			usage: { prompt_tokens: 12, completion_tokens: 3, prompt_cache_hit_tokens: 4 },
		})}\n\ndata: [DONE]\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

describe("DeepSeek harness existing transport contract", () => {
	it.each(routes)("streams and replays reasoning/tool pairs through $provider without dsh metadata", async (model) => {
		const bodies: Record<string, unknown>[] = [];
		const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			return bodies.length === 1
				? sse(
						{
							reasoning_content: "fixture reasoning",
							tool_calls: [
								{ index: 0, id: "probe-1", type: "function", function: { name: "probe", arguments: "{}" } },
							],
						},
						"tool_calls",
					)
				: sse({ content: "done" }, "stop");
		});
		vi.stubGlobal("fetch", fetch);
		const context: Context = {
			systemPrompt: "Fixture harness",
			messages: [{ role: "user", content: "run probe", timestamp: 0 }],
			tools: [{ name: "probe", description: "Probe", parameters: Type.Object({}) }],
		};
		const options = { apiKey: "fixture-key", reasoning: "high" as const, maxTokens: 128 };
		const first = await streamSimple(model, context, options).result();
		expect(first.stopReason).toBe("toolUse");
		expect(first.content).toContainEqual({
			type: "thinking",
			thinking: "fixture reasoning",
			thinkingSignature: "reasoning_content",
		});
		context.messages.push(first, {
			role: "toolResult",
			toolCallId: "probe-1",
			toolName: "probe",
			content: [{ type: "text", text: "output" }],
			isError: false,
			timestamp: 1,
		});
		const second = await streamSimple(model, context, options).result();
		expect(second.stopReason).toBe("stop");
		expect(second.content).toEqual([{ type: "text", text: "done" }]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(bodies[1]).toMatchObject({
			messages: [
				{ role: "system", content: "Fixture harness" },
				{ role: "user", content: "run probe" },
				{
					role: "assistant",
					reasoning_content: "fixture reasoning",
					tool_calls: [{ id: "probe-1", function: { name: "probe", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "probe-1", content: "output" },
			],
		});
		for (const body of bodies) {
			expect(body).not.toHaveProperty("dsh_session_log");
			expect(body).not.toHaveProperty("dsh_plugin_packages");
		}
		if (model.provider === "deepseek") {
			expect(bodies[1]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high", max_tokens: 128 });
		} else {
			expect(bodies[1]).toMatchObject({ reasoning: { effort: "high" } });
			expect(bodies[1]).not.toHaveProperty("thinking");
		}
	});
});
