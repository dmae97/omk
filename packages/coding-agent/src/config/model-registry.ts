import {
	type Api,
	getGitHubCopilotBaseUrl,
	getModels,
	getProviders,
	type Model,
	normalizeDomain,
} from "@oh-my-pi/pi-ai";
import { type ConfigError, ConfigFile } from "@oh-my-pi/pi-coding-agent/config";
import { type Static, Type } from "@sinclair/typebox";
import AjvModule from "ajv";
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
const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
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
	reasoning: Type.Boolean(),
	input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
	cost: Type.Object({
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
	}),
	contextWindow: Type.Number(),
	maxTokens: Type.Number(),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

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
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

type ModelsConfig = Static<typeof ModelsConfigSchema>;

export const ModelsConfigFile = new ConfigFile<ModelsConfig>("models", ModelsConfigSchema).withValidation(
	"models",
	config => {
		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];

			if (models.length === 0) {
				// Override-only config: just needs baseUrl (to override built-in)
				if (!providerConfig.baseUrl) {
					throw new Error(
						`Provider ${providerName}: must specify either "baseUrl" (for override) or "models" (for replacement).`,
					);
				}
			} else {
				// Full replacement: needs baseUrl and apiKey
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
				if (!providerConfig.apiKey) {
					throw new Error(`Provider ${providerName}: "apiKey" is required when defining custom models.`);
				}
			}

			for (const modelDef of models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				if (!modelDef.name) throw new Error(`Provider ${providerName}: model missing "name"`);
				if (modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens <= 0)
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
	/** Providers with custom models (full replacement) */
	replacedProviders?: Set<string>;
	/** Providers with only baseUrl/headers override (no custom models) */
	overrides?: Map<string, ProviderOverride>;
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

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export class ModelRegistry {
	private models: Model<Api>[] = [];
	private customProviderApiKeys: Map<string, string> = new Map();
	private configError: ConfigError | undefined = undefined;
	private modelsConfigFile: ConfigFile<ModelsConfig>;

	/**
	 * @param authStorage - Auth storage for API key resolution
	 */
	constructor(
		readonly authStorage: AuthStorage,
		modelsPath?: string,
	) {
		this.modelsConfigFile = ModelsConfigFile.relocate(modelsPath);
		// Set up fallback resolver for custom provider API keys
		this.authStorage.setFallbackResolver(provider => {
			const keyConfig = this.customProviderApiKeys.get(provider);
			if (keyConfig) {
				return resolveApiKeyConfig(keyConfig);
			}
			return undefined;
		});
		// Load models synchronously in constructor
		this.loadModels();
	}

	/**
	 * Create an in-memory ModelRegistry instance from serialized data.
	 * Used by subagent workers to bypass discovery and use parent's models.
	 */
	static fromSerialized(data: SerializedModelRegistry, authStorage: AuthStorage): ModelRegistry {
		const instance = Object.create(ModelRegistry.prototype) as ModelRegistry;
		(instance as any).authStorage = authStorage;
		instance.models = data.models;
		instance.customProviderApiKeys = new Map(Object.entries(data.customProviderApiKeys ?? {}));

		authStorage.setFallbackResolver(provider => {
			const keyConfig = instance.customProviderApiKeys.get(provider);
			if (keyConfig) {
				return resolveApiKeyConfig(keyConfig);
			}
			return undefined;
		});

		return instance;
	}

	/**
	 * Serialize ModelRegistry for passing to subagent workers.
	 */
	serialize(): SerializedModelRegistry {
		const customProviderApiKeys: Record<string, string> = {};
		for (const [k, v] of this.customProviderApiKeys.entries()) {
			customProviderApiKeys[k] = v;
		}
		return {
			models: this.models,
			customProviderApiKeys: Object.keys(customProviderApiKeys).length > 0 ? customProviderApiKeys : undefined,
		};
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	refresh(): void {
		this.modelsConfigFile.invalidate();
		this.customProviderApiKeys.clear();
		this.configError = undefined;
		this.loadModels();
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): ConfigError | undefined {
		return this.configError;
	}

	private loadModels() {
		// Load custom models from models.json first (to know which providers to skip/override)
		const {
			models: customModels = [],
			replacedProviders = new Set(),
			overrides = new Map(),
			error: configError,
		} = this.loadCustomModels();
		this.configError = configError;

		const builtInModels = this.loadBuiltInModels(replacedProviders, overrides);
		const combined = [...builtInModels, ...customModels];

		// Update github-copilot base URL based on OAuth credentials
		const copilotCred = this.authStorage.getOAuthCredential("github-copilot");
		if (copilotCred) {
			const domain = copilotCred.enterpriseUrl
				? (normalizeDomain(copilotCred.enterpriseUrl) ?? undefined)
				: undefined;
			const baseUrl = getGitHubCopilotBaseUrl(copilotCred.access, domain);
			this.models = combined.map(m => (m.provider === "github-copilot" ? { ...m, baseUrl } : m));
		} else {
			this.models = combined;
		}
	}

	/** Load built-in models, skipping replaced providers and applying overrides */
	private loadBuiltInModels(replacedProviders: Set<string>, overrides: Map<string, ProviderOverride>): Model<Api>[] {
		return getProviders()
			.filter(provider => !replacedProviders.has(provider))
			.flatMap(provider => {
				const models = getModels(provider as any) as Model<Api>[];
				const override = overrides.get(provider);
				if (!override) return models;

				// Apply baseUrl/headers override to all models of this provider
				return models.map(m => ({
					...m,
					baseUrl: override.baseUrl ?? m.baseUrl,
					headers: override.headers ? { ...m.headers, ...override.headers } : m.headers,
				}));
			});
	}

	private loadCustomModels(): CustomModelsResult {
		const { value, error, status } = this.modelsConfigFile.tryLoad();

		if (status === "error") {
			return { models: [], replacedProviders: new Set(), overrides: new Map(), error, found: true };
		} else if (status === "not-found") {
			return { models: [], replacedProviders: new Set(), overrides: new Map(), found: false };
		}

		// Separate providers into "full replacement" (has models) vs "override-only" (no models)
		const replacedProviders = new Set<string>();
		const overrides = new Map<string, ProviderOverride>();

		for (const [providerName, providerConfig] of Object.entries(value.providers)) {
			if (providerConfig.models && providerConfig.models.length > 0) {
				// Has custom models -> full replacement
				replacedProviders.add(providerName);
			} else {
				// No models -> just override baseUrl/headers on built-in
				overrides.set(providerName, {
					baseUrl: providerConfig.baseUrl,
					headers: providerConfig.headers,
					apiKey: providerConfig.apiKey,
				});
				// Store API key for fallback resolver
				if (providerConfig.apiKey) {
					this.customProviderApiKeys.set(providerName, providerConfig.apiKey);
				}
			}
		}

		return { models: this.parseModels(value), replacedProviders, overrides, found: true };
	}

	private parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			// Store API key config for fallback resolver
			if (providerConfig.apiKey) {
				this.customProviderApiKeys.set(providerName, providerConfig.apiKey);
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
				models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl: providerConfig.baseUrl!,
					reasoning: modelDef.reasoning,
					input: modelDef.input as ("text" | "image")[],
					cost: modelDef.cost,
					contextWindow: modelDef.contextWindow,
					maxTokens: modelDef.maxTokens,
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
		return this.models;
	}

	/**
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		return this.models.filter(m => this.authStorage.hasAuth(m.provider));
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find(m => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get the base URL associated with a provider, if any model defines one.
	 */
	getProviderBaseUrl(provider: string): string | undefined {
		return this.models.find(m => m.provider === provider && m.baseUrl)?.baseUrl;
	}

	/**
	 * Get API key for a model.
	 */
	async getApiKey(model: Model<Api>, sessionId?: string): Promise<string | undefined> {
		return this.authStorage.getApiKey(model.provider, sessionId, { baseUrl: model.baseUrl });
	}

	/**
	 * Get API key for a provider (e.g., "openai").
	 */
	async getApiKeyForProvider(provider: string, sessionId?: string, baseUrl?: string): Promise<string | undefined> {
		return this.authStorage.getApiKey(provider, sessionId, { baseUrl });
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		return this.authStorage.hasOAuth(model.provider);
	}
}
