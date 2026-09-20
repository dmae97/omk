import type { Model, ModelThinkingLevel, OpenAICompletionsCompat } from "../src/types.ts";

const LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/**
 * WorkBuddy (Tencent CodeBuddy) cloud inference.
 *
 * Verified live on 2026-09-19 against `https://www.workbuddy.ai/v2/chat/completions`
 * with a `ck_…` plan key. The same key is accepted by `www.codebuddy.ai`; the
 * `.cn` hosts answered `401 {"message":"not_found"}` for it, so the endpoint is
 * pinned to the host that actually authenticated.
 *
 * Wire contract observed on this endpoint (each item reproduced with a minimal
 * request, not inferred from a third-party summary):
 *
 * - `stream: true` is required — `stream: false` answers
 *   `400 11101 "Non-stream chat request is currently not supported"`.
 * - The first message must be `role: "system"` — a leading user message answers
 *   `400 11128`, and the `developer` role is rejected by the same screen. An
 *   empty system message is accepted, so `requiresSystemMessageFirst` below is
 *   what keeps the channel legal when a caller has no system prompt.
 * - `max_tokens` is honoured; `max_completion_tokens` is accepted but ignored
 *   (a 20-token cap produced 298 completion tokens), so `maxTokensField` must
 *   stay `max_tokens`.
 * - Responses are OpenAI SSE with `delta.content`, `delta.reasoning_content`
 *   and indexed `delta.tool_calls`, and carry `usage` on the final chunk
 *   including `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
 * - Images travel as `image_url` data URIs, which is what this provider sends.
 *
 * Model list: the endpoint exposes no catalog REST route, so ids come from the
 * CLI's bundled `product.cloudhosted.json` / `product.json`
 * (`@tencent-ai/codebuddy-code@2.155.0`, dated 2026-09-19) **plus a cross-sweep
 * of this repository's own frontier ids** (243 candidates across the anthropic,
 * openai, google, xai, zai, moonshot, minimax, deepseek, meta and gateway
 * catalogs) on 2026-09-19. The cross-sweep found eight lanes the bundled
 * product JSON never declares — `claude-opus-5`, `claude-opus-4.6`,
 * `claude-sonnet-4.6`, `deepseek-v4.1-flash`, `gemini-3.8-flash`, `gpt-6-astra`,
 * `grok-4.6`, `hy4-preview` — so the bundled list alone under-reports the
 * service. Every row below answered `200` with real text on a streaming probe.
 * `glm-5.0` answered `429` on repeat attempts while its siblings answered `200`,
 * and the CLI's own role aliases (`fast-model`, `balanced-model`,
 * `primary-model`, `deep-model`, `default-model-lite`) resolve server-side to
 * targets this catalog cannot declare, so neither is listed. Entitlement is per
 * account: another plan may serve a different subset.
 *
 * Context window, output cap and image support come from the vendor's own lane
 * in this repository's catalogs for the ids the gateway serves without
 * declaring them (it exposes no per-model limits); they are the vendor's
 * documented figures, not gateway-declared ones.
 *
 * Thinking: only the effort values the product declares (or, for the lanes it
 * does not declare, the vendor's own values) are exposed, and each maps to
 * itself — plus OMK's documented `max` ceiling alias: a lane whose declared
 * ceiling is `xhigh` also maps `max` onto it, so `/thinking max` means "the
 * strongest this lane offers" instead of being silently dropped. Every mapped
 * value was probed on this endpoint; `off` stays unmapped everywhere, because
 * no disable literal was verified and several lanes reject it with
 * `400` (e.g. `deepseek-v4.1-flash`, `gpt-6-astra`, `claude-sonnet-4.6`). The
 * endpoint accepts `reasoning_effort` from this account for every probed model,
 * but its effect is not verified — `kimi-k3` produced MORE reasoning with
 * `"none"` than with `"high"` — so this catalog advertises accepted values and
 * claims nothing about the reasoning volume they produce.
 */
export const WORKBUDDY_BASE_URL = "https://www.workbuddy.ai/v2";

const WORKBUDDY_COMPAT: OpenAICompletionsCompat = {
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
	supportsUsageInStreaming: true,
	requiresSystemMessageFirst: true,
};

interface WorkbuddyModelRow {
	readonly id: string;
	readonly name: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly image: boolean;
	/** Declared reasoning effort values: the product catalog's, or the vendor lane's for gateway-only ids. */
	readonly efforts: readonly ModelThinkingLevel[];
	readonly reasoning?: boolean;
}

const ROWS: readonly WorkbuddyModelRow[] = [
	{ id: "auto", name: "Auto", contextWindow: 168_000, maxTokens: 32_000, image: true, efforts: [] },
	{ id: "hy3", name: "Hy3", contextWindow: 192_000, maxTokens: 64_000, image: true, efforts: ["low", "high"] },
	{ id: "glm-5.3", name: "GLM-5.3", contextWindow: 1_000_000, maxTokens: 48_000, image: true, efforts: ["low", "high", "max"] },
	{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 1_000_000, maxTokens: 48_000, image: true, efforts: ["high", "xhigh"] },
	{ id: "glm-5.1", name: "GLM-5.1", contextWindow: 200_000, maxTokens: 48_000, image: false, efforts: ["medium"] },
	// Lanes the gateway serves without declaring them in the bundled product JSON;
	// limits below are the vendor lane's own figures from this repository.
	{ id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
	{ id: "claude-opus-4.6", name: "Claude Opus 4.6", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "max"] },
	{ id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "max"] },
	{ id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: 1_000_000, maxTokens: 384_000, image: true, efforts: ["low", "high", "max"] },
	{ id: "gemini-3.8-flash", name: "Gemini-3.8-Flash", contextWindow: 1_048_576, maxTokens: 65_536, image: true, efforts: ["low", "medium", "high"] },
	{ id: "gpt-6-astra", name: "GPT-6 Astra", contextWindow: 1_050_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
	{ id: "grok-4.6", name: "Grok 4.6", contextWindow: 500_000, maxTokens: 500_000, image: true, efforts: ["low", "medium", "high", "xhigh"] },
	{ id: "hy4-preview", name: "Hunyuan hy4 Preview", contextWindow: 1_048_576, maxTokens: 64_000, image: false, efforts: ["low", "high"] },
	{ id: "glm-5v-turbo", name: "GLM-5v-Turbo", contextWindow: 200_000, maxTokens: 38_000, image: true, efforts: ["medium"] },
	{ id: "kimi-k3", name: "Kimi-K3", contextWindow: 1_000_000, maxTokens: 32_000, image: true, efforts: ["medium"] },
	{ id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 256_000, maxTokens: 32_000, image: true, efforts: ["medium"] },
	{ id: "kimi-k2.5", name: "Kimi-K2.5", contextWindow: 164_000, maxTokens: 32_000, image: true, efforts: ["high"] },
	{ id: "minimax-m3", name: "MiniMax-M3", contextWindow: 512_000, maxTokens: 128_000, image: true, efforts: ["medium"] },
	{ id: "gemini-3.5-flash", name: "Gemini-3.5-Flash", contextWindow: 1_000_000, maxTokens: 65_536, image: true, efforts: ["medium"] },
	{
		id: "gemini-3.1-pro",
		name: "Gemini-3.1-Pro",
		contextWindow: 400_000,
		maxTokens: 64_000,
		image: true,
		efforts: [],
		reasoning: true,
	},
	{ id: "gpt-5.6-sol", name: "GPT-5.6-Sol", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "xhigh"] },
	{ id: "gpt-5.6-terra", name: "GPT-5.6-Terra", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "xhigh"] },
	{ id: "gpt-5.6-luna", name: "GPT-5.6-Luna", contextWindow: 1_000_000, maxTokens: 128_000, image: true, efforts: ["low", "medium", "high", "xhigh"] },
	{ id: "gpt-5.5", name: "GPT-5.5", contextWindow: 1_000_000, maxTokens: 72_000, image: true, efforts: ["high"] },
	{ id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272_000, maxTokens: 128_000, image: true, efforts: ["high"] },
	{ id: "gpt-5.3-codex", name: "GPT-5.3-Codex", contextWindow: 272_000, maxTokens: 128_000, image: true, efforts: ["high"] },
	{ id: "deepseek-v3-0324", name: "DeepSeek-V3 0324", contextWindow: 128_000, maxTokens: 8_192, image: false, efforts: [] },
];

/**
 * The account's WorkBuddy lanes.
 *
 * Cost is zero, not free: the plan bills in the provider's own credit unit
 * (`credits` in the product catalog, e.g. `x0.79 credits`), which is not a USD
 * per-million-token rate this catalog could honestly convert. `usedTokens`
 * still drives the context budget; billing has to be read from the provider.
 */
export function workbuddyModels(): Model<"openai-completions">[] {
	return ROWS.map((row) => {
		const model: Model<"openai-completions"> = {
			id: row.id,
			name: `${row.name} (WorkBuddy)`,
			api: "openai-completions",
			provider: "workbuddy",
			baseUrl: WORKBUDDY_BASE_URL,
			compat: row.efforts.length === 0 && row.reasoning === true
				? { ...WORKBUDDY_COMPAT, supportsReasoningEffort: false }
				: WORKBUDDY_COMPAT,
			reasoning: row.efforts.length > 0 || row.reasoning === true,
			input: row.image ? ["text", "image"] : ["text"],
			contextWindow: row.contextWindow,
			maxTokens: row.maxTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		// Every level is declared explicitly so an unmapped tier is hidden rather
		// than sent as its own raw name to a provider that may not accept it. A
		// declared `xhigh` ceiling also carries OMK's `max` label onto it, matching
		// the Muse Spark convention: `max` means the strongest tier the lane offers.
		model.thinkingLevelMap = Object.fromEntries(
			LEVELS.map((level) => {
				if (row.efforts.includes(level)) return [level, level];
				if (level === "max" && row.efforts.includes("xhigh")) return [level, "xhigh"];
				return [level, null];
			}),
		);
		return model;
	});
}
