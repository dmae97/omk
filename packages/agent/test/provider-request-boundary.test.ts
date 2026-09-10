import type { Api, Model, SimpleStreamOptions } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { agentLoop, VISION_ROUTE_MODEL } from "../src/agent-loop.ts";
import type { AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../src/types.ts";
import { contract, model, response } from "./provider-request-fixtures.ts";

const prompt: AgentMessage = { role: "user", content: "fixture", timestamp: 0 };
const imagePrompt: AgentMessage = {
	role: "user",
	content: [{ type: "image", mimeType: "image/png", data: "Zml4dHVyZQ==" }],
	timestamp: 0,
};
const base = { model, modelContract: contract, convertToLlm: () => [] };

async function run(config: AgentLoopConfig, streamFn: StreamFn, input = prompt, signal?: AbortSignal) {
	const events: AgentEvent[] = [];
	const stream = agentLoop([input], { systemPrompt: "", messages: [], tools: [] }, config, signal, streamFn);
	for await (const event of stream) events.push(event);
	return { events, messages: await stream.result() };
}

function requestEvents(events: AgentEvent[]) {
	return events.filter((event) => event.type.startsWith("provider_"));
}

describe("contracted provider dispatch", () => {
	it.each([
		{ model: { ...model, id: "other-model" } },
		{ model: { ...model, provider: "other-provider" } },
		{ reasoning: "high" as const },
		{ maxTokens: 1025 },
	])("rejects forbidden final request options %o before resolving auth", async (overrides) => {
		const send = vi.fn(() => response());
		const getApiKey = vi.fn(() => "fixture-key");
		const result = await run({ ...base, ...overrides, getApiKey }, send);
		expect(send).not.toHaveBeenCalled();
		expect(getApiKey).not.toHaveBeenCalled();
		expect(requestEvents(result.events)).toEqual([
			expect.objectContaining({ type: "provider_denied", deniedReason: "contract-violation" }),
		]);
	});

	it("sends an explicit bounded cap when the request omits maxTokens", async () => {
		let options: SimpleStreamOptions | undefined;
		await run(base, (_model, _context, supplied) => {
			options = supplied;
			return response();
		});
		expect(options?.maxTokens).toBe(1024);
	});

	it("uses the smaller model cap when no explicit output cap is requested", async () => {
		let options: SimpleStreamOptions | undefined;
		await run({ ...base, model: { ...model, maxTokens: 128 } }, (_model, _context, supplied) => {
			options = supplied;
			return response();
		});
		expect(options?.maxTokens).toBe(128);
	});

	it("pins the original contract while a context hook changes caller-owned data", async () => {
		const mutable = { ...contract, allowedModels: [...contract.allowedModels] };
		const send = vi.fn(() => response());
		const config = {
			...base,
			modelContract: mutable,
			model: { ...model, id: "forbidden" },
			transformContext: async (messages: AgentMessage[]) => {
				mutable.allowedModels.push({ provider: model.provider, id: "forbidden" });
				return messages;
			},
		};
		await run(config, send);
		expect(send).not.toHaveBeenCalled();
	});

	it("pins checked request options across asynchronous credential resolution", async () => {
		let sentModel: Model<Api> | undefined;
		let options: SimpleStreamOptions | undefined;
		const selected = { ...model };
		const config = {
			...base,
			model: selected,
			maxTokens: 512,
			getApiKey: async () => {
				selected.id = "mutated-after-check";
				config.maxTokens = 4096;
				return "fixture-key";
			},
		};
		await run(config, (sent, _context, supplied) => {
			sentModel = sent;
			options = supplied;
			return response();
		});
		expect(sentModel?.id).toBe(model.id);
		expect(options?.maxTokens).toBe(512);
	});

	it("does not dispatch when cancelled during credential resolution", async () => {
		const controller = new AbortController();
		const send = vi.fn(() => response());
		const result = await run(
			{
				...base,
				getApiKey: async () => {
					controller.abort();
					return "fixture-key";
				},
			},
			send,
			prompt,
			controller.signal,
		);
		expect(send).not.toHaveBeenCalled();
		expect(requestEvents(result.events)).not.toContainEqual(expect.objectContaining({ type: "provider_request" }));
	});

	it.each(["stop", "error"] as const)(
		"correlates dispatch and settlement on %s without private material",
		async (outcome) => {
			const result = await run(base, () => response(outcome));
			const events = requestEvents(result.events);
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({ type: "provider_request", maxOutputTokens: 1024 });
			expect(events[1]).toMatchObject({
				type: "provider_request_end",
				requestId: Reflect.get(events[0] ?? {}, "requestId"),
				outcome: outcome === "stop" ? "completed" : "error",
			});
			expect(JSON.stringify(events)).not.toContain("fixture private error");
			expect(JSON.stringify(events)).not.toContain("fixture result");
		},
	);

	it("closes dispatch evidence when a custom stream throws", async () => {
		const result = await run(base, () => {
			throw new Error("fixture private exception");
		});
		const events = requestEvents(result.events);
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({ type: "provider_request_end", outcome: "error" });
		expect(JSON.stringify(events)).not.toContain("fixture private exception");
	});

	it("rejects the automatic vision model before invoking the credential resolver", async () => {
		const send = vi.fn(() => response());
		const getApiKey = vi.fn(() => "fixture-key");
		await run({ ...base, convertToLlm: () => [imagePrompt], getApiKey }, send, imagePrompt);
		expect(send).not.toHaveBeenCalled();
		expect(getApiKey).not.toHaveBeenCalled();
	});
});

describe("cross-provider credential isolation without an optional contract", () => {
	it("uses only the destination resolver key on automatic vision routing", async () => {
		const resolve = vi.fn(() => "destination-fixture-key");
		let suppliedKey: string | undefined;
		await run(
			{ model, apiKey: "source-fixture-key", getApiKey: resolve, convertToLlm: () => [imagePrompt] },
			(_selected, _context, options) => {
				suppliedKey = options?.apiKey;
				return response();
			},
			imagePrompt,
		);
		expect(resolve).toHaveBeenCalledExactlyOnceWith(VISION_ROUTE_MODEL.provider);
		expect(suppliedKey).toBe("destination-fixture-key");
	});

	it("rejects a forbidden credential origin even when the model is allowed", async () => {
		const send = vi.fn(() => response());
		const resolve = vi.fn(() => "fixture-key");
		await run({ ...base, modelContract: { ...contract, allowedAuthOrigins: ["other"] }, getApiKey: resolve }, send);
		expect(resolve).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
	it("does not reuse the source key or headers for automatic vision routing", async () => {
		let options: SimpleStreamOptions | undefined;
		let routed: Model<Api> | undefined;
		await run(
			{
				model: { ...model, headers: { "X-Fixture": "source-model-header" } },
				apiKey: "source-provider-key",
				headers: { "X-Fixture": "source-request-header" },
				getApiKey: () => undefined,
				convertToLlm: () => [imagePrompt],
			},
			(selected, _context, supplied) => {
				routed = selected;
				options = supplied;
				return response();
			},
			imagePrompt,
		);
		expect(routed?.provider).toBe(VISION_ROUTE_MODEL.provider);
		expect(routed?.headers).toBeUndefined();
		expect(options?.apiKey).toBeUndefined();
		expect(options?.headers).toBeUndefined();
	});

	it("retains the static fallback key and headers on the same provider", async () => {
		let options: SimpleStreamOptions | undefined;
		await run(
			{ model, apiKey: "source-provider-key", headers: { "X-Fixture": "same-provider" }, convertToLlm: () => [] },
			(_model, _context, supplied) => {
				options = supplied;
				return response();
			},
		);
		expect(options?.apiKey).toBe("source-provider-key");
		expect(options?.headers).toEqual({ "X-Fixture": "same-provider" });
	});
});
