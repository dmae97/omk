import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import { streamSimple } from "../src/stream.ts";
import type { Context, Model } from "../src/types.ts";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function makeContext(): Context {
	return { messages: [{ role: "user", content: "Continue the OMK coding task.", timestamp: Date.now() }] };
}

async function captureOfficialRequest(model: Model<"anthropic-messages">) {
	let fallbacks: unknown;
	let betaHeader: string | null = null;
	vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
		const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
		betaHeader = headers.get("anthropic-beta");
		return new Response("stop", { status: 500 });
	});

	await streamSimple(model, makeContext(), {
		apiKey: "sk-ant-api03-test-key",
		maxRetries: 0,
		onPayload: (payload) => {
			fallbacks = (payload as { fallbacks?: unknown }).fallbacks;
		},
	}).result();

	return { fallbacks, betaHeader };
}

function fakeClient(events: Array<{ event: string; data: unknown }>): Anthropic {
	const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`).join("\n");
	return {
		messages: {
			create: () => ({
				asResponse: async () =>
					new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
			}),
		},
	} as unknown as Anthropic;
}

function messageStart(model: string) {
	return {
		event: "message_start",
		data: {
			type: "message_start",
			message: {
				id: "msg_fallback",
				model,
				usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			},
		},
	};
}

describe("Anthropic server-side refusal fallback", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(["claude-fable-5-2", "claude-opus-5-5", "claude-opus-5"] as const)(
		"enables the official default fallback for %s",
		async (id) => {
			const request = await captureOfficialRequest(getModel("anthropic", id));
			expect(request.fallbacks).toBe("default");
			expect(request.betaHeader).toContain(FALLBACK_BETA);
		},
	);

	it("does not send the beta fallback to other models or proxies", async () => {
		for (const id of ["claude-opus-4-8", "claude-haiku-5-5"] as const) {
			const unsupported = await captureOfficialRequest({ ...getModel("anthropic", "claude-opus-4-8"), id });
			expect(unsupported.fallbacks).toBeUndefined();
			expect(unsupported.betaHeader ?? "").not.toContain(FALLBACK_BETA);
		}

		for (const baseUrl of [
			"https://proxy.example.com",
			"http://api.anthropic.com",
			"https://api.anthropic.com:8443",
		]) {
			const proxy = await captureOfficialRequest({
				...getModel("anthropic", "claude-fable-5-2"),
				baseUrl,
			});
			expect(proxy.fallbacks).toBeUndefined();
			expect(proxy.betaHeader ?? "").not.toContain(FALLBACK_BETA);
		}
	});

	it("accepts a fallback marker and records the model that actually answered", async () => {
		const response = await streamAnthropic(getModel("anthropic", "claude-fable-5-2"), makeContext(), {
			client: fakeClient([
				messageStart("claude-opus-5"),
				{
					event: "content_block_start",
					data: { type: "content_block_start", index: 0, content_block: { type: "fallback" } },
				},
				{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
				{
					event: "content_block_start",
					data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
				},
				{
					event: "content_block_delta",
					data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "OK" } },
				},
				{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
				{
					event: "message_delta",
					data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
				},
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
		}).result();

		expect(response.stopReason).toBe("stop");
		expect(response.model).toBe("claude-opus-5");
		expect(response.content).toEqual([{ type: "text", text: "OK" }]);
		expect(response.usage.cost.output).toBeCloseTo(0.000025);
	});

	it("keeps the refusal category in the diagnostic", async () => {
		const response = await streamAnthropic(getModel("anthropic", "claude-opus-5-5"), makeContext(), {
			client: fakeClient([
				messageStart("claude-opus-5-5"),
				{
					event: "message_delta",
					data: {
						type: "message_delta",
						delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: "frontier_llm" } },
						usage: { output_tokens: 1 },
					},
				},
				{
					event: "message_delta",
					data: { type: "message_delta", delta: {}, usage: { output_tokens: 2 } },
				},
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
		}).result();

		expect(response.stopReason).toBe("error");
		expect(response.errorMessage).toContain("frontier_llm");
	});
});
