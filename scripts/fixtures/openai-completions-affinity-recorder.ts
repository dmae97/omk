import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { CacheRetention, Context, Model } from "../../packages/ai/src/types.ts";

type Scenario = { id: string; baseUrl?: string; affinity?: boolean; retention?: CacheRetention; long?: boolean; session?: string };
const openai = "https://api.openai.com/v1";
const scenarios: Scenario[] = [
	{ id: "affinity-session", affinity: true, session: "sess-1" },
	{ id: "affinity-no-session", affinity: true },
	{ id: "affinity-empty-session", affinity: true, session: "" },
	{ id: "affinity-retention-none", affinity: true, retention: "none", session: "sess-1" },
	{ id: "affinity-retention-short", affinity: true, retention: "short", session: "sess-1" },
	{ id: "affinity-retention-long", affinity: true, retention: "long", long: true, session: "sess-1" },
	{ id: "affinity-false-session", affinity: false, session: "sess-1" },
	{ id: "affinity-absent-session", session: "sess-1" },
	{ id: "affinity-openai-long-session", baseUrl: openai, affinity: true, session: "x".repeat(70) },
	{ id: "affinity-openai-none", baseUrl: openai, affinity: true, retention: "none", session: "sess-1" },
	{ id: "affinity-internal-space", affinity: true, session: "a b\tc" },
	{ id: "affinity-visible-ascii", affinity: true, session: "A-z_0.9~!#$%&'*+^`|" },
];
const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const baseUrl = s.baseUrl ?? "https://synthetic.invalid/v1";
		const compat = {
			supportsStore: true, supportsDeveloperRole: true, supportsUsageInStreaming: true, maxTokensField: "max_completion_tokens", supportsStrictMode: true, requiresSystemMessageFirst: false,
			...(s.affinity === undefined ? {} : { sendSessionAffinityHeaders: s.affinity }), ...(s.long === undefined ? {} : { supportsLongCacheRetention: s.long }),
		} as const;
		const model: Model<"openai-completions"> = { id: "synthetic-completions", name: "Synthetic", api: "openai-completions", provider: "synthetic", baseUrl, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64, compat };
		const context: Context = { systemPrompt: "Synthetic system", messages: [{ role: "user", content: "Hello", timestamp: 0 }] };
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			if (request || String(url) !== `${baseUrl}/chat/completions` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
			request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
			return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
		};
		const result = await streamOpenAICompletions(model, context, { apiKey: "faux-key", maxTokens: 64, maxRetries: 0, ...(s.retention ? { cacheRetention: s.retention } : {}), ...(s.session === undefined ? {} : { sessionId: s.session }) }).result();
		if (result.stopReason !== "stop" || !request) throw new Error(`recording failed: ${s.id}`);
		cases.push({
			id: s.id,
			input: {
				provider: model.provider, baseUrl, model: model.id, reasoning: false, compat, system: "Synthetic system", messages: [{ role: "user", content: "Hello" }], tools: [], maxTokens: 64,
				...(s.retention ? { cacheRetention: s.retention } : {}), ...(s.session === undefined ? {} : { sessionId: s.session }),
			},
			request,
		});
	}
	const paths = ["scripts/fixtures/openai-completions-affinity-recorder.ts", "packages/ai/src/providers/openai-completions.ts", "packages/ai/src/providers/openai-completions-compat.ts", "packages/ai/src/providers/openai-prompt-cache.ts", "node_modules/openai/package.json"];
	console.log(JSON.stringify({ schema: "omk.openai-completions-affinity.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
