import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { Model, OpenAICompletionsCompat, ThinkingLevel, ThinkingLevelMap } from "../../packages/ai/src/types.ts";

type Format = NonNullable<OpenAICompletionsCompat["thinkingFormat"]>;
type Scenario = { id: string; format: Format; effort?: ThinkingLevel; supports?: boolean; reasoning?: boolean; map?: ThinkingLevelMap; baseUrl?: string; model?: string; tools?: boolean };
const synthetic = "https://synthetic.invalid/v1";
const studio = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const scenarios: Scenario[] = [
	{ id: "openai-effort", format: "openai", effort: "high" },
	{ id: "openai-effort-tools", format: "openai", effort: "low", tools: true },
	{ id: "openai-mapped", format: "openai", effort: "high", map: { high: "max-x" } },
	{ id: "openai-mapped-null", format: "openai", effort: "high", map: { high: null } },
	{ id: "openai-off-string", format: "openai", map: { off: "none" } },
	{ id: "openai-off-null", format: "openai", map: { off: null } },
	{ id: "openai-unsupported", format: "openai", effort: "high", supports: false },
	{ id: "openai-unsupported-off", format: "openai", supports: false, map: { off: "none" } },
	{ id: "openai-not-reasoning", format: "openai", effort: "high", reasoning: false },
	{ id: "openai-ultra", format: "openai", effort: "ultra" },
	{ id: "openrouter-effort", format: "openrouter", effort: "medium", tools: true },
	{ id: "openrouter-mapped", format: "openrouter", effort: "xhigh", map: { xhigh: "high" } },
	{ id: "openrouter-off-default", format: "openrouter" },
	{ id: "openrouter-off-string", format: "openrouter", map: { off: "minimal" } },
	{ id: "openrouter-off-none", format: "openrouter", map: { off: "none" } },
	{ id: "openrouter-off-null", format: "openrouter", map: { off: null } },
	{ id: "openrouter-unsupported", format: "openrouter", effort: "low", supports: false },
	{ id: "openrouter-not-reasoning", format: "openrouter", effort: "low", reasoning: false },
	{ id: "deepseek-effort", format: "deepseek", effort: "max", tools: true },
	{ id: "deepseek-unsupported", format: "deepseek", effort: "high", supports: false },
	{ id: "deepseek-off", format: "deepseek" },
	{ id: "deepseek-not-reasoning", format: "deepseek", effort: "high", reasoning: false },
	{ id: "together-effort", format: "together", effort: "minimal", map: { minimal: "low" } },
	{ id: "together-unsupported", format: "together", effort: "minimal", supports: false },
	{ id: "together-off", format: "together" },
	{ id: "zai-effort", format: "zai", effort: "high" },
	{ id: "zai-unsupported", format: "zai", effort: "high", supports: false },
	{ id: "zai-off", format: "zai", map: { off: "none" } },
	{ id: "qwen-effort-generic-host", format: "qwen", effort: "high" },
	{ id: "qwen-effort-studio", format: "qwen", effort: "high", baseUrl: studio, tools: true },
	{ id: "qwen-studio-unsupported", format: "qwen", effort: "high", baseUrl: studio, supports: false },
	{ id: "qwen-studio-deepseek-minimal", format: "qwen", effort: "minimal", baseUrl: studio, model: "deepseek-v4-flash" },
	{ id: "qwen-studio-deepseek-minimal-mapped", format: "qwen", effort: "minimal", baseUrl: studio, model: "deepseek-v4-flash", map: { minimal: "tiny" } },
	{ id: "qwen-studio-other-minimal", format: "qwen", effort: "minimal", baseUrl: studio },
	{ id: "qwen-off", format: "qwen", baseUrl: studio },
	{ id: "qwen-chat-template-effort", format: "qwen-chat-template", effort: "low" },
	{ id: "qwen-chat-template-off", format: "qwen-chat-template" },
	{ id: "string-thinking-effort", format: "string-thinking", effort: "high", map: { high: "deep" } },
	{ id: "string-thinking-off-default", format: "string-thinking" },
	{ id: "string-thinking-off-string", format: "string-thinking", map: { off: "low" } },
	{ id: "string-thinking-off-null", format: "string-thinking", map: { off: null } },
	{ id: "ant-ling-mapped", format: "ant-ling", effort: "high", map: { high: "high" } },
	{ id: "ant-ling-unmapped", format: "ant-ling", effort: "high" },
	{ id: "ant-ling-null", format: "ant-ling", effort: "high", map: { high: null } },
	{ id: "ant-ling-off", format: "ant-ling", map: { off: "none" } },
];
const tool = { name: "read", description: "Synthetic read", properties: { path: { type: "string" } }, required: ["path"] };
const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const baseUrl = s.baseUrl ?? synthetic;
		const compat = { supportsStore: true, supportsDeveloperRole: true, supportsUsageInStreaming: true, maxTokensField: "max_completion_tokens", supportsStrictMode: true, requiresSystemMessageFirst: false, thinkingFormat: s.format, supportsReasoningEffort: s.supports ?? true } as const;
		const reasoning = s.reasoning ?? true;
		const model: Model<"openai-completions"> = { id: s.model ?? "synthetic-completions", name: "Synthetic", api: "openai-completions", provider: "synthetic", baseUrl, reasoning, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64, compat, ...(s.map ? { thinkingLevelMap: s.map } : {}) };
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			if (request || String(url) !== `${baseUrl}/chat/completions` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
			request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
			return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
		};
		const tools = s.tools ? [{ name: tool.name, description: tool.description, parameters: { type: "object", properties: tool.properties, required: tool.required } as never }] : undefined;
		const result = await streamOpenAICompletions(model, { systemPrompt: "Synthetic", messages: [{ role: "user", content: "Hello", timestamp: 0 }], tools }, { apiKey: "faux-key", maxTokens: 64, maxRetries: 0, reasoningEffort: s.effort, ...(s.tools ? { toolChoice: "auto" as const } : {}) }).result();
		if (result.stopReason !== "stop" || !request) throw new Error(`recording failed: ${s.id}`);
		cases.push({ id: s.id, input: { provider: model.provider, baseUrl, model: model.id, reasoning, compat, system: "Synthetic", messages: [{ role: "user", content: "Hello" }], tools: s.tools ? [tool] : [], maxTokens: 64, ...(s.tools ? { toolChoice: "auto" } : {}), ...(s.effort ? { reasoningEffort: s.effort } : {}), ...(s.map ? { thinkingLevelMap: s.map } : {}) }, request });
	}
	const paths = ["scripts/fixtures/openai-completions-effort-recorder.ts", "packages/ai/src/providers/openai-completions.ts", "packages/ai/src/providers/openai-completions-compat.ts", "node_modules/openai/package.json"];
	console.log(JSON.stringify({ schema: "omk.openai-completions-effort.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
