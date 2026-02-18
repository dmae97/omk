/**
 * Unified provider descriptors — single source of truth for provider metadata
 * used by both runtime model discovery (model-registry.ts) and catalog
 * generation (generate-models.ts).
 */
import type { ModelManagerOptions } from "../model-manager";
import type { Api, KnownProvider } from "../types";
import type { OAuthProvider } from "../utils/oauth/types";
import { googleModelManagerOptions } from "./google";
import {
	anthropicModelManagerOptions,
	cerebrasModelManagerOptions,
	cloudflareAiGatewayModelManagerOptions,
	githubCopilotModelManagerOptions,
	groqModelManagerOptions,
	huggingfaceModelManagerOptions,
	kimiCodeModelManagerOptions,
	litellmModelManagerOptions,
	mistralModelManagerOptions,
	moonshotModelManagerOptions,
	nvidiaModelManagerOptions,
	ollamaModelManagerOptions,
	openaiModelManagerOptions,
	opencodeModelManagerOptions,
	openrouterModelManagerOptions,
	qianfanModelManagerOptions,
	qwenPortalModelManagerOptions,
	syntheticModelManagerOptions,
	togetherModelManagerOptions,
	veniceModelManagerOptions,
	vercelAiGatewayModelManagerOptions,
	vllmModelManagerOptions,
	xaiModelManagerOptions,
	xiaomiModelManagerOptions,
} from "./openai-compat";
import { cursorModelManagerOptions } from "./special";

/** Catalog discovery configuration for providers that support endpoint-based model listing. */
export interface CatalogDiscoveryConfig {
	/** Human-readable name for log messages. */
	label: string;
	/** Environment variables to check for API keys during catalog generation. */
	envVars: string[];
	/** OAuth provider for credential refresh during catalog generation. */
	oauthProvider?: OAuthProvider;
	/** When true, catalog discovery proceeds even without credentials. */
	allowUnauthenticated?: boolean;
}

/** Unified provider descriptor used by both runtime discovery and catalog generation. */
export interface ProviderDescriptor {
	providerId: KnownProvider;
	createModelManagerOptions(config: { apiKey?: string; baseUrl?: string }): ModelManagerOptions<Api>;
	/** Preferred model ID when no explicit selection is made. */
	defaultModel: string;
	/** When true, the runtime creates a model manager even without a valid API key (e.g. ollama). */
	allowUnauthenticated?: boolean;
	/** Catalog discovery configuration. Only providers with this field participate in generate-models.ts. */
	catalogDiscovery?: CatalogDiscoveryConfig;
}

/** A provider descriptor that has catalog discovery configured. */
export type CatalogProviderDescriptor = ProviderDescriptor & { catalogDiscovery: CatalogDiscoveryConfig };

/** Type guard for descriptors with catalog discovery. */
export function isCatalogDescriptor(d: ProviderDescriptor): d is CatalogProviderDescriptor {
	return d.catalogDiscovery != null;
}

/** Whether catalog discovery may run without provider credentials. */
export function allowsUnauthenticatedCatalogDiscovery(descriptor: CatalogProviderDescriptor): boolean {
	return descriptor.catalogDiscovery.allowUnauthenticated ?? descriptor.allowUnauthenticated ?? false;
}

/**
 * All standard providers. Special providers (google-antigravity, google-gemini-cli,
 * openai-codex) are handled separately because they require different config shapes.
 */
export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
	{
		providerId: "anthropic",
		defaultModel: "claude-sonnet-4-6",
		createModelManagerOptions: config => anthropicModelManagerOptions(config),
	},
	{
		providerId: "openai",
		defaultModel: "gpt-5.1-codex",
		createModelManagerOptions: config => openaiModelManagerOptions(config),
	},
	{
		providerId: "groq",
		defaultModel: "openai/gpt-oss-120b",
		createModelManagerOptions: config => groqModelManagerOptions(config),
	},
	{
		providerId: "huggingface",
		defaultModel: "deepseek-ai/DeepSeek-R1",
		createModelManagerOptions: config => huggingfaceModelManagerOptions(config),
		catalogDiscovery: {
			label: "Hugging Face",
			envVars: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
		},
	},
	{
		providerId: "cerebras",
		defaultModel: "zai-glm-4.6",
		createModelManagerOptions: config => cerebrasModelManagerOptions(config),
		catalogDiscovery: {
			label: "Cerebras",
			envVars: ["CEREBRAS_API_KEY"],
		},
	},
	{
		providerId: "xai",
		defaultModel: "grok-4-fast-non-reasoning",
		createModelManagerOptions: config => xaiModelManagerOptions(config),
	},
	{
		providerId: "mistral",
		defaultModel: "devstral-medium-latest",
		createModelManagerOptions: config => mistralModelManagerOptions(config),
	},
	{
		providerId: "nvidia",
		defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
		createModelManagerOptions: config => nvidiaModelManagerOptions(config),
		catalogDiscovery: {
			label: "NVIDIA",
			envVars: ["NVIDIA_API_KEY"],
		},
	},
	{
		providerId: "opencode",
		defaultModel: "claude-sonnet-4-6",
		createModelManagerOptions: config => opencodeModelManagerOptions(config),
	},
	{
		providerId: "openrouter",
		defaultModel: "openai/gpt-5.1-codex",
		createModelManagerOptions: config => openrouterModelManagerOptions(config),
		catalogDiscovery: {
			label: "OpenRouter",
			envVars: ["OPENROUTER_API_KEY"],
			allowUnauthenticated: true,
		},
	},
	{
		providerId: "vercel-ai-gateway",
		defaultModel: "anthropic/claude-sonnet-4-6",
		createModelManagerOptions: config => vercelAiGatewayModelManagerOptions(config),
		catalogDiscovery: {
			label: "Vercel AI Gateway",
			envVars: ["VERCEL_AI_GATEWAY_API_KEY"],
			allowUnauthenticated: true,
		},
	},
	{
		providerId: "ollama",
		defaultModel: "gpt-oss:20b",
		createModelManagerOptions: config => ollamaModelManagerOptions(config),
		allowUnauthenticated: true,
		catalogDiscovery: {
			label: "Ollama",
			envVars: ["OLLAMA_API_KEY"],
		},
	},
	{
		providerId: "cloudflare-ai-gateway",
		defaultModel: "claude-sonnet-4-5",
		createModelManagerOptions: config => cloudflareAiGatewayModelManagerOptions(config),
		catalogDiscovery: {
			label: "Cloudflare AI Gateway",
			envVars: ["CLOUDFLARE_AI_GATEWAY_API_KEY"],
		},
	},
	{
		providerId: "kimi-code",
		defaultModel: "kimi-k2.5",
		createModelManagerOptions: config => kimiCodeModelManagerOptions(config),
		catalogDiscovery: {
			label: "Kimi Code",
			envVars: ["KIMI_API_KEY"],
		},
	},
	{
		providerId: "qwen-portal",
		defaultModel: "coder-model",
		createModelManagerOptions: config => qwenPortalModelManagerOptions(config),
		catalogDiscovery: {
			label: "Qwen Portal",
			envVars: ["QWEN_OAUTH_TOKEN", "QWEN_PORTAL_API_KEY"],
			oauthProvider: "qwen-portal",
		},
	},
	{
		providerId: "synthetic",
		defaultModel: "hf:moonshotai/Kimi-K2.5",
		createModelManagerOptions: config => syntheticModelManagerOptions(config),
		catalogDiscovery: {
			label: "Synthetic",
			envVars: ["SYNTHETIC_API_KEY"],
		},
	},
	{
		providerId: "venice",
		defaultModel: "llama-3.3-70b",
		createModelManagerOptions: config => veniceModelManagerOptions(config),
		catalogDiscovery: {
			label: "Venice",
			envVars: ["VENICE_API_KEY"],
			allowUnauthenticated: true,
		},
	},
	{
		providerId: "litellm",
		defaultModel: "claude-opus-4-6",
		createModelManagerOptions: config => litellmModelManagerOptions(config),
		catalogDiscovery: {
			label: "LiteLLM",
			envVars: ["LITELLM_API_KEY"],
			allowUnauthenticated: true,
		},
	},
	{
		providerId: "vllm",
		defaultModel: "gpt-oss-20b",
		createModelManagerOptions: config => vllmModelManagerOptions(config),
		catalogDiscovery: {
			label: "vLLM",
			envVars: ["VLLM_API_KEY"],
			allowUnauthenticated: true,
		},
	},
	{
		providerId: "moonshot",
		defaultModel: "kimi-k2.5",
		createModelManagerOptions: config => moonshotModelManagerOptions(config),
		catalogDiscovery: {
			label: "Moonshot",
			envVars: ["MOONSHOT_API_KEY"],
		},
	},
	{
		providerId: "qianfan",
		defaultModel: "deepseek-v3.2",
		createModelManagerOptions: config => qianfanModelManagerOptions(config),
		catalogDiscovery: {
			label: "Qianfan",
			envVars: ["QIANFAN_API_KEY"],
		},
	},
	{
		providerId: "together",
		defaultModel: "moonshotai/Kimi-K2.5",
		createModelManagerOptions: config => togetherModelManagerOptions(config),
		catalogDiscovery: {
			label: "Together",
			envVars: ["TOGETHER_API_KEY"],
		},
	},
	{
		providerId: "xiaomi",
		defaultModel: "mimo-v2-flash",
		createModelManagerOptions: config => xiaomiModelManagerOptions(config),
		catalogDiscovery: {
			label: "Xiaomi",
			envVars: ["XIAOMI_API_KEY"],
		},
	},
	{
		providerId: "github-copilot",
		defaultModel: "gpt-4o",
		createModelManagerOptions: config => githubCopilotModelManagerOptions(config),
	},
	{
		providerId: "google",
		defaultModel: "gemini-2.5-pro",
		createModelManagerOptions: config => googleModelManagerOptions(config),
	},
	{
		providerId: "cursor",
		defaultModel: "claude-sonnet-4-6",
		createModelManagerOptions: config => cursorModelManagerOptions(config),
		catalogDiscovery: {
			label: "Cursor",
			envVars: ["CURSOR_API_KEY"],
			oauthProvider: "cursor",
		},
	},
] as const;

/** Default model IDs for all known providers, built from descriptors + special providers. */
export const DEFAULT_MODEL_PER_PROVIDER: Record<KnownProvider, string> = {
	...Object.fromEntries(PROVIDER_DESCRIPTORS.map(d => [d.providerId, d.defaultModel])),
	// Providers not in PROVIDER_DESCRIPTORS (special auth or no standard discovery)
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	"google-antigravity": "gemini-3-pro-high",
	"google-gemini-cli": "gemini-2.5-pro",
	"google-vertex": "gemini-3-pro-preview",
	minimax: "MiniMax-M2.5",
	"minimax-code": "MiniMax-M2.5",
	"minimax-code-cn": "MiniMax-M2.5",
	"openai-codex": "gpt-5.3-codex",
	zai: "glm-4.6",
} as Record<KnownProvider, string>;
