import {
	type Api,
	getGitHubCopilotBaseUrl,
	getModels,
	getProviders,
	type Model,
	normalizeDomain,
} from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import AjvModule from "ajv";
import { type ConfigError, ConfigFile } from "../config";
import type { ThemeColor } from "../modes/theme/theme";
import type { AuthStorage } from "../session/auth-storage";

export type ModelRole = "default" | "smol" | "slow" | "plan" | "commit";

export interface ModelRoleInfo {
	tag?: string;
	name: string;
	color?: ThemeColor;
}

export const MODEL_ROLES: Record<ModelRole, ModelRoleInfo> = {
	default: { tag: "DEFAULT", name: "Default", color: "success" },
	smol: { tag: "SMOL", name: "Fast", color: "warning" },
	slow: { tag: "SLOW", name: "Thinking", color: "accent" },
	plan: { tag: "PLAN", name: "Architect", color: "muted" },
	commit: { name: "Commit" },
};

export const MODEL_ROLE_IDS: ModelRole[] = ["default", "smol", "slow", "plan", "commit"];

const _Ajv = (AjvModule as any).default || AjvModule;

const OpenRouterRoutingSchema = Type.Object({
	only: Type.Optional(Type.Array(Type.String())),
	order: Type.Optional(Type.Array(Type.String())),
});

// Schema for Vercel AI Gateway routing preferences
const VercelGatewayRoutingSchema = Type.Object({
	only: Type.Optional(Type.Array(Type.String())),
	order: Type.Optional(Type.Array(Type.String())),
});

// Schema for OpenAI compatibility settings
const OpenAICompatSchema = Type.Object({
	supportsStore: Type.Optional(Type.Boolean()),
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	supportsReasoningEffort: Type.Optional(Type.Boolean()),
	maxTokensField: Type.Optional(Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")])),
	openRouterRouting: Type.Optional(OpenRouterRoutingSchema),
	vercelGatewayRouting: Type.Optional(VercelGatewayRoutingSchema),
});

// Schema for custom model definition
// Most fields are optional with sensible defaults for local models (Ollama, LM Studio, etc.)
const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(
		Type.Union([
			Type.Literal("openai-completions"),
			Type.Literal("openai-responses"),
			Type.Literal("openai-codex-responses"),
			Type.Literal("azure-openai-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
			Type.Literal("google-vertex"),
		]),
	),
	reasoning: Type.Optional(Type.Boolean()),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Number(),
			output: Type.Number(),
			cacheRead: Type.Number(),
			cacheWrite: Type.Number(),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

// Schema for per-model overrides (all fields optional, merged with built-in model)
const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Optional(Type.Number()),
			output: Type.Optional(Type.Number()),
			cacheRead: Type.Optional(Type.Number()),
			cacheWrite: Type.Optional(Type.Number()),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

type ModelOverride = Static<typeof ModelOverrideSchema>;

const ProviderDiscoverySchema = Type.Object({
	type: Type.Union([Type.Literal("ollama")]),
});

const ProviderAuthSchema = Type.Union([Type.Literal("apiKey"), Type.Literal("none")]);

const ProviderConfigSchema = Type.Object({
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(
		Type.Union([
			Type.Literal("openai-completions"),
			Type.Literal("openai-responses"),
			Type.Literal("openai-codex-responses"),
			Type.Literal("azure-openai-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
			Type.Literal("google-vertex"),
		]),
	),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	authHeader: Type.Optional(Type.Boolean()),
	auth: Type.Optional(ProviderAuthSchema),
	discovery: Type.Optional(ProviderDiscoverySchema),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

type ModelsConfig = Static<typeof ModelsConfigSchema>;

type ProviderAuthMode = Static<typeof ProviderAuthSchema>;
type ProviderDiscovery = Static<typeof ProviderDiscoverySchema>;

export const ModelsConfigFile = new ConfigFile<ModelsConfig>("models", ModelsConfigSchema).withValidation(
	"models",
	config => {
		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];

			if (models.length === 0) {
				// Override-only config: needs baseUrl, modelOverrides, or discovery
				const hasModelOverrides =
					providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;
				if (!providerConfig.baseUrl && !hasModelOverrides && !providerConfig.discovery) {
					throw new Error(
						`Provider ${providerName}: must specify "baseUrl", "modelOverrides", "discovery", or "models".`,
					);
				}
			} else {
				// Full replacement: needs baseUrl and apiKey unless auth is disabled
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
				if (!providerConfig.apiKey && providerConfig.auth !== "none") {
					throw new Error(
						`Provider ${providerName}: "apiKey" is required when defining custom models unless auth is "none".`,
					);
				}
			}

			if (providerConfig.discovery && !providerConfig.api) {
				throw new Error(`Provider ${providerName}: "api" is required when discovery is enabled at provider level.`);
			}

			for (const modelDef of models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				// Validate contextWindow/maxTokens only if provided (they have defaults)
				if (modelDef.contextWindow !== undefined && modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens !== undefined && modelDef.maxTokens <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
			}
		}
	},
);

/** Provider override config (baseUrl, headers, apiKey) without custom models */
interface ProviderOverride {
	baseUrl?: string;
	headers?: Record<string, string>;
	apiKey?: string;
}

interface DiscoveryProviderConfig {
	provider: string;
	api: Api;
	baseUrl?: string;
	headers?: Record<string, string>;
	discovery: ProviderDiscovery;
}

/**
 * Serialized representation of ModelRegistry for passing to subagent workers.
 */
export interface SerializedModelRegistry {
	models: Model<Api>[];
	customProviderApiKeys?: Record<string, string>;
}

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models?: Model<Api>[];
	overrides?: Map<string, ProviderOverride>;
	modelOverrides?: Map<string, Map<string, ModelOverride>>;
	keylessProviders?: Set<string>;
	discoverableProviders?: DiscoveryProviderConfig[];
	error?: ConfigError;
	found: boolean;
}

/**
 * Resolve an API key config value to an actual key.
 * Checks environment variable first, then treats as literal.
 */
function resolveApiKeyConfig(keyConfig: string): string | undefined {
	const envValue = Bun.env[keyConfig];
	if (envValue) return envValue;
	return keyConfig;
}

function mergeCompat(
	baseCompat: Model<Api>["compat"],
	overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
	if (!overrideCompat) return baseCompat;
	const base = baseCompat as any;
	const override = overrideCompat as any;
	const merged = { ...base, ...override };
	if (base?.openRouterRouting || override.openRouterRouting) {
		merged.openRouterRouting = { ...base?.openRouterRouting, ...override.openRouterRouting };
	}
	if (base?.vercelGatewayRouting || override.vercelGatewayRouting) {
		merged.vercelGatewayRouting = { ...base?.vercelGatewayRouting, ...override.vercelGatewayRouting };
	}
	return merged;
}

function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };
	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.input !== undefined) result.input = override.input as ("text" | "image")[];
	if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
	if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;
	if (override.cost) {
		result.cost = {
			input: override.cost.input ?? model.cost.input,
			output: override.cost.output ?? model.cost.output,
			cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
			cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
		};
	}
	if (override.headers) {
		result.headers = { ...model.headers, ...override.headers };
	}
	result.compat = mergeCompat(model.compat, override.compat);
	return result;
}

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export class ModelRegistry {
	#models: Model<Api>[] = [];
	#customProviderApiKeys: Map<string, string> = new Map();
	#keylessProviders: Set<string> = new Set();
	#discoverableProviders: DiscoveryProviderConfig[] = [];
	#modelOverrides: Map<string, Map<string, ModelOverride>> = new Map();
	#configError: ConfigError | undefined = undefined;
	#modelsConfigFile: ConfigFile<ModelsConfig>;

	/**
	 * @param authStorage - Auth storage for API key resolution
	 */
	constructor(
		readonly authStorage: AuthStorage,
		modelsPath?: string,
	) {
		this.#modelsConfigFile = ModelsConfigFile.relocate(modelsPath);
		// Set up fallback resolver for custom provider API keys
		this.authStorage.setFallbackResolver(provider => {
			const keyConfig = this.#customProviderApiKeys.get(provider);
			if (keyConfig) {
				return resolveApiKeyConfig(keyConfig);
			}
			return undefined;
		});
		// Load models synchronously in constructor
		this.#loadModels();
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	async refresh(): Promise<void> {
		this.#modelsConfigFile.invalidate();
		this.#customProviderApiKeys.clear();
		this.#keylessProviders.clear();
		this.#discoverableProviders = [];
		this.#modelOverrides.clear();
		this.#configError = undefined;
		this.#loadModels();
		await this.#refreshRuntimeDiscoveries();
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): ConfigError | undefined {
		return this.#configError;
	}

	#loadModels() {
		// Load custom models from models.json first (to know which providers to override)
		const {
			models: customModels = [],
			overrides = new Map(),
			modelOverrides = new Map(),
			keylessProviders = new Set(),
			discoverableProviders = [],
			error: configError,
		} = this.#loadCustomModels();
		this.#configError = configError;
		this.#keylessProviders = keylessProviders;
		this.#discoverableProviders = discoverableProviders;
		this.#modelOverrides = modelOverrides;

		const builtInModels = this.#loadBuiltInModels(overrides, modelOverrides);
		const combined = this.#mergeCustomModels(builtInModels, customModels);

		// Update github-copilot base URL based on OAuth credentials
		const copilotCred = this.authStorage.getOAuthCredential("github-copilot");
		if (copilotCred) {
			const domain = copilotCred.enterpriseUrl
				? (normalizeDomain(copilotCred.enterpriseUrl) ?? undefined)
				: undefined;
			const baseUrl = getGitHubCopilotBaseUrl(copilotCred.access, domain);
			this.#models = combined.map(m => (m.provider === "github-copilot" ? { ...m, baseUrl } : m));
		} else {
			this.#models = combined;
		}
	}

	/** Load built-in models, applying provider and per-model overrides */
	#loadBuiltInModels(
		overrides: Map<string, ProviderOverride>,
		modelOverrides: Map<string, Map<string, ModelOverride>>,
	): Model<Api>[] {
		return getProviders().flatMap(provider => {
			const models = getModels(provider as any) as Model<Api>[];
			const providerOverride = overrides.get(provider);
			const perModelOverrides = modelOverrides.get(provider);

			return models.map(m => {
				let model = m;
				if (providerOverride) {
					model = {
						...model,
						baseUrl: providerOverride.baseUrl ?? model.baseUrl,
						headers: providerOverride.headers ? { ...model.headers, ...providerOverride.headers } : model.headers,
					};
				}
				const modelOverride = perModelOverrides?.get(m.id);
				if (modelOverride) {
					model = applyModelOverride(model, modelOverride);
				}
				return model;
			});
		});
	}

	/** Merge custom models with built-in, replacing by provider+id match */
	#mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
		const merged = [...builtInModels];
		for (const customModel of customModels) {
			const existingIndex = merged.findIndex(m => m.provider === customModel.provider && m.id === customModel.id);
			if (existingIndex >= 0) {
				merged[existingIndex] = customModel;
			} else {
				merged.push(customModel);
			}
		}
		return merged;
	}

	#loadCustomModels(): CustomModelsResult {
		const { value, error, status } = this.#modelsConfigFile.tryLoad();

		if (status === "error") {
			return {
				models: [],
				overrides: new Map(),
				modelOverrides: new Map(),
				keylessProviders: new Set(),
				discoverableProviders: [],
				error,
				found: true,
			};
		} else if (status === "not-found") {
			return {
				models: [],
				overrides: new Map(),
				modelOverrides: new Map(),
				keylessProviders: new Set(),
				discoverableProviders: [],
				found: false,
			};
		}

		const overrides = new Map<string, ProviderOverride>();
		const allModelOverrides = new Map<string, Map<string, ModelOverride>>();
		const keylessProviders = new Set<string>();
		const discoverableProviders: DiscoveryProviderConfig[] = [];

		for (const [providerName, providerConfig] of Object.entries(value.providers)) {
			// Always set overrides when baseUrl/headers present
			if (providerConfig.baseUrl || providerConfig.headers || providerConfig.apiKey) {
				overrides.set(providerName, {
					baseUrl: providerConfig.baseUrl,
					headers: providerConfig.headers,
					apiKey: providerConfig.apiKey,
				});
			}

			const authMode = (providerConfig.auth ?? "apiKey") as ProviderAuthMode;
			if (authMode === "none") {
				keylessProviders.add(providerName);
			}

			if (providerConfig.discovery && providerConfig.api) {
				discoverableProviders.push({
					provider: providerName,
					api: providerConfig.api as Api,
					baseUrl: providerConfig.baseUrl,
					headers: providerConfig.headers,
					discovery: providerConfig.discovery,
				});
			}

			// Always store API key for fallback resolver
			if (providerConfig.apiKey) {
				this.#customProviderApiKeys.set(providerName, providerConfig.apiKey);
			}

			// Parse per-model overrides
			if (providerConfig.modelOverrides) {
				const perModel = new Map<string, ModelOverride>();
				for (const [modelId, override] of Object.entries(providerConfig.modelOverrides)) {
					perModel.set(modelId, override);
				}
				allModelOverrides.set(providerName, perModel);
			}
		}

		return {
			models: this.#parseModels(value),
			overrides,
			modelOverrides: allModelOverrides,
			keylessProviders,
			discoverableProviders,
			found: true,
		};
	}

	async #refreshRuntimeDiscoveries(): Promise<void> {
		if (this.#discoverableProviders.length === 0) return;
		const discovered = await Promise.all(
			this.#discoverableProviders.map(provider => this.#discoverProviderModels(provider)),
		);
		const merged = this.#mergeCustomModels(this.#models, discovered.flat());
		this.#models = this.#applyModelOverrides(merged, this.#modelOverrides);
	}

	async #discoverProviderModels(providerConfig: DiscoveryProviderConfig): Promise<Model<Api>[]> {
		switch (providerConfig.discovery.type) {
			case "ollama":
				return this.#discoverOllamaModels(providerConfig);
		}
	}

	async #discoverOllamaModels(providerConfig: DiscoveryProviderConfig): Promise<Model<Api>[]> {
		const endpoint = this.#normalizeOllamaBaseUrl(providerConfig.baseUrl);
		const tagsUrl = `${endpoint}/api/tags`;
		try {
			const response = await fetch(tagsUrl, {
				headers: { ...(providerConfig.headers ?? {}) },
				signal: AbortSignal.timeout(3000),
			});
			if (!response.ok) {
				logger.warn("model discovery failed for provider", {
					provider: providerConfig.provider,
					status: response.status,
					url: tagsUrl,
				});
				return [];
			}
			const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
			const models = payload.models ?? [];
			const discovered: Model<Api>[] = [];
			for (const item of models) {
				const id = item.model || item.name;
				if (!id) continue;
				discovered.push({
					id,
					name: item.name || id,
					api: providerConfig.api,
					provider: providerConfig.provider,
					baseUrl: `${endpoint}/v1`,
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 8192,
					headers: providerConfig.headers,
				});
			}
			return this.#applyProviderModelOverrides(providerConfig.provider, discovered);
		} catch (error) {
			logger.warn("model discovery failed for provider", {
				provider: providerConfig.provider,
				url: tagsUrl,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	#normalizeOllamaBaseUrl(baseUrl?: string): string {
		const raw = baseUrl || "http://127.0.0.1:11434";
		try {
			const parsed = new URL(raw);
			return `${parsed.protocol}//${parsed.host}`;
		} catch {
			return "http://127.0.0.1:11434";
		}
	}

	#applyProviderModelOverrides(provider: string, models: Model<Api>[]): Model<Api>[] {
		const overrides = this.#modelOverrides.get(provider);
		if (!overrides || overrides.size === 0) return models;
		return models.map(model => {
			const override = overrides.get(model.id);
			if (!override) return model;
			return applyModelOverride(model, override);
		});
	}

	#applyModelOverrides(models: Model<Api>[], overrides: Map<string, Map<string, ModelOverride>>): Model<Api>[] {
		if (overrides.size === 0) return models;
		return models.map(model => {
			const providerOverrides = overrides.get(model.provider);
			if (!providerOverrides) return model;
			const override = providerOverrides.get(model.id);
			if (!override) return model;
			return applyModelOverride(model, override);
		});
	}

	#parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			// Store API key config for fallback resolver
			if (providerConfig.apiKey) {
				this.#customProviderApiKeys.set(providerName, providerConfig.apiKey);
			}

			for (const modelDef of modelDefs) {
				const api = modelDef.api || providerConfig.api;
				if (!api) continue;

				// Merge headers: provider headers are base, model headers override
				let headers =
					providerConfig.headers || modelDef.headers
						? { ...providerConfig.headers, ...modelDef.headers }
						: undefined;

				// If authHeader is true, add Authorization header with resolved API key
				if (providerConfig.authHeader && providerConfig.apiKey) {
					const resolvedKey = resolveApiKeyConfig(providerConfig.apiKey);
					if (resolvedKey) {
						headers = { ...headers, Authorization: `Bearer ${resolvedKey}` };
					}
				}

				// baseUrl is validated to exist for providers with models
				// Apply defaults for optional fields
				const defaultCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
				models.push({
					id: modelDef.id,
					name: modelDef.name ?? modelDef.id,
					api: api as Api,
					provider: providerName,
					baseUrl: providerConfig.baseUrl!,
					reasoning: modelDef.reasoning ?? false,
					input: (modelDef.input ?? ["text"]) as ("text" | "image")[],
					cost: modelDef.cost ?? defaultCost,
					contextWindow: modelDef.contextWindow ?? 128000,
					maxTokens: modelDef.maxTokens ?? 16384,
					headers,
					compat: modelDef.compat,
				} as Model<Api>);
			}
		}

		return models;
	}

	/**
	 * Get all models (built-in + custom).
	 * If models.json had errors, returns only built-in models.
	 */
	getAll(): Model<Api>[] {
		return this.#models;
	}

	/**
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		return this.#models.filter(m => this.#keylessProviders.has(m.provider) || this.authStorage.hasAuth(m.provider));
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.#models.find(m => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get the base URL associated with a provider, if any model defines one.
	 */
	getProviderBaseUrl(provider: string): string | undefined {
		return this.#models.find(m => m.provider === provider && m.baseUrl)?.baseUrl;
	}

	/**
	 * Get API key for a model.
	 */
	async getApiKey(model: Model<Api>, sessionId?: string): Promise<string | undefined> {
		if (this.#keylessProviders.has(model.provider)) {
			return "<no-auth>";
		}
		return this.authStorage.getApiKey(model.provider, sessionId, { baseUrl: model.baseUrl });
	}

	/**
	 * Get API key for a provider (e.g., "openai").
	 */
	async getApiKeyForProvider(provider: string, sessionId?: string, baseUrl?: string): Promise<string | undefined> {
		if (this.#keylessProviders.has(provider)) {
			return "<no-auth>";
		}
		return this.authStorage.getApiKey(provider, sessionId, { baseUrl });
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		return this.authStorage.hasOAuth(model.provider);
	}
}
