import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { Message } from "../../packages/ai/src/types.ts";
import { model } from "./anthropic-provider-cases.ts";
import { scenarios } from "./anthropic-tool-history-cases.ts";

const files = [
	"scripts/fixtures/anthropic-tool-history-recorder.ts", "scripts/fixtures/anthropic-tool-history-cases.ts",
	"scripts/fixtures/anthropic-provider-cases.ts", "packages/ai/src/providers/anthropic.ts",
	"packages/ai/src/providers/anthropic-client.ts", "packages/ai/src/providers/anthropic-compat.ts",
	"packages/ai/src/providers/transform-messages.ts", "packages/ai/src/utils/sanitize-unicode.ts",
	"packages/ai/src/providers/anthropic-image-guard.ts", "node_modules/@anthropic-ai/sdk/package.json",
];
const originalFetch = globalThis.fetch;
const recorded = [];
try {
	for (const scenario of scenarios) {
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			if (String(url) !== "https://synthetic.invalid/v1/messages" || request) throw new Error("unexpected request or retry");
			if (typeof init?.body !== "string") throw new Error("expected SDK serialized request");
			const headers = Object.fromEntries([...new Headers(init.headers)].filter(([key]) => !key.startsWith("x-stainless-") && key !== "user-agent"));
			if (headers["x-api-key"] !== "faux-key" || headers.authorization) throw new Error("non-synthetic credential refused");
			request = { url: String(url), headers, body: init.body };
			return new Response("", { headers: { "content-type": "text/event-stream" } });
		};
		const messages: Message[] = scenario.history.map((message): Message => {
			if (message.role === "user") return { role: "user", content: message.text, timestamp: 0 };
			if (message.role === "toolResult") return { ...message, toolName: "read", timestamp: 0 };
			return { ...message, api: model.api, provider: model.provider, model: model.id, stopReason: message.stopReason ?? "stop", timestamp: 0,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		});
		const user = scenario.user ?? "Continue";
		messages.push({ role: "user", content: user, timestamp: 0 });
		const stream = streamAnthropic(model, { messages }, { apiKey: "faux-key", cacheRetention: "none", maxTokens: 64, maxRetries: 0 });
		for await (const _event of stream) { /* Drain the real provider without retaining mutable snapshots. */ }
		if (!request || (await stream.result()).stopReason === "error") throw new Error(`recording failed: ${scenario.id}`);
		recorded.push({ id: scenario.id, input: { model: model.id, maxTokens: 64, system: "", user, tools: [], history: scenario.history }, request });
	}
} finally {
	globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({
	schema: "omk.anthropic.tool-history.v1",
	source: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
	projection: { headersExcluded: ["x-stainless-*", "user-agent"], scope: "same-model tools, text results and thinking history, API key, cache disabled" },
	cases: recorded,
}, null, 2));
