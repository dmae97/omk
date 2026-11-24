import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { ImageContent, Model, TextContent, UserMessage } from "../../packages/ai/src/types.ts";

const url = "https://synthetic.invalid/v1";
const compat = { supportsStore: true, supportsDeveloperRole: true, supportsUsageInStreaming: true,
	maxTokensField: "max_completion_tokens", supportsStrictMode: true, requiresSystemMessageFirst: false } as const;
const image: ImageContent = { type: "image", mimeType: "image/png", data: "cG5n" };
const opaque: ImageContent = { type: "image", mimeType: "image/webp", data: "not normalized+/=\n" };
const text = (text: string): TextContent => ({ type: "text", text });
const marker = text("(image omitted: model does not support images)");
const histories: { id: string; turns: (TextContent | ImageContent)[][] }[] = [
	{ id: "only", turns: [[image]] },
	{ id: "ordered", turns: [[text("앞"), image, opaque, text(""), opaque, text("끝")]] },
	{ id: "literal-marker", turns: [[marker, image, marker, text(" "), image]] },
	{ id: "per-turn", turns: [[image, image], [], [opaque]] },
];
const streamBody = 'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const original = globalThis.fetch;
try {
	const cases = [];
	for (const vision of [true, false]) {
		const model: Model<"openai-completions"> = { id: "synthetic", name: "Synthetic", api: "openai-completions",
			provider: "synthetic", baseUrl: url, reasoning: false, input: vision ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64, compat };
		for (const { id, turns } of histories) {
			const messages: UserMessage[] = turns.map(content => ({ role: "user", content, timestamp: 0 }));
			let request: { url: string; headers: Record<string,string>; body: string } | undefined;
			globalThis.fetch = async (target, init) => {
				const headers = new Headers(init?.headers);
				if (request || String(target) !== `${url}/chat/completions` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
				request = { url: String(target), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
				return new Response(streamBody, { headers: { "content-type": "text/event-stream" } });
			};
			const stream = streamOpenAICompletions(model, { messages }, { apiKey: "faux-key", maxRetries: 0 });
			if ((await stream.result()).stopReason !== "stop" || !request) throw new Error(`recording failed: ${id}`);
			const input = { baseUrl: url, model: model.id, reasoning: false, compat, vision, system: "", messages: messages.map(({ role, content }) => ({ role, content })) };
			cases.push({ id: `${vision ? "vision" : "text"}-${id}`, input, request });
		}
	}
	const files = ["scripts/fixtures/openai-completions-images-recorder.ts", "packages/ai/src/providers/openai-completions.ts", "packages/ai/src/providers/openai-completions-compat.ts", "packages/ai/src/providers/transform-messages.ts", "packages/ai/src/utils/sanitize-unicode.ts", "node_modules/openai/package.json"];
	const source = Object.fromEntries(files.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
	console.log(JSON.stringify({ schema: "omk.openai-completions-images.v1", source, cases }));
} finally { globalThis.fetch = original; }
