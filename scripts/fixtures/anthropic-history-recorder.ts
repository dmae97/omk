import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { Message } from "../../packages/ai/src/types.ts";
import { model } from "./anthropic-provider-cases.ts";

type TextHistory = { role: "user" | "assistant"; text: string };
const scenarios: { id: string; history: TextHistory[]; user: string; system?: string }[] = [
	{ id: "empty-history", history: [], user: "Hello" },
	{ id: "two-turn", history: [{ role: "user", text: "First" }, { role: "assistant", text: "Reply" }], user: "Next" },
	{ id: "unicode", history: [{ role: "assistant", text: "합성 🌍" }], user: "다음 🌏" },
	{ id: "blank-user", history: [{ role: "user", text: " \t\r\n" }, { role: "assistant", text: "Keep" }], user: "Next" },
	{ id: "blank-assistant", history: [{ role: "user", text: "Keep" }, { role: "assistant", text: "\uFEFF\u00A0" }], user: "Next" },
	{ id: "blank-final", history: [{ role: "assistant", text: "Keep" }], user: "\u2028\u2029" },
	{ id: "all-blank", history: [{ role: "assistant", text: " " }], user: "" },
	{ id: "next-line-is-text", history: [{ role: "user", text: "\u0085" }, { role: "assistant", text: "\u0085" }], user: "Next" },
	{ id: "trim-preserves-content", history: [{ role: "assistant", text: " \tReply\r\n " }], user: " Next " },
	{ id: "consecutive-roles", history: [{ role: "user", text: "One" }, { role: "user", text: "Two" }, { role: "assistant", text: "Three" }, { role: "assistant", text: "Four" }], user: "Five" },
	{ id: "escaped-content", history: [{ role: "assistant", text: "quote: \" slash: \\ nul: \0 tab:\t" }], user: "Line\nTwo", system: "Synthetic system" },
	{ id: "js-whitespace", history: [{ role: "user", text: "\u000B\u000C\u1680\u2000\u200A\u202F\u205F\u3000\uFEFF" }], user: "Next" },
];
const files = [
	"scripts/fixtures/anthropic-history-recorder.ts", "scripts/fixtures/anthropic-provider-cases.ts",
	"packages/ai/src/providers/anthropic.ts", "packages/ai/src/providers/anthropic-client.ts",
	"packages/ai/src/providers/anthropic-compat.ts", "packages/ai/src/providers/transform-messages.ts",
	"packages/ai/src/utils/sanitize-unicode.ts", "node_modules/@anthropic-ai/sdk/package.json",
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
		const messages: Message[] = scenario.history.map((message): Message => message.role === "user"
			? { role: "user", content: message.text, timestamp: 0 }
			: { role: "assistant", content: [{ type: "text", text: message.text }], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });
		messages.push({ role: "user", content: scenario.user, timestamp: 0 });
		const system = scenario.system ?? "";
		const stream = streamAnthropic(model, { messages, systemPrompt: system }, { apiKey: "faux-key", cacheRetention: "none", maxTokens: 64, maxRetries: 0 });
		for await (const _event of stream) { /* Drain the actual provider stream without retaining snapshots. */ }
		const result = await stream.result();
		if (!request || result.stopReason === "error") throw new Error(`recording failed: ${scenario.id}`);
		recorded.push({ id: scenario.id, input: { model: model.id, maxTokens: 64, system, user: scenario.user, tools: [], history: scenario.history }, request });
	}
} finally {
	globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({
	schema: "omk.anthropic.text-history.v1",
	source: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
	projection: { headersExcluded: ["x-stainless-*", "user-agent"], scope: "same-model text-only user/assistant history, API key, cache disabled" },
	cases: recorded,
}, null, 2));
