import type { ModelManagerOptions } from "../model-manager";
import { getBundledModels } from "../models";
import type { Api, Model } from "../types";
import {
	fetchOpenAICompatibleModels,
	type OpenAICompatibleModelMapperContext,
	type OpenAICompatibleModelRecord,
} from "../utils/discovery/openai-compatible";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "string") return parseFloat(v) || 0;
	return 0;
}

const MODELS_DEV_URL = "https://models.dev/api.json";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_OAUTH_BETA = "claude-code-20250219,oauth-2025-04-20";

interface ModelsDevModel {
	id?: string;
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toPositiveNumber(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
}

function toModelName(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

function toInputCapabilities(value: unknown): ("text" | "image")[] {
	if (!Array.isArray(value)) {
		return ["text"];
	}
	const supportsImage = value.some(item => item === "image");
	return supportsImage ? ["text", "image"] : ["text"];
}

async function fetchModelsDevPayload(fetchImpl: typeof fetch = fetch): Promise<unknown> {
	const response = await fetchImpl(MODELS_DEV_URL, {
		method: "GET",
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`models.dev fetch failed: ${response.status}`);
	}
	return response.json();
}

function mapAnthropicModelsDev(payload: unknown, baseUrl: string): Model<"anthropic-messages">[] {
	if (!isRecord(payload)) {
		return [];
	}
	const anthropicPayload = payload.anthropic;
	if (!isRecord(anthropicPayload)) {
		return [];
	}
	const modelsValue = anthropicPayload.models;
	if (!isRecord(modelsValue)) {
		return [];
	}

	const models: Model<"anthropic-messages">[] = [];
	for (const [modelId, rawModel] of Object.entries(modelsValue)) {
		if (!isRecord(rawModel)) {
			continue;
		}
		const model = rawModel as ModelsDevModel;
		if (model.tool_call !== true) {
			continue;
		}
		models.push({
			id: modelId,
			name: toModelName(model.name, modelId),
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl,
			reasoning: model.reasoning === true,
			input: toInputCapabilities(model.modalities?.input),
			cost: {
				input: toNumber(model.cost?.input),
				output: toNumber(model.cost?.output),
				cacheRead: toNumber(model.cost?.cache_read),
				cacheWrite: toNumber(model.cost?.cache_write),
			},
			contextWindow: toPositiveNumber(model.limit?.context, 4096),
			maxTokens: toPositiveNumber(model.limit?.output, 4096),
		});
	}

	models.sort((left, right) => left.id.localeCompare(right.id));
	return models;
}

function isAnthropicOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function buildAnthropicDiscoveryHeaders(apiKey: string): Record<string, string> {
	const oauthToken = isAnthropicOAuthToken(apiKey);
	const headers: Record<string, string> = {
		"anthropic-version": "2023-06-01",
		"anthropic-dangerous-direct-browser-access": "true",
		"anthropic-beta": ANTHROPIC_OAUTH_BETA,
	};
	if (oauthToken) {
		headers.Authorization = `Bearer ${apiKey}`;
	} else {
		headers["x-api-key"] = apiKey;
	}
	return headers;
}

function buildAnthropicReferenceMap(
	modelsDevModels: readonly Model<"anthropic-messages">[],
): Map<string, Model<"anthropic-messages">> {
	const merged = new Map<string, Model<"anthropic-messages">>();
	for (const model of getBundledModels("anthropic") as Model<"anthropic-messages">[]) {
		merged.set(model.id, model);
	}
	for (const model of modelsDevModels) {
		merged.set(model.id, model);
	}
	return merged;
}

function mapWithBundledReference<TApi extends Api>(
	entry: OpenAICompatibleModelRecord,
	defaults: Model<TApi>,
	reference: Model<TApi> | undefined,
): Model<TApi> {
	const name = toModelName(entry.name, reference?.name ?? defaults.name);
	if (!reference) {
		return {
			...defaults,
			name,
		};
	}
	return {
		...reference,
		id: defaults.id,
		name,
		baseUrl: defaults.baseUrl,
		contextWindow: toPositiveNumber(entry.context_length, reference.contextWindow),
		maxTokens: toPositiveNumber(entry.max_completion_tokens, reference.maxTokens),
	};
}

function createBundledReferenceMap<TApi extends Api>(
	provider: Parameters<typeof getBundledModels>[0],
): Map<string, Model<TApi>> {
	const references = new Map<string, Model<TApi>>();
	for (const model of getBundledModels(provider)) {
		references.set(model.id, model as Model<TApi>);
	}
	return references;
}

// ---------------------------------------------------------------------------
// 1. OpenAI
// ---------------------------------------------------------------------------

export interface OpenAIModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function openaiModelManagerOptions(config?: OpenAIModelManagerConfig): ModelManagerOptions<"openai-responses"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.openai.com/v1";
	const references = createBundledReferenceMap<"openai-responses">("openai");
	return {
		providerId: "openai",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-responses",
					provider: "openai",
					baseUrl,
					apiKey,
					mapModel: (entry, defaults) => {
						const reference = references.get(defaults.id);
						return mapWithBundledReference(entry, defaults, reference);
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 2. Groq
// ---------------------------------------------------------------------------

export interface GroqModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function groqModelManagerOptions(config?: GroqModelManagerConfig): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.groq.com/openai/v1";
	const references = createBundledReferenceMap<"openai-completions">("groq");
	return {
		providerId: "groq",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "groq",
					baseUrl,
					apiKey,
					mapModel: (entry, defaults) => {
						const reference = references.get(defaults.id);
						return mapWithBundledReference(entry, defaults, reference);
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 3. Cerebras
// ---------------------------------------------------------------------------

export interface CerebrasModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function cerebrasModelManagerOptions(
	config?: CerebrasModelManagerConfig,
): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.cerebras.ai/v1";
	const references = createBundledReferenceMap<"openai-completions">("cerebras");
	return {
		providerId: "cerebras",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "cerebras",
					baseUrl,
					apiKey,
					mapModel: (entry, defaults) => {
						const reference = references.get(defaults.id);
						return mapWithBundledReference(entry, defaults, reference);
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 4. xAI
// ---------------------------------------------------------------------------

export interface XaiModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function xaiModelManagerOptions(config?: XaiModelManagerConfig): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.x.ai/v1";
	const references = createBundledReferenceMap<"openai-completions">("xai");
	return {
		providerId: "xai",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "xai",
					baseUrl,
					apiKey,
					mapModel: (entry, defaults) => {
						const reference = references.get(defaults.id);
						return mapWithBundledReference(entry, defaults, reference);
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 5. Mistral
// ---------------------------------------------------------------------------

export interface MistralModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function mistralModelManagerOptions(
	config?: MistralModelManagerConfig,
): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.mistral.ai/v1";
	const references = createBundledReferenceMap<"openai-completions">("mistral");
	return {
		providerId: "mistral",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "mistral",
					baseUrl,
					apiKey,
					mapModel: (entry, defaults) => {
						const reference = references.get(defaults.id);
						return mapWithBundledReference(entry, defaults, reference);
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 6. OpenCode
// ---------------------------------------------------------------------------

export interface OpenCodeModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function opencodeModelManagerOptions(
	config?: OpenCodeModelManagerConfig,
): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://opencode.ai/zen/v1";
	return {
		providerId: "opencode",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "opencode",
					baseUrl,
					apiKey,
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 7. OpenRouter
// ---------------------------------------------------------------------------

export interface OpenRouterModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function openrouterModelManagerOptions(
	config?: OpenRouterModelManagerConfig,
): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://openrouter.ai/api/v1";
	return {
		providerId: "openrouter",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "openrouter",
					baseUrl,
					apiKey,
					filterModel: (entry: OpenAICompatibleModelRecord) => {
						const params = entry.supported_parameters;
						return Array.isArray(params) && params.includes("tools");
					},
					mapModel: (
						entry: OpenAICompatibleModelRecord,
						defaults: Model<"openai-completions">,
						_context: OpenAICompatibleModelMapperContext<"openai-completions">,
					): Model<"openai-completions"> => {
						const pricing = entry.pricing as Record<string, unknown> | undefined;
						const params = Array.isArray(entry.supported_parameters)
							? (entry.supported_parameters as string[])
							: [];
						const modality = String((entry.architecture as Record<string, unknown> | undefined)?.modality ?? "");
						const topProvider = entry.top_provider as Record<string, unknown> | undefined;

						const supportsToolChoice = params.includes("tool_choice");

						return {
							...defaults,
							reasoning: params.includes("reasoning"),
							input: modality.includes("image") ? ["text", "image"] : ["text"],
							cost: {
								input: parseFloat(String(pricing?.prompt ?? "0")) * 1_000_000,
								output: parseFloat(String(pricing?.completion ?? "0")) * 1_000_000,
								cacheRead: parseFloat(String(pricing?.input_cache_read ?? "0")) * 1_000_000,
								cacheWrite: parseFloat(String(pricing?.input_cache_write ?? "0")) * 1_000_000,
							},
							contextWindow:
								typeof entry.context_length === "number" ? entry.context_length : defaults.contextWindow,
							maxTokens:
								typeof topProvider?.max_completion_tokens === "number"
									? topProvider.max_completion_tokens
									: defaults.maxTokens,
							...(!supportsToolChoice && {
								compat: { supportsToolChoice: false },
							}),
						};
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 8. Vercel AI Gateway
// ---------------------------------------------------------------------------

export interface VercelAiGatewayModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function vercelAiGatewayModelManagerOptions(
	config?: VercelAiGatewayModelManagerConfig,
): ModelManagerOptions<"anthropic-messages"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://ai-gateway.vercel.sh";
	return {
		providerId: "vercel-ai-gateway",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "anthropic-messages",
					provider: "vercel-ai-gateway",
					baseUrl,
					apiKey,
					filterModel: (entry: OpenAICompatibleModelRecord) => {
						const tags = entry.tags;
						return Array.isArray(tags) && tags.includes("tool-use");
					},
					mapModel: (
						entry: OpenAICompatibleModelRecord,
						defaults: Model<"anthropic-messages">,
						_context: OpenAICompatibleModelMapperContext<"anthropic-messages">,
					): Model<"anthropic-messages"> => {
						const pricing = entry.pricing as Record<string, unknown> | undefined;
						const tags = Array.isArray(entry.tags) ? (entry.tags as string[]) : [];

						return {
							...defaults,
							reasoning: tags.includes("reasoning"),
							input: tags.includes("vision") ? ["text", "image"] : ["text"],
							cost: {
								input: toNumber(pricing?.input) * 1_000_000,
								output: toNumber(pricing?.output) * 1_000_000,
								cacheRead: toNumber(pricing?.input_cache_read) * 1_000_000,
								cacheWrite: toNumber(pricing?.input_cache_write) * 1_000_000,
							},
							contextWindow:
								typeof entry.context_window === "number" ? entry.context_window : defaults.contextWindow,
							maxTokens: typeof entry.max_tokens === "number" ? entry.max_tokens : defaults.maxTokens,
						};
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 9. Kimi Code
// ---------------------------------------------------------------------------

export interface KimiCodeModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function kimiCodeModelManagerOptions(
	config?: KimiCodeModelManagerConfig,
): ModelManagerOptions<"openai-completions"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.kimi.com/coding/v1";
	return {
		providerId: "kimi-code",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels({
					api: "openai-completions",
					provider: "kimi-code",
					baseUrl,
					apiKey,
					headers: {
						"User-Agent": "KimiCLI/1.0",
						"X-Msh-Platform": "kimi_cli",
					},
					mapModel: (
						entry: OpenAICompatibleModelRecord,
						defaults: Model<"openai-completions">,
						_context: OpenAICompatibleModelMapperContext<"openai-completions">,
					): Model<"openai-completions"> => {
						const id = defaults.id;
						return {
							...defaults,
							name: typeof entry.display_name === "string" ? entry.display_name : defaults.name,
							reasoning: entry.supports_reasoning === true || id.includes("thinking"),
							input: entry.supports_image_in === true || id.includes("k2.5") ? ["text", "image"] : ["text"],
							contextWindow: typeof entry.context_length === "number" ? entry.context_length : 262144,
							maxTokens: 32000,
							compat: {
								thinkingFormat: "zai",
								reasoningContentField: "reasoning_content",
								supportsDeveloperRole: false,
							},
						};
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 10. GitHub Copilot
// ---------------------------------------------------------------------------

export interface GithubCopilotModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}
const GITHUB_COPILOT_HEADERS: Record<string, string> = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
};

function inferCopilotApi(modelId: string): Api {
	if (/^claude-(haiku|sonnet|opus)-4([.-]|$)/.test(modelId)) {
		return "anthropic-messages";
	}
	if (modelId.startsWith("gpt-5") || modelId.startsWith("oswe")) {
		return "openai-responses";
	}
	return "openai-completions";
}

export function githubCopilotModelManagerOptions(config?: GithubCopilotModelManagerConfig): ModelManagerOptions<Api> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? "https://api.individual.githubcopilot.com";
	const references = new Map((getBundledModels("github-copilot") as Model<Api>[]).map(model => [model.id, model]));
	return {
		providerId: "github-copilot",
		...(apiKey && {
			fetchDynamicModels: () =>
				fetchOpenAICompatibleModels<Api>({
					api: "openai-completions",
					provider: "github-copilot",
					baseUrl,
					apiKey,
					headers: GITHUB_COPILOT_HEADERS,
					mapModel: (
						entry: OpenAICompatibleModelRecord,
						defaults: Model<Api>,
						_context: OpenAICompatibleModelMapperContext<Api>,
					): Model<Api> => {
						const reference = references.get(defaults.id);
						const contextWindow =
							typeof entry.context_length === "number"
								? entry.context_length
								: (reference?.contextWindow ?? defaults.contextWindow);
						const maxTokens =
							typeof entry.max_completion_tokens === "number"
								? entry.max_completion_tokens
								: (reference?.maxTokens ?? defaults.maxTokens);
						const name =
							typeof entry.name === "string" && entry.name.trim().length > 0
								? entry.name
								: (reference?.name ?? defaults.name);
						if (reference) {
							return {
								...reference,
								baseUrl,
								name,
								contextWindow,
								maxTokens,
								headers: { ...GITHUB_COPILOT_HEADERS, ...reference.headers },
							};
						}
						const api = inferCopilotApi(defaults.id);
						return {
							...defaults,
							api,
							baseUrl,
							name,
							contextWindow,
							maxTokens,
							headers: { ...GITHUB_COPILOT_HEADERS },
							...(api === "openai-completions"
								? {
										compat: {
											supportsStore: false,
											supportsDeveloperRole: false,
											supportsReasoningEffort: false,
										},
									}
								: {}),
						};
					},
				}),
		}),
	};
}

// ---------------------------------------------------------------------------
// 11. Anthropic
// ---------------------------------------------------------------------------

export interface AnthropicModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function anthropicModelManagerOptions(
	config?: AnthropicModelManagerConfig,
): ModelManagerOptions<"anthropic-messages"> {
	const apiKey = config?.apiKey;
	const baseUrl = config?.baseUrl ?? ANTHROPIC_BASE_URL;
	return {
		providerId: "anthropic",
		modelsDev: {
			fetch: fetchModelsDevPayload,
			map: payload => mapAnthropicModelsDev(payload, baseUrl),
		},
		...(apiKey && {
			fetchDynamicModels: async () => {
				const modelsDevModels = await fetchModelsDevPayload()
					.then(payload => mapAnthropicModelsDev(payload, baseUrl))
					.catch(() => []);
				const references = buildAnthropicReferenceMap(modelsDevModels);
				return (
					fetchOpenAICompatibleModels({
						api: "anthropic-messages",
						provider: "anthropic",
						baseUrl,
						headers: buildAnthropicDiscoveryHeaders(apiKey),
						mapModel: (
							entry: OpenAICompatibleModelRecord,
							defaults: Model<"anthropic-messages">,
							_context: OpenAICompatibleModelMapperContext<"anthropic-messages">,
						): Model<"anthropic-messages"> => {
							const discoveredName = typeof entry.display_name === "string" ? entry.display_name : defaults.name;
							const reference = references.get(defaults.id);
							if (!reference) {
								return {
									...defaults,
									name: discoveredName,
								};
							}
							return {
								...reference,
								id: defaults.id,
								name: discoveredName,
								api: "anthropic-messages",
								provider: "anthropic",
								baseUrl,
							};
						},
					}) ?? null
				);
			},
		}),
	};
}
