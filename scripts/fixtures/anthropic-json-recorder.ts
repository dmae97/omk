import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Type } from "typebox";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import { parseJsonWithRepair, parseStreamingJson, repairJson } from "../../packages/ai/src/utils/json-parse.ts";
import type { AssistantMessageEvent } from "../../packages/ai/src/types.ts";
import { context, model } from "./anthropic-provider-cases.ts";
import { jsonInputs, jsonStreamCases } from "./anthropic-json-cases.ts";

const strict = (input: string) => {
	try { return { ok: true, value: parseJsonWithRepair<unknown>(input) }; }
	catch { return { ok: false }; }
};
const values = jsonInputs.map((input, index) => ({ id: `json-${index}`, input, repaired: repairJson(input), strict: strict(input), streaming: parseStreamingJson(input) }));
const frame = (data: Record<string, unknown>) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
const start = frame({ type: "message_start", message: { id: "msg_synthetic", usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } });
const tools = [{ name: "read", description: "Read synthetic file", parameters: Type.Object({ path: Type.String() }) }];
const input = { model: model.id, maxTokens: 64, system: context.systemPrompt, user: "Hello 🌍", tools: [{ name: "read", description: "Read synthetic file", properties: { path: { type: "string" } }, required: ["path"] }] };
const originalFetch = globalThis.fetch;
const streams = [];
try {
	for (const scenario of jsonStreamCases) {
		let wire = start + frame({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_synthetic", name: "read", input: scenario.initial ?? {} } });
		for (const part of scenario.parts) wire += frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: part } });
		if (scenario.rawSse) wire += `event: content_block_delta\ndata: ${scenario.rawSse}\n\n`;
		if (scenario.finish === "error") wire += 'event: error\ndata: {"message":"synthetic failure"}\n\n';
		else if (!scenario.finish) wire += frame({ type: "content_block_stop", index: 0 }) + frame({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }) + frame({ type: "message_stop" });
		const bytes = new TextEncoder().encode(wire);
		const chunks: number[][] = [];
		for (let offset = 0; offset < bytes.length; offset += 7) chunks.push([...bytes.slice(offset, offset + 7)]);
		const controller = new AbortController();
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			if (String(url) !== "https://synthetic.invalid/v1/messages" || request || typeof init?.body !== "string") throw new Error("synthetic request boundary refused");
			const headers = Object.fromEntries([...new Headers(init.headers)].filter(([name]) => !name.startsWith("x-stainless-") && name !== "user-agent"));
			if (headers["x-api-key"] !== "faux-key" || headers.authorization) throw new Error("non-synthetic auth refused");
			request = { url: String(url), headers, body: init.body };
			let index = 0;
			return new Response(new ReadableStream<Uint8Array>({ pull(sink) {
				if (index < chunks.length) sink.enqueue(Uint8Array.from(chunks[index++]));
				else { if (scenario.finish === "cancel") controller.abort(); sink.close(); }
			} }, { highWaterMark: 0 }), { headers: { "content-type": "text/event-stream" } });
		};
		const stream = streamAnthropic(model, { ...context, tools }, { apiKey: "faux-key", cacheRetention: "none", maxTokens: 64, maxRetries: 0, signal: controller.signal });
		const events = [];
		const toolArguments = [];
		for await (const event of stream) {
			if (["toolcall_start", "toolcall_delta", "toolcall_end"].includes(event.type) && "partial" in event && "contentIndex" in event) {
				const block = event.partial.content[event.contentIndex];
				if (block.type !== "toolCall") throw new Error("missing streamed tool block");
				toolArguments.push(structuredClone({ type: event.type, contentIndex: event.contentIndex, arguments: block.arguments }));
			}
			const projected = { ...event } as Partial<AssistantMessageEvent> & { partial?: unknown; message?: unknown; error?: unknown };
			delete projected.partial; delete projected.message; delete projected.error;
			events.push(structuredClone(projected));
		}
		const { timestamp: _timestamp, usage, ...message } = structuredClone(await stream.result());
		const { cost: _cost, ...tokens } = usage;
		if (!request) throw new Error("missing synthetic request");
		streams.push({ id: scenario.id, input, request, chunks, abort: false, ...(scenario.finish === "cancel" ? { abortAfterChunks: chunks.length } : {}), events, toolArguments, result: { ...message, usage: tokens } });
	}
} finally { globalThis.fetch = originalFetch; }
const sources = ["scripts/fixtures/anthropic-json-cases.ts", "scripts/fixtures/anthropic-json-recorder.ts", "scripts/fixtures/anthropic-provider-cases.ts", "packages/ai/src/utils/json-parse.ts", "packages/ai/src/providers/anthropic.ts", "packages/ai/src/providers/anthropic-client.ts", "node_modules/@anthropic-ai/sdk/package.json", "node_modules/partial-json/dist/index.js", "node_modules/partial-json/dist/options.js", "node_modules/partial-json/package.json", "node_modules/partial-json/LICENSE"];
console.log(JSON.stringify({ schema: "omk.anthropic.json.v1", source: Object.fromEntries(sources.map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])), values, streams }, null, 2));
