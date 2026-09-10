import type { Api, Context, Model, ToolResultMessage } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { requestAssistantResponse } from "../src/provider-request.ts";
import type { AgentEvent, AgentLoopConfig } from "../src/types.ts";
import { VISION_ROUTE_MODEL } from "../src/vision-route.ts";
import { contract, model, response } from "./provider-request-fixtures.ts";

const imageData = "fixture-private-image-bytes";
const toolResult: ToolResultMessage = {
	role: "toolResult",
	toolCallId: "read-1",
	toolName: "read",
	isError: false,
	timestamp: 1,
	content: [
		{ type: "text", text: "Read artifact: /work/plot.png" },
		{ type: "image", mimeType: "image/png", data: imageData },
	],
};
const context: Context = { messages: [toolResult] };

async function dispatch(input: Context, overrides: Partial<AgentLoopConfig> = {}) {
	const events: AgentEvent[] = [];
	const send = vi.fn((_model: Model<Api>, _context: Context) => response());
	const getApiKey = vi.fn(() => "fixture-key");
	await requestAssistantResponse(
		input,
		{ model, modelContract: contract, convertToLlm: () => [], getApiKey, ...overrides },
		{
			emit: (event) => {
				events.push(event);
			},
			streamFn: send,
			consume: (stream) => stream.result(),
		},
	);
	return { send, getApiKey, events };
}

describe("contracted tool observation projection", () => {
	it("keeps a text-only contract on the chosen model after an image tool result", async () => {
		const { send, getApiKey, events } = await dispatch(context);
		expect(getApiKey).toHaveBeenCalledExactlyOnceWith(model.provider);
		expect(send).toHaveBeenCalledOnce();
		const input = send.mock.calls[0]?.[1];
		expect(input?.messages[0]).toMatchObject({
			role: "toolResult",
			toolCallId: "read-1",
			toolName: "read",
			isError: false,
		});
		expect(JSON.stringify(input)).not.toContain(imageData);
		expect(JSON.stringify(input)).toContain("/work/plot.png");
		expect(input?.messages[0]?.content).toContainEqual(
			expect.objectContaining({ type: "text", text: expect.stringMatching(/not inspected/i) }),
		);
		expect(events).toContainEqual(expect.objectContaining({ type: "provider_request", omittedToolImages: 1 }));
	});

	it("preserves original attachments and avoids copying the already-projected context", async () => {
		const original = structuredClone(context);
		const { send } = await dispatch(context);
		const projected = send.mock.calls[0]?.[1];
		expect(projected).toBeDefined();
		if (!projected) throw new Error("Missing projected request");
		const second = await dispatch(projected);
		expect(second.send.mock.calls[0]?.[1]).toBe(projected);
		expect(context).toEqual(original);
	});

	it("does not change text-only observations", async () => {
		const input: Context = { messages: [{ role: "user", content: "fixture", timestamp: 0 }] };
		const { send } = await dispatch(input);
		expect(send.mock.calls[0]?.[1]).toBe(input);
	});

	it("keeps tool images intact for a vision-capable selected model", async () => {
		const { send } = await dispatch(context, { model: { ...model, input: ["text", "image"] } });
		expect(send.mock.calls[0]?.[1]).toBe(context);
	});

	it("does not silently strip an explicit user image to satisfy a text contract", async () => {
		const input: Context = {
			messages: [
				{ role: "user", content: [{ type: "image", mimeType: "image/png", data: imageData }], timestamp: 0 },
				toolResult,
			],
		};
		const getApiKey = vi.fn();
		await expect(dispatch(input, { getApiKey })).rejects.toThrow();
		expect(getApiKey).not.toHaveBeenCalled();
		expect(input.messages[0]?.content).toContainEqual(expect.objectContaining({ type: "image", data: imageData }));
	});

	it("preserves all attachments when a user image selects an explicitly allowed vision route", async () => {
		const input: Context = {
			messages: [
				{ role: "user", content: [{ type: "image", mimeType: "image/png", data: imageData }], timestamp: 0 },
				toolResult,
			],
		};
		const { send, getApiKey } = await dispatch(input, {
			modelContract: {
				...contract,
				allowedModels: [
					...contract.allowedModels,
					{ provider: VISION_ROUTE_MODEL.provider, id: VISION_ROUTE_MODEL.id },
				],
				allowedProviders: [...contract.allowedProviders, VISION_ROUTE_MODEL.provider],
				allowedAuthOrigins: [...contract.allowedAuthOrigins, VISION_ROUTE_MODEL.provider],
			},
		});
		expect(getApiKey).toHaveBeenCalledExactlyOnceWith(VISION_ROUTE_MODEL.provider);
		expect(send.mock.calls[0]?.[1]).toBe(input);
	});

	it("retains the legacy vision route outside contract mode", async () => {
		const { getApiKey } = await dispatch(context, { modelContract: undefined });
		expect(getApiKey).toHaveBeenCalledExactlyOnceWith(VISION_ROUTE_MODEL.provider);
	});
});
