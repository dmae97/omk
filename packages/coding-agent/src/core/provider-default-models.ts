import type { KnownProvider } from "omk-ai";

/** Default model IDs for every built-in provider. */
const builtInDefaultModelPerProvider = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	"ant-ling": "Ring-2.6-1T",
	anthropic: "claude-opus-4-8",
	openai: "gpt-5.4",
	"azure-openai-responses": "gpt-5.4",
	"openai-codex": "gpt-5.5",
	nvidia: "nvidia/nemotron-3-super-120b-a12b",
	deepseek: "deepseek-v4-pro",
	devin: "swe-2",
	meta: "muse-spark-1.3",
	google: "gemini-3.1-pro-preview",
	"google-vertex": "gemini-3.1-pro-preview",
	"github-copilot": "gpt-5.4",
	openrouter: "moonshotai/kimi-k2.6",
	"vercel-ai-gateway": "zai/glm-5.1",
	xai: "grok-4.20-0309-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.7",
	zai: "glm-5.1",
	"zai-coding-cn": "glm-5.1",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M2.7",
	"minimax-cn": "MiniMax-M2.7",
	moonshotai: "kimi-k2.6",
	"moonshotai-cn": "kimi-k2.6",
	huggingface: "moonshotai/Kimi-K2.6",
	fireworks: "accounts/fireworks/models/kimi-k3",
	together: "moonshotai/Kimi-K3",
	opencode: "kimi-k2.6",
	"opencode-go": "deepseek-v4.1-flash",
	"kimi-coding": "k3",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
	xiaomi: "mimo-v2.5-pro",
	"xiaomi-token-plan-cn": "mimo-v2.5-pro",
	"xiaomi-token-plan-ams": "mimo-v2.5-pro",
	"xiaomi-token-plan-sgp": "mimo-v2.5-pro",
	zyloo: "claude-opus-4-7",
	cursor: "default",
	workbuddy: "auto",
} satisfies Record<KnownProvider, string>;

/** Recommended defaults for providers supplied through models.json or extensions. */
const customDefaultModelPerProvider = {
	"modelstudio-maas": "qwen3.8-max",
} as const satisfies Readonly<Record<string, string>>;

export const defaultModelPerProvider = {
	...builtInDefaultModelPerProvider,
	...customDefaultModelPerProvider,
} as const;

/** Providers that authenticate from ambient cloud credential chains rather than a provider-specific key. */
export const AMBIENT_CREDENTIAL_PROVIDERS: ReadonlySet<string> = new Set(["amazon-bedrock", "google-vertex"]);

/**
 * Where a provider's credential came from, as reported by `AuthStorage.getAuthStatus(...).source`
 * ("stored", "runtime", "environment", "fallback", "models_json_key", ...). Only "stored" and
 * "runtime" count as deliberate, so the type stays open to sources added later.
 */
export type CredentialSource = string | undefined;

const providerTableOrder: readonly string[] = Object.keys(defaultModelPerProvider);
const defaultIdByProvider: Readonly<Record<string, string>> = defaultModelPerProvider;

/**
 * Pick the default model among usable ones. Rank first by how deliberately the credential was
 * configured, then by the provider table order: 0 = stored by /login or passed with --api-key,
 * 1 = provider-specific key or models.json config, 2 = ambient cloud chains (AWS_PROFILE, ADC) that
 * often exist for unrelated work. Without the tier, table order alone let ambient AWS keys outrank
 * an explicit ANTHROPIC_API_KEY.
 */
export function pickDefaultModel<T extends { readonly provider: string; readonly id: string }>(
	usable: readonly T[],
	sourceOf: (provider: string) => CredentialSource,
): T | undefined {
	let best: { readonly model: T; readonly tier: number; readonly order: number } | undefined;
	for (const model of usable) {
		const order = providerTableOrder.indexOf(model.provider);
		if (order === -1 || defaultIdByProvider[model.provider] !== model.id) continue;
		const source = sourceOf(model.provider);
		const tier =
			source === "stored" || source === "runtime" ? 0 : AMBIENT_CREDENTIAL_PROVIDERS.has(model.provider) ? 2 : 1;
		if (!best || tier < best.tier || (tier === best.tier && order < best.order)) best = { model, tier, order };
	}
	return best?.model;
}
