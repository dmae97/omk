import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type OpenAIResponsesOptions, streamOpenAIResponses } from "../../packages/ai/src/providers/openai-responses.ts";
import type { CacheRetention, Context, Model, OpenAIResponsesCompat, ThinkingLevelMap, Tool, UserMessage } from "../../packages/ai/src/types.ts";

type Spec = { name: string; description: string; properties: unknown; required: string[] };
type Scenario = {
	id: string; baseUrl?: string; provider?: string; reasoning?: boolean; compat?: OpenAIResponsesCompat; map?: ThinkingLevelMap;
	system?: string; messages?: UserMessage["content"][]; tools?: Spec[]; maxTokens?: number; temperature?: number;
	serviceTier?: OpenAIResponsesOptions["serviceTier"]; effort?: OpenAIResponsesOptions["reasoningEffort"]; summary?: OpenAIResponsesOptions["reasoningSummary"];
	retention?: CacheRetention; session?: string; boundary?: unknown; bypass?: boolean;
};
const openai = "https://api.openai.com/v1";
const read: Spec = { name: "read", description: "Read a file\n\"quoted\" 한글", properties: { path: { type: "string" } }, required: ["path"] };
const odd: Spec = {
	name: "Edit", description: "Edit", required: ["b", "10"],
	properties: { b: { type: "object", required: null, properties: { z: {}, y: { enum: [1.0, -0, 1e21, 0.1] } } }, "10": { type: "integer", minimum: -0 }, "2": {}, a: { type: "string" }, é: {}, "😀": {} },
};
const write: Spec = { name: "write", description: "", properties: {}, required: [] };
const scenarios: Scenario[] = [
	{ id: "plain" },
	{ id: "reasoning-default", reasoning: true },
	{ id: "empty-system", system: "" },
	{ id: "user-parts", messages: [[{ type: "text", text: "a" }, { type: "text", text: "😀 b\n\"c\"" }], "second", []] },
	{ id: "user-empty-text-part", messages: [[{ type: "text", text: "" }]] },
	{ id: "max-tokens", maxTokens: 64 },
	{ id: "max-tokens-zero", maxTokens: 0 },
	{ id: "temperature", temperature: 0.5 },
	{ id: "temperature-zero", temperature: 0 },
	{ id: "temperature-negative-zero", temperature: -0 },
	{ id: "temperature-exponent", temperature: 1e21 },
	{ id: "service-tier-priority", serviceTier: "priority" },
	{ id: "service-tier-flex", serviceTier: "flex" },
	{ id: "service-tier-auto", serviceTier: "auto" },
	{ id: "tools", tools: [write, read, odd] },
	{ id: "tools-empty", tools: [] },
	{ id: "effort-high", reasoning: true, effort: "high" },
	{ id: "effort-ultra", reasoning: true, effort: "ultra" },
	{ id: "effort-mapped", reasoning: true, effort: "high", map: { high: "xhigh" } },
	{ id: "effort-map-null", reasoning: true, effort: "low", map: { low: null } },
	{ id: "summary-only", reasoning: true, summary: "detailed" },
	{ id: "effort-summary", reasoning: true, effort: "minimal", summary: "concise" },
	{ id: "effort-summary-null", reasoning: true, effort: "medium", summary: null },
	{ id: "effort-non-reasoning", effort: "high", summary: "auto" },
	{ id: "off-null", reasoning: true, map: { off: null } },
	{ id: "off-mapped", reasoning: true, map: { off: "minimal" } },
	{ id: "off-empty", reasoning: true, map: { off: "" } },
	{ id: "off-null-with-effort", reasoning: true, effort: "high", map: { off: null } },
	{ id: "session-short", session: "sess-1" },
	{ id: "session-none", retention: "none", session: "sess-1" },
	{ id: "session-empty", session: "" },
	{ id: "session-no-id-header", compat: { sendSessionIdHeader: false }, session: "sess-1" },
	{ id: "session-long-clamped", session: "x".repeat(70) },
	{ id: "session-internal-space", session: "a b\tc" },
	{ id: "retention-long-default", retention: "long", session: "s" },
	{ id: "retention-long-unsupported", retention: "long", compat: { supportsLongCacheRetention: false } },
	{ id: "retention-long-no-session", retention: "long" },
	{ id: "content-key", boundary: 9, session: "s", tools: [read] },
	{ id: "content-key-canonical-tools", boundary: 9, tools: [read, odd] },
	{ id: "content-key-astral", system: "😀 cache 한글 tail", boundary: 2 },
	{ id: "boundary-null", boundary: null, session: "s" },
	{ id: "boundary-too-long", boundary: 99, session: "s" },
	{ id: "bypass", boundary: 9, bypass: true, session: "s" },
	{ id: "codex-metadata-false", compat: { sendCodexTurnMetadata: false }, session: "s" },
	{ id: "openai-host", baseUrl: openai, provider: "openai", session: "s" },
	{ id: "base-trailing-slash", baseUrl: "https://synthetic.invalid/v1/" },
	{ id: "base-root", baseUrl: "https://synthetic.invalid" },
];
const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const baseUrl = s.baseUrl ?? "https://synthetic.invalid/v1";
		const endpoint = `${baseUrl.replace(/\/$/, "")}/responses`;
		const model: Model<"openai-responses"> = {
			id: "synthetic-responses", name: "Synthetic", api: "openai-responses", provider: s.provider ?? "synthetic", baseUrl, reasoning: s.reasoning ?? false, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64,
			...(s.compat ? { compat: s.compat } : {}), ...(s.map ? { thinkingLevelMap: s.map } : {}),
		};
		const system = s.system ?? "Synthetic system 한글";
		const contents = s.messages ?? ["Hello"];
		// SAFETY: synthetic schemas are plain JSON; the oracle deliberately bypasses TypeBox to reach stableTools edge cases.
		const tools: Tool[] | undefined = s.tools?.map((t) => ({ name: t.name, description: t.description, parameters: { type: "object", properties: t.properties, required: t.required } as unknown as Tool["parameters"] }));
		const context: Context = { systemPrompt: system, messages: contents.map((content) => ({ role: "user", content, timestamp: 0 })), tools };
		if (Object.hasOwn(s, "boundary")) (context as { systemPromptCacheBoundary?: unknown }).systemPromptCacheBoundary = s.boundary;
		if (s.bypass !== undefined) context.systemPromptCacheBoundaryBypass = s.bypass;
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			if (request || String(url) !== endpoint || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
			request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
			const done = { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } };
			return new Response(`event: response.completed\ndata: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
		};
		const options: OpenAIResponsesOptions = {
			apiKey: "faux-key", maxRetries: 0,
			...(s.maxTokens === undefined ? {} : { maxTokens: s.maxTokens }), ...(s.temperature === undefined ? {} : { temperature: s.temperature }),
			...(s.serviceTier === undefined ? {} : { serviceTier: s.serviceTier }), ...(s.effort === undefined ? {} : { reasoningEffort: s.effort }),
			...(s.summary === undefined ? {} : { reasoningSummary: s.summary }), ...(s.retention ? { cacheRetention: s.retention } : {}),
			...(s.session === undefined ? {} : { sessionId: s.session }),
		};
		const result = await streamOpenAIResponses(model, context, options).result();
		if (result.stopReason !== "stop" || !request) throw new Error(`recording failed: ${s.id}: ${result.errorMessage}`);
		cases.push({
			id: s.id,
			input: {
				provider: model.provider, baseUrl, model: model.id, reasoning: model.reasoning, ...(s.compat ? { compat: s.compat } : {}), ...(s.map ? { thinkingLevelMap: s.map } : {}),
				system, messages: contents.map((content) => ({ role: "user", content })), tools: s.tools ?? [],
				...(s.maxTokens === undefined ? {} : { maxTokens: s.maxTokens }), ...(s.temperature === undefined ? {} : { temperature: s.temperature }),
				...(s.serviceTier === undefined ? {} : { serviceTier: s.serviceTier }), ...(s.effort === undefined ? {} : { reasoningEffort: s.effort }),
				...(s.summary === undefined ? {} : { reasoningSummary: s.summary }), ...(s.retention ? { cacheRetention: s.retention } : {}),
				...(s.session === undefined ? {} : { sessionId: s.session }),
				...(Object.hasOwn(s, "boundary") ? { systemPromptCacheBoundary: s.boundary } : {}), ...(s.bypass === undefined ? {} : { systemPromptCacheBoundaryBypass: s.bypass }),
			},
			request,
		});
	}
	const paths = [
		"scripts/fixtures/openai-responses-recorder.ts", "packages/ai/src/providers/openai-responses.ts", "packages/ai/src/providers/openai-responses-shared.ts",
		"packages/ai/src/providers/openai-prompt-cache.ts", "packages/ai/src/providers/prompt-cache.ts", "packages/ai/src/providers/tool-schema.ts", "node_modules/openai/package.json",
	];
	console.log(JSON.stringify({ schema: "omk.openai-responses-request.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
