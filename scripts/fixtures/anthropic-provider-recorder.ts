import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Type } from "typebox";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { AssistantMessageEvent } from "../../packages/ai/src/types.ts";
import { cases, context, model } from "./anthropic-provider-cases.ts";

const inputFiles = [
	"scripts/fixtures/anthropic-provider-cases.ts", "scripts/fixtures/anthropic-provider-recorder.ts",
	"packages/ai/src/providers/anthropic.ts", "packages/ai/src/providers/anthropic-client.ts",
	"packages/ai/src/utils/json-parse.ts", "packages/ai/src/providers/provider-stop-reasons.ts",
];
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const originalFetch = globalThis.fetch;
const recorded = [];
try {
	for (const scenario of cases) {
		const controller = new AbortController();
		const bytes = new TextEncoder().encode(scenario.wire);
		const chunks: number[][] = [];
		for (let offset = 0; offset < bytes.length; offset += scenario.width) chunks.push([...bytes.slice(offset, offset + scenario.width)]);
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			if (String(url) !== "https://synthetic.invalid/v1/messages") throw new Error("recorder refuses unexpected URL");
			if (request) throw new Error("recorder refuses retries");
			if (typeof init?.body !== "string") throw new Error("expected SDK serialized request");
			const headers = Object.fromEntries([...new Headers(init.headers)].filter(([name]) => !name.startsWith("x-stainless-") && name !== "user-agent"));
			if (headers["x-api-key"] !== "faux-key" || headers.authorization) throw new Error("non-synthetic credential refused");
			request = { url: String(url), headers, body: init.body };
			let index = 0;
			return new Response(new ReadableStream<Uint8Array>({
				pull(sink) {
					if ("abortAfterChunks" in scenario && index === scenario.abortAfterChunks) {
						controller.abort();
						sink.close();
						return;
					}
					if (index < chunks.length) sink.enqueue(Uint8Array.from(chunks[index++]));
					else sink.close();
				},
			}, { highWaterMark: 0 }), { headers: { "content-type": "text/event-stream" } });
		};
		const tools = "tool" in scenario ? [{ name: "read", description: "Read synthetic file", parameters: Type.Object({ path: Type.String() }) }] : undefined;
		const input = { model: model.id, maxTokens: 64, system: context.systemPrompt, user: "Hello 🌍", tools: tools?.map((tool) => ({ name: tool.name, description: tool.description, properties: { path: { type: "string" } }, required: ["path"] })) ?? [] };
		const stream = streamAnthropic(model, { ...context, tools }, {
			apiKey: "faux-key", cacheRetention: "none", maxTokens: 64, maxRetries: 0, signal: controller.signal,
			onResponse: () => { if ("abort" in scenario) controller.abort(); },
		});
		const events = [];
		for await (const event of stream) {
			// Semantic event projection: partial snapshots are mutable, so do not record references.
			const projected = { ...event } as Partial<AssistantMessageEvent> & { partial?: unknown; message?: unknown; error?: unknown };
			delete projected.partial;
			delete projected.message;
			delete projected.error;
			events.push(structuredClone(projected));
		}
		const result = structuredClone(await stream.result());
		const { timestamp: _timestamp, usage, ...message } = result;
		const { cost: _cost, ...tokens } = usage;
		if (!request) throw new Error(`missing request: ${scenario.id}`);
		recorded.push({ id: scenario.id, input, request, chunks, abort: "abort" in scenario, ...("abortAfterChunks" in scenario ? { abortAfterChunks: scenario.abortAfterChunks } : {}), events, result: { ...message, usage: tokens } });
	}
} finally {
	globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({
	schema: "omk.anthropic.synthetic.v1", generator: "scripts/record-provider-fixtures.mjs",
	source: Object.fromEntries(inputFiles.map((file) => [file, digest(readFileSync(file))])),
	projection: { headersExcluded: ["x-stainless-*", "user-agent"], eventsExcluded: ["partial", "message", "error"], resultExcluded: ["timestamp", "usage.cost"] },
	cases: recorded,
}, null, 2));
