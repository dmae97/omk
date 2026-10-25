import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { openCodeHeaders } from "../src/providers/opencode-headers.ts";
import { stream, streamSimple } from "../src/stream.ts";

const fixtures = [
	{
		id: "glm-5.3",
		body: 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
		path: "/openai/v1/chat/completions",
	},
	{
		id: "gpt-6-luna",
		body: 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}\n\n',
		path: "/openai/v1/responses",
	},
	{
		id: "claude-haiku-5-5",
		body: 'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"claude-haiku-5-5","usage":{"input_tokens":0,"output_tokens":0},"stop_reason":null}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
		path: "/anthropic/v1/messages",
	},
	{
		id: "gemini-4-argon",
		body: 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"finishReason":"STOP"}]}\n\n',
		path: "/google/v1beta/models/gemini-4-argon:streamGenerateContent",
	},
];

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode Go routing headers", () => {
	it("preserves explicit mixed-case caller headers without mutating the model", () => {
		const model = getModels("opencode-go")[0];
		const headers = { "User-Agent": "custom-agent/2", "X-OpenCode-Session": "explicit" };
		expect(openCodeHeaders(model, "generated", headers)).toMatchObject({
			"user-agent": "custom-agent/2",
			"x-opencode-session": "explicit",
		});
		expect(headers).toEqual({ "User-Agent": "custom-agent/2", "X-OpenCode-Session": "explicit" });
	});

	it("does not attach conversation headers to unrelated providers or proxy origins", () => {
		const model = getModels("opencode-go")[0];
		for (const baseUrl of [
			"https://opencode.ai.attacker.invalid/inference/go/openai/v1",
			"http://opencode.ai/inference/go/openai/v1",
			"https://proxy.invalid/v1",
			"https://opencode.ai/inference/openai/v1",
		]) {
			expect(openCodeHeaders({ ...model, baseUrl }, "private-session")).toBeUndefined();
		}
		expect(openCodeHeaders({ ...model, provider: "openai" }, "private-session")).toBeUndefined();
	});

	for (const send of [streamSimple, stream]) {
		it.each(fixtures)(
			`${send.name} identifies OMK and preserves session with caching off on $id`,
			async ({ id, body, path }) => {
				const model = getModels("opencode-go").find((entry) => entry.id === id);
				if (!model) throw new Error(`Missing Go ${id}`);
				let request: Request | undefined;
				vi.stubGlobal(
					"fetch",
					vi.fn(async (input: string | Request | URL, init?: RequestInit) => {
						request = input instanceof Request ? input : new Request(input, init);
						return new Response(body, { headers: { "content-type": "text/event-stream" } });
					}),
				);
				const result = await send(
					model,
					{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
					{
						apiKey: "fixture-key",
						sessionId: "conversation-123",
						cacheRetention: "none",
						maxTokens: 4096,
					},
				).result();
				expect(result.stopReason, result.errorMessage).toBe("stop");
				// Google prepends its SDK identity; the explicit OMK product must still be present.
				expect(request?.headers.get("user-agent")).toMatch(/(?:^|, )omk\/1\.0(?:$| )/);
				expect(request?.headers.get("x-opencode-session")).toBe("conversation-123");
				expect(new URL(request?.url ?? "").pathname).toBe(`/inference/go${path}`);
			},
		);
	}
});
