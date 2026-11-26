import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAIResponses } from "../../packages/ai/src/providers/openai-responses.ts";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "../../packages/ai/src/types.ts";

type Part = TextContent | ImageContent;
type Item =
	| { role: "user"; content: string | Part[] }
	| { role: "assistant"; source: { provider: string; api: "openai-responses"; model: string }; content: AssistantMessage["content"]; stopReason: "toolUse" }
	| { role: "toolResult"; toolCallId: string; toolName: string; content: Part[]; isError: boolean };

const baseUrl = "https://synthetic.invalid/v1";
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const image: ImageContent = { type: "image", mimeType: "image/png", data: "cG5n" };
const opaque: ImageContent = { type: "image", mimeType: "image/svg+xml", data: "not normalized+/=\n\u2028" };
const empty: ImageContent = { type: "image", mimeType: "", data: "" };
const text = (t: string): TextContent => ({ type: "text", text: t });
const userMarker = text("(image omitted: model does not support images)");
const toolMarker = text("(tool image omitted: model does not support images)");
const source = { provider: "synthetic", api: "openai-responses" as const, model: "synthetic-responses" };
const results: Part[][] = [
	[image], [text("a"), image, text("b")], [text(""), image], [toolMarker, image, image], [text("only")], [],
	[opaque, text("x"), opaque], [userMarker, image], [empty, text("😀 \"q\"")],
];
const histories: { id: string; messages: Item[] }[] = [
	{ id: "user-only", messages: [{ role: "user", content: [image] }] },
	{ id: "user-ordered", messages: [{ role: "user", content: [text("앞"), image, opaque, text(""), opaque, text("끝")] }] },
	{ id: "user-literal-marker", messages: [{ role: "user", content: [userMarker, image, userMarker, text(" "), image, toolMarker, image] }] },
	{ id: "user-per-turn", messages: [{ role: "user", content: [image, image] }, { role: "user", content: [] }, { role: "user", content: "plain" }, { role: "user", content: [empty] }] },
	{
		id: "tool-results",
		messages: [
			{ role: "user", content: "go" },
			{ role: "assistant", source, stopReason: "toolUse", content: results.map((_, i) => ({ type: "toolCall", id: `c${i}|fc_${i}`, name: "f", arguments: {} })) },
			...results.map((content, i): Item => ({ role: "toolResult", toolCallId: `c${i}|fc_${i}`, toolName: "f", content, isError: i % 2 === 1 })),
			{ role: "user", content: [text("after"), image] },
			{ role: "assistant", source, stopReason: "toolUse", content: [{ type: "text", text: "t" }] },
		],
	},
];
const original = globalThis.fetch;
try {
	const cases = [];
	for (const vision of [true, false]) {
		const model: Model<"openai-responses"> = {
			id: source.model, name: "Synthetic", api: "openai-responses", provider: source.provider, baseUrl, reasoning: false,
			input: vision ? ["text", "image"] : ["text"], cost: usage.cost, contextWindow: 4096, maxTokens: 64,
		};
		for (const h of histories) {
			const messages: Message[] = h.messages.map((m): Message => {
				if (m.role === "assistant") {
					const { source: s, ...rest } = m;
					return { ...rest, ...s, usage, timestamp: 0 };
				}
				return { ...m, timestamp: 0 };
			});
			let request: { url: string; headers: Record<string, string>; body: string } | undefined;
			globalThis.fetch = async (url, init) => {
				const headers = new Headers(init?.headers);
				if (request || String(url) !== `${baseUrl}/responses` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
				request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
				const done = { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } };
				return new Response(`event: response.completed\ndata: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
			};
			const out = await streamOpenAIResponses(model, { systemPrompt: "Synthetic system", messages }, { apiKey: "faux-key", maxRetries: 0 }).result();
			if (out.stopReason !== "stop" || !request) throw new Error(`recording failed: ${h.id}: ${out.errorMessage}`);
			cases.push({ id: `${vision ? "vision" : "text"}-${h.id}`, input: { provider: model.provider, baseUrl, model: model.id, reasoning: false, vision, system: "Synthetic system", messages: h.messages }, request });
		}
	}
	const paths = [
		"scripts/fixtures/openai-responses-images-recorder.ts", "packages/ai/src/providers/openai-responses.ts", "packages/ai/src/providers/openai-responses-shared.ts",
		"packages/ai/src/providers/transform-messages.ts", "packages/ai/src/utils/sanitize-unicode.ts", "node_modules/openai/package.json",
	];
	console.log(JSON.stringify({ schema: "omk.openai-responses-images.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
