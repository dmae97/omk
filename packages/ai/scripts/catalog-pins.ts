import type { Api, Model } from "../src/types.ts";

type Catalog = Record<string, Record<string, Model<Api>>>;

/** Upstream ids whose output includes a non-text modality; dropped only when not already in the catalog. */
export const NON_TEXT_OUTPUT_IDS = new Set<string>();

/** True when upstream lists a non-text output modality (e.g. audio for realtime voice models). */
export function isNonTextOutputModel(model: { modalities?: { output?: string[] } }): boolean {
	const output = model.modalities?.output;
	return Array.isArray(output) && output.some((modality) => modality !== "text");
}

/**
 * The Experiential Labs reasoning surface needs EXPLABS_API_KEY. Without it, reuse the entries
 * already committed so a keyless refresh does not drop that provider; with none committed, fail
 * exactly as the fetcher does.
 */
export async function experientialModelsOrCommitted(
	fetcher: () => Promise<Model<"openai-completions">[]>,
	committed: Catalog,
): Promise<Model<Api>[]> {
	if (process.env.EXPLABS_API_KEY ?? process.env.EXPERIENTIAL_API_KEY) return fetcher();
	const existing = Object.values(committed.experientiallabs ?? {});
	if (existing.length === 0) return fetcher();
	console.warn(
		`WARNING: no EXPLABS_API_KEY/EXPERIENTIAL_API_KEY; reusing ${existing.length} committed experiential labs models unchanged.`,
	);
	return existing.map((model) => structuredClone(model));
}

/** Ids upstream stopped listing that stay in the catalog. Each needs a reason. */
const KEEP_IDS: { provider: string; id: string; reason: string }[] = [
	{ provider: "azure-openai-responses", id: "gpt-5.2-chat-latest", reason: "dropped by upstream listing; existing users may pin it, removal needs separate review" },
	{ provider: "azure-openai-responses", id: "gpt-5.3-chat-latest", reason: "dropped by upstream listing; existing users may pin it, removal needs separate review" },
	{ provider: "openai", id: "gpt-5.2-chat-latest", reason: "dropped by models.dev; existing users may pin it, removal needs separate review" },
	{ provider: "openai", id: "gpt-5.3-chat-latest", reason: "dropped by models.dev; existing users may pin it, removal needs separate review" },
	{ provider: "opencode", id: "space-bunny-free", reason: "dropped by OpenCode Zen listing; removal needs separate review" },
	{ provider: "opencode", id: "deepseek-v4-flash", reason: "absent from current models.dev listing; removal needs separate review" },
	{ provider: "opencode-go", id: "space-bunny", reason: "dropped by OpenCode Go listing; removal needs separate review" },
	{ provider: "openrouter", id: "deepseek/deepseek-r1", reason: "dropped by OpenRouter /models; removal needs separate review" },
	{ provider: "openrouter", id: "arcee-ai/trinity-large-thinking", reason: "absent from current OpenRouter listing; removal needs separate review" },
	{ provider: "vercel-ai-gateway", id: "stealth/cat-jam", reason: "dropped by Vercel AI Gateway /models; removal needs separate review" },
];

/** Upstream-new ids not confirmed in the route's official model docs; excluded until verified. */
const EXCLUDE_UNVERIFIED_NEW_IDS: { provider: string; id: string; reason: string }[] = [
	{ provider: "opencode-go", id: "minimax-m3.1-flash-free", reason: "opencode-go-catalog.test.ts pins the live id set; add with that test update" },
	{ provider: "huggingface", id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "nvidia", id: "stepfun-ai/step-5-preview", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "openrouter", id: "inception/mercury-3", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "openrouter", id: "unbiased/pareto-26.10", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "together", id: "meta-models/Muse-Spark-Open-816B-A42B", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "together", id: "nvidia/NVIDIA-Nemotron-3.5-Super-VL", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "together", id: "reflection/Beam-1.0-501B-A23B", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash-1017-fast", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "vercel-ai-gateway", id: "inception/mercury-3", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
	{ provider: "vercel-ai-gateway", id: "minimax/minimax-m3.1-flash", reason: "not confirmed in official model docs (checked 2026-10-20 KST)" },
];

/** Fields kept at their committed values because the upstream change is unverified. */
const PINNED_FIELDS: { provider: string; id: string; fields: ("cost" | "contextWindow" | "maxTokens" | "thinkingLevelMap")[] }[] = [
	// grok-4.3/4.5 xhigh effort from models.dev is not confirmed on docs.x.ai; keep current maps.
	{ provider: "github-copilot", id: "grok-4.5", fields: ["thinkingLevelMap"] },
	{ provider: "opencode", id: "grok-4.5", fields: ["thinkingLevelMap"] },
	{ provider: "openrouter", id: "x-ai/grok-4.3", fields: ["thinkingLevelMap"] },
	{ provider: "openrouter", id: "x-ai/grok-4.3:batch", fields: ["thinkingLevelMap"] },
	{ provider: "openrouter", id: "x-ai/grok-4.5", fields: ["thinkingLevelMap"] },
	{ provider: "vercel-ai-gateway", id: "spacexai/grok-4.3", fields: ["thinkingLevelMap"] },
	{ provider: "vercel-ai-gateway", id: "spacexai/grok-4.5", fields: ["thinkingLevelMap"] },
	{ provider: "xai", id: "grok-4.3", fields: ["thinkingLevelMap"] },
	{ provider: "xai", id: "grok-4.5", fields: ["thinkingLevelMap"] },
	// OpenRouter/Together/Vercel price and cap moves seen on 2026-10-20 that no official doc confirms.
	{ provider: "openrouter", id: "deepseek/deepseek-chat", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "deepseek/deepseek-v4-flash-0731", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "deepseek/deepseek-v4-pro", fields: ["cost"] },
	{ provider: "openrouter", id: "deepseek/deepseek-v4-pro-0813", fields: ["maxTokens"] },
	{ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash", fields: ["cost"] },
	{ provider: "openrouter", id: "google/gemini-4-argon", fields: ["maxTokens"] },
	{ provider: "openrouter", id: "google/gemma-3-27b-it", fields: ["cost"] },
	{ provider: "openrouter", id: "google/gemma-4-26b-a4b-it", fields: ["cost"] },
	{ provider: "openrouter", id: "meta-llama/llama-4-maverick", fields: ["contextWindow"] },
	{ provider: "openrouter", id: "moonshotai/kimi-k3", fields: ["cost"] },
	{ provider: "openrouter", id: "nvidia/nemotron-3.5-super-vl", fields: ["cost"] },
	{ provider: "openrouter", id: "qwen/qwen3-30b-a3b-instruct-2507", fields: ["cost"] },
	{ provider: "openrouter", id: "qwen/qwen3.5-27b", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "qwen/qwen3.5-35b-a3b", fields: ["maxTokens"] },
	{ provider: "openrouter", id: "qwen/qwen3.5-397b-a17b", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "reflection/beam-1.0-501b-a23b", fields: ["cost"] },
	{ provider: "openrouter", id: "upstage/solar-pro4", fields: ["cost"] },
	{ provider: "openrouter", id: "z-ai/glm-4.6", fields: ["cost"] },
	{ provider: "openrouter", id: "z-ai/glm-5", fields: ["maxTokens"] },
	{ provider: "openrouter", id: "z-ai/glm-5.3", fields: ["cost"] },
	{ provider: "openrouter", id: "z-ai/glm-5.3-flash", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "~deepseek/deepseek-flash-latest", fields: ["cost", "maxTokens"] },
	{ provider: "openrouter", id: "~deepseek/deepseek-pro-latest", fields: ["cost"] },
	{ provider: "openrouter", id: "~deepseek/deepseek-v4-flash-latest", fields: ["cost"] },
	{ provider: "openrouter", id: "~google/gemini-pro-latest", fields: ["maxTokens"] },
	{ provider: "openrouter", id: "~moonshotai/kimi-latest", fields: ["cost"] },
	{ provider: "openrouter", id: "~unbiased/pareto-latest", fields: ["cost", "contextWindow"] },
	{ provider: "openrouter", id: "~z-ai/glm-flash-latest", fields: ["cost"] },
	{ provider: "openrouter", id: "~z-ai/glm-latest", fields: ["cost", "maxTokens"] },
	{ provider: "together", id: "Qwen/Qwen3.6-Plus", fields: ["maxTokens"] },
	{ provider: "together", id: "Qwen/Qwen3.7-Max", fields: ["maxTokens"] },
	{ provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash", fields: ["cost", "maxTokens"] },
	{ provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash-1017", fields: ["cost", "contextWindow", "maxTokens"] },
];

/** Values set from official provider docs. Each entry cites its source. */
const OVERRIDES: { provider: string; id: string; set: Partial<Pick<Model<Api>, "contextWindow" | "maxTokens">> & { cost?: Partial<Model<Api>["cost"]> } }[] = [
	// GPT-4.1 nano's documented max output is 32,768, not the 942,818 from the gateway listing.
	// https://developers.openai.com/api/docs/models/gpt-4.1-nano
	{ provider: "openrouter", id: "openai/gpt-4.1-nano", set: { maxTokens: 32768 } },
	// MiniMax-M3.1-Flash max output 524,288: https://platform.minimax.io/docs/api-reference/text-chat-openai
	{ provider: "opencode", id: "minimax-m3.1-flash-free", set: { maxTokens: 524288 } },
	{ provider: "openrouter", id: "minimax/minimax-m3.1-flash:free", set: { maxTokens: 524288 } },
	// DeepSeek-V4.1-Flash-1017 price peak 기준 (in 0.3 / out 1.2 / cache hit 0.006 per 1M):
	// https://api-docs.deepseek.com/quick_start/pricing
	// Max output: Fireworks cap unconfirmed, upstream value 384000 kept. DeepSeek direct API is
	// "384K (393216)": https://api-docs.deepseek.com/api/create-chat-completion
	{
		provider: "fireworks",
		id: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
		set: { maxTokens: 384000, cost: { input: 0.3, output: 1.2, cacheRead: 0.006 } },
	},
];

export function applyCatalogPins(models: Model<Api>[], committed: Catalog): Model<Api>[] {
	const key = (provider: string, id: string) => `${provider}\u0000${id}`;
	const excluded = new Set(EXCLUDE_UNVERIFIED_NEW_IDS.map((e) => key(e.provider, e.id)));
	const result = models.filter(
		(model) =>
			// This batch-only route is not verified for OMK's synchronous chat consumer.
			!(model.provider === "openrouter" && model.id === "openai/gpt-6.1-terra:batch") &&
			(committed[model.provider]?.[model.id] !== undefined ||
				!(excluded.has(key(model.provider, model.id)) || NON_TEXT_OUTPUT_IDS.has(model.id))),
	);
	const present = new Set(result.map((model) => key(model.provider, model.id)));
	for (const keep of KEEP_IDS) {
		const model = committed[keep.provider]?.[keep.id];
		if (!model) throw new Error(`keep-list entry ${keep.provider}/${keep.id} is not in the committed catalog`);
		if (!present.has(key(keep.provider, keep.id))) result.push(structuredClone(model));
	}
	for (const pin of PINNED_FIELDS) {
		const old = committed[pin.provider]?.[pin.id];
		const model = result.find((m) => m.provider === pin.provider && m.id === pin.id);
		if (!old || !model) continue;
		for (const field of pin.fields) {
			if (field === "cost") model.cost = structuredClone(old.cost);
			else if (field === "thinkingLevelMap") {
				if (old.thinkingLevelMap) model.thinkingLevelMap = structuredClone(old.thinkingLevelMap);
				else delete model.thinkingLevelMap;
			} else model[field] = old[field];
		}
	}
	// Stable thinkingLevelMap key order: the fixed THINKING_LEVEL_ORDER applies only to new or changed
	// maps; an unchanged map keeps its committed key order. Key-order-only diffs therefore never appear.
	for (const model of result) {
		if (!model.thinkingLevelMap) continue;
		const old = committed[model.provider]?.[model.id]?.thinkingLevelMap;
		model.thinkingLevelMap =
			old && sameEntries(old, model.thinkingLevelMap)
				? structuredClone(old)
				: orderThinkingLevelMap(model.thinkingLevelMap);
	}
	for (const override of OVERRIDES) {
		for (const model of result.filter((m) => m.provider === override.provider && m.id === override.id)) {
			const { cost, ...rest } = override.set;
			Object.assign(model, rest);
			if (cost) model.cost = { ...model.cost, ...cost };
		}
	}
	return result;
}

const THINKING_LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function orderThinkingLevelMap<T extends Record<string, unknown>>(map: T): T {
	const keys = Object.keys(map);
	const ordered = [
		...THINKING_LEVEL_ORDER.filter((k) => keys.includes(k)),
		...keys.filter((k) => !THINKING_LEVEL_ORDER.includes(k)).sort(),
	];
	return Object.fromEntries(ordered.map((k) => [k, map[k]])) as T;
}

function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const ka = Object.keys(a);
	return ka.length === Object.keys(b).length && ka.every((k) => k in b && a[k] === b[k]);
}
