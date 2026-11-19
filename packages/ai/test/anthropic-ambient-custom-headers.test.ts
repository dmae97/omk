import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import type { Context, Model } from "../src/types.ts";

// @anthropic-ai/sdk 0.92.0 merges ANTHROPIC_CUSTOM_HEADERS into defaultHeaders, after its auth headers.
// OMK reuses that client for Anthropic-compatible third-party endpoints, so ambient headers must not
// reach them or replace the selected credential. This test uses the real SDK, not a mock.
const AMBIENT = "x-ambient-leak: corporate-proxy-secret\nx-api-key: ambient-key\nauthorization: Bearer ambient-token";

const context: Context = {
	systemPrompt: "test",
	messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
};

const sse = [
	`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } } })}\n`,
	`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}\n`,
	`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
].join("\n");

let server: Server;
let baseUrl: string;
let received: IncomingHttpHeaders[];
let previous: string | undefined;

beforeEach(async () => {
	received = [];
	server = createServer((request, response) => {
		received.push(request.headers);
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(sse);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	previous = process.env.ANTHROPIC_CUSTOM_HEADERS;
	process.env.ANTHROPIC_CUSTOM_HEADERS = AMBIENT;
});

afterEach(async () => {
	if (previous === undefined) delete process.env.ANTHROPIC_CUSTOM_HEADERS;
	else process.env.ANTHROPIC_CUSTOM_HEADERS = previous;
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function send(model: Model<"anthropic-messages">, apiKey: string): Promise<IncomingHttpHeaders> {
	const stream = streamAnthropic({ ...model, baseUrl }, context, {
		apiKey,
		headers: { "x-omk-option": "kept" },
		maxRetries: 0,
	});
	for await (const event of stream) {
		if (event.type === "error") throw new Error(event.error.errorMessage ?? "stream error");
	}
	expect(received).toHaveLength(1);
	return received[0];
}

describe("Anthropic client ignores ambient ANTHROPIC_CUSTOM_HEADERS", () => {
	it("API-key auth keeps the selected key and drops ambient headers on a third-party endpoint", async () => {
		const headers = await send(getModel("kimi-coding", "k3") as Model<"anthropic-messages">, "selected-key");
		expect(headers["x-api-key"]).toBe("selected-key");
		expect(headers.authorization).toBeUndefined();
		expect(headers["x-ambient-leak"]).toBeUndefined();
		expect(headers["x-omk-option"]).toBe("kept");
	});

	it("OAuth auth keeps the selected bearer token and drops ambient headers", async () => {
		const headers = await send(
			getModel("anthropic", "claude-fable-5") as Model<"anthropic-messages">,
			"sk-ant-oat-selected",
		);
		expect(headers.authorization).toBe("Bearer sk-ant-oat-selected");
		expect(headers["x-api-key"]).toBeUndefined();
		expect(headers["x-ambient-leak"]).toBeUndefined();
		expect(headers["x-omk-option"]).toBe("kept");
	});
});
