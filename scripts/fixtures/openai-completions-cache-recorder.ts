import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { CacheRetention, Context, Model, Tool } from "../../packages/ai/src/types.ts";

type Spec = { name: string; description: string; properties: unknown; required: string[] };
type Scenario = {
	id: string; baseUrl?: string; provider?: string; model?: string; retention?: CacheRetention; session?: string;
	long?: boolean; system?: string; boundary?: unknown; bypass?: boolean; tools?: Spec[];
};
const openai = "https://api.openai.com/v1";
const read: Spec = { name: "read", description: "Read a file\n\"quoted\" 한글", properties: { path: { type: "string" } }, required: ["path"] };
const odd: Spec = {
	name: "Edit", description: "Edit", required: ["b", "10"],
	properties: { b: { type: "object", required: null, properties: { z: {}, y: { enum: [1.0, -0, 1e21, 0.1] } } }, "10": { type: "integer", minimum: -0 }, "2": {}, a: { type: "string" }, é: {}, "😀": {}, "\uE000": {} },
};
const scenarios: Scenario[] = [
	{ id: "short-synthetic-session", retention: "short", session: "s" },
	{ id: "none-openai-session", baseUrl: openai, retention: "none", session: "s" },
	{ id: "short-openai-session", baseUrl: openai, retention: "short", session: "sess-1" },
	{ id: "default-openai-session", baseUrl: openai, session: "sess-default" },
	{ id: "short-openai-no-session", baseUrl: openai, retention: "short" },
	{ id: "short-openai-empty-session", baseUrl: openai, retention: "short", session: "" },
	{ id: "short-openai-long-session", baseUrl: openai, retention: "short", session: "x".repeat(70) },
	{ id: "short-openai-astral-session", baseUrl: openai, retention: "short", session: `${"a".repeat(63)}😀😀` },
	{ id: "substring-host-session", baseUrl: "https://api.openai.com.synthetic.invalid/v1", retention: "short", session: "s" },
	{ id: "long-supported-synthetic", retention: "long", long: true, session: "s" },
	{ id: "long-supported-no-session", retention: "long", long: true },
	{ id: "long-unsupported-synthetic", retention: "long", long: false, session: "s" },
	{ id: "long-unsupported-openai", baseUrl: openai, retention: "long", long: false, session: "s" },
	{ id: "long-supported-openai", baseUrl: openai, retention: "long", long: true, session: "s" },
	{ id: "none-supported-flag", retention: "none", long: true, session: "s" },
	{ id: "short-supported-flag-synthetic", retention: "short", long: true, session: "s" },
	{ id: "content-key", baseUrl: openai, retention: "short", boundary: 9, tools: [read] },
	{ id: "content-key-no-tools", baseUrl: openai, retention: "short", boundary: 9 },
	{ id: "content-key-full-length", baseUrl: openai, retention: "short", boundary: 19 },
	{ id: "content-key-beats-session", baseUrl: openai, retention: "short", boundary: 4, session: "s" },
	{ id: "content-key-canonical-tools", baseUrl: openai, retention: "short", boundary: 9, tools: [read, odd] },
	{ id: "content-key-scope", baseUrl: openai, provider: "openai", model: "gpt-synthetic", retention: "short", boundary: 9 },
	{ id: "content-key-long", retention: "long", long: true, boundary: 9, session: "s", tools: [read] },
	{ id: "content-key-astral-prefix", baseUrl: openai, retention: "short", system: "😀 cache 한글 tail", boundary: 2 },
	{ id: "boundary-zero", baseUrl: openai, retention: "short", boundary: 0, session: "s" },
	{ id: "boundary-negative", baseUrl: openai, retention: "short", boundary: -1, session: "s" },
	{ id: "boundary-too-long", baseUrl: openai, retention: "short", boundary: 20, session: "s" },
	{ id: "boundary-fraction", baseUrl: openai, retention: "short", boundary: 1.5, session: "s" },
	{ id: "boundary-null", baseUrl: openai, retention: "short", boundary: null, session: "s" },
	{ id: "boundary-string", baseUrl: openai, retention: "short", boundary: "3", session: "s" },
	{ id: "bypass-with-boundary", baseUrl: openai, retention: "short", boundary: 9, bypass: true, session: "s" },
	{ id: "bypass-without-boundary", baseUrl: openai, retention: "short", bypass: true, session: "s" },
	{ id: "bypass-false", baseUrl: openai, retention: "short", bypass: false, session: "s" },
	{ id: "empty-system-boundary", baseUrl: openai, retention: "short", system: "", boundary: 1, session: "s" },
	{ id: "boundary-without-key-policy", retention: "short", boundary: 9, session: "s" },
];
const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const baseUrl = s.baseUrl ?? "https://synthetic.invalid/v1";
		const compat = { supportsStore: true, supportsDeveloperRole: true, supportsUsageInStreaming: true, maxTokensField: "max_completion_tokens", supportsStrictMode: true, requiresSystemMessageFirst: false, ...(s.long === undefined ? {} : { supportsLongCacheRetention: s.long }) } as const;
		const model: Model<"openai-completions"> = { id: s.model ?? "synthetic-completions", name: "Synthetic", api: "openai-completions", provider: s.provider ?? "synthetic", baseUrl, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64, compat };
		const system = s.system ?? "Synthetic system 한글";
		const tools: Tool[] | undefined = s.tools?.map((t) => ({ name: t.name, description: t.description, parameters: { type: "object", properties: t.properties, required: t.required } as unknown as Tool["parameters"] }));
		const context: Context = { systemPrompt: system, messages: [{ role: "user", content: "Hello", timestamp: 0 }], tools };
		if (Object.hasOwn(s, "boundary")) (context as { systemPromptCacheBoundary?: unknown }).systemPromptCacheBoundary = s.boundary;
		if (s.bypass !== undefined) context.systemPromptCacheBoundaryBypass = s.bypass;
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
				provider: model.provider, baseUrl, model: model.id, reasoning: false, compat, system, messages: [{ role: "user", content: "Hello" }], tools: s.tools ?? [], maxTokens: 64,
				...(s.retention ? { cacheRetention: s.retention } : {}), ...(s.session === undefined ? {} : { sessionId: s.session }),
				...(Object.hasOwn(s, "boundary") ? { systemPromptCacheBoundary: s.boundary } : {}), ...(s.bypass === undefined ? {} : { systemPromptCacheBoundaryBypass: s.bypass }),
			},
			request,
		});
	}
	const paths = ["scripts/fixtures/openai-completions-cache-recorder.ts", "packages/ai/src/providers/openai-completions.ts", "packages/ai/src/providers/openai-prompt-cache.ts", "packages/ai/src/providers/prompt-cache.ts", "packages/ai/src/providers/tool-schema.ts", "packages/ai/src/utils/hash.ts", "node_modules/openai/package.json"];
	console.log(JSON.stringify({ schema: "omk.openai-completions-cache.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
