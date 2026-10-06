/**
 * Model registry - manages built-in and custom models, provides API key resolution.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	type OAuthProviderInterface,
	registerApiProvider,
	resetApiProviders,
	type SimpleStreamOptions,
} from "omk-ai";
import { registerOAuthProvider, resetOAuthProviders } from "omk-ai/oauth";
import { join } from "path";
import type { TLocalizedValidationError } from "typebox/error";
import { getAgentDir } from "../config.ts";
import { warnDeprecation } from "../utils/deprecation.ts";
import { stripJsonComments } from "../utils/json.ts";
import { normalizePath } from "../utils/paths.ts";
import type { AuthStatus, AuthStorage } from "./auth-storage.ts";
import { GROK_OAUTH_PROVIDER } from "./grok-playbook.ts";
import {
	applyOAuthModelModifiers,
	loadBuiltInModels,
	mergeCompat,
	mergeCustomModels,
	normalizeAnthropicBaseUrl,
	type ProviderOverride,
} from "./model-registry-builtins.ts";
import { type ModelOverride, type ModelsConfig, validateModelsConfig } from "./model-registry-schema.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "./provider-display-names.ts";
import {
	clearConfigValueCache,
	getConfigValueEnvVarNames,
	isCommandConfigValue,
	isConfigValueConfigured,
	isLegacyEnvVarNameConfigValue,
	resolveConfigValueOrThrow,
	resolveConfigValueUncached,
	resolveHeadersOrThrow,
} from "./resolve-config-value.ts";

function formatValidationPath(error: TLocalizedValidationError): string {
	if (error.keyword === "required") {
		const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
		const requiredProperty = requiredProperties?.[0];
		if (requiredProperty) {
			const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}
	const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}

/** Provider override config (baseUrl, compat) without request auth/headers */
interface ProviderRequestConfig {
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
}

function migrateLegacyRegisterProviderConfigValue(providerName: string, field: string, value: string): string {
	if (!isLegacyEnvVarNameConfigValue(value)) return value;
	warnDeprecation(
		`registerProvider("${providerName}") ${field} value "${value}" is treated as a legacy environment variable reference. This will no longer be detected as an environment variable reference in a future release. Pass "$${value}" instead.`,
	);
	return `$${value}`;
}

function migrateLegacyRegisterProviderHeaders(
	providerName: string,
	field: string,
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	let migratedHeaders: Record<string, string> | undefined;
	for (const [key, value] of Object.entries(headers)) {
		const migratedValue = migrateLegacyRegisterProviderConfigValue(providerName, `${field} header "${key}"`, value);
		if (migratedValue === value) continue;
		migratedHeaders ??= { ...headers };
		migratedHeaders[key] = migratedValue;
	}
	return migratedHeaders ?? headers;
}

function migrateLegacyRegisterProviderConfigValues(
	providerName: string,
	config: ProviderConfigInput,
): ProviderConfigInput {
	let migratedConfig: ProviderConfigInput | undefined;

	const setMigratedConfigValue = <TKey extends keyof ProviderConfigInput>(
		key: TKey,
		value: ProviderConfigInput[TKey],
	) => {
		migratedConfig ??= { ...config };
		migratedConfig[key] = value;
	};

	if (config.apiKey) {
		const apiKey = migrateLegacyRegisterProviderConfigValue(providerName, "apiKey", config.apiKey);
		if (apiKey !== config.apiKey) {
			setMigratedConfigValue("apiKey", apiKey);
		}
	}

	const headers = migrateLegacyRegisterProviderHeaders(providerName, "headers", config.headers);
	if (headers !== config.headers) {
		setMigratedConfigValue("headers", headers);
	}

	if (config.models) {
		let models: ProviderConfigInput["models"] | undefined;
		for (let index = 0; index < config.models.length; index++) {
			const model = config.models[index];
			const modelHeaders = migrateLegacyRegisterProviderHeaders(
				providerName,
				`model "${model.id}" headers`,
				model.headers,
			);
			if (modelHeaders === model.headers) continue;
			models ??= [...config.models];
			models[index] = { ...model, headers: modelHeaders };
		}
		if (models) {
			setMigratedConfigValue("models", models);
		}
	}

	return migratedConfig ?? config;
}

export type ResolvedRequestAuth =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
	  }
	| {
			ok: false;
			error: string;
	  };

const RETIRED_GROK_OAUTH_PROXY = "grok-oauth-proxy";

/**
 * The anthropic-messages adapter appends `/v1/messages` to baseUrl via plain
 * string concatenation (`new URL(baseURL + path)`). A baseUrl that already
 * ends in a version path (e.g. `.../zen/v1`, `.../inference/v1`) therefore
 * produces a doubled `/v1/v1/messages` request that upstreams answer with a
 * website 404 page. The correct Anthropic Messages endpoint always ends in
 * `/v1/messages`, so the fix is to strip the version suffix silently at
 * resolve time. No console warning — many catalog routes share one host, so
 * a per-route warning only floods startup without giving the user an action.
 */
function warnRetiredGrokOAuthProxy(): void {
	warnDeprecation(
		`models.json provider "${RETIRED_GROK_OAUTH_PROXY}" is retired. Use native "${GROK_OAUTH_PROVIDER}" OAuth or XAI_API_KEY.`,
	);
}

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models: Model<Api>[];
	/** Providers with baseUrl/headers/apiKey overrides for built-in models */
	overrides: Map<string, ProviderOverride>;
	/** Per-model overrides: provider -> modelId -> override */
	modelOverrides: Map<string, Map<string, ModelOverride>>;
	error: string | undefined;
}

function emptyCustomModelsResult(error?: string): CustomModelsResult {
	return { models: [], overrides: new Map(), modelOverrides: new Map(), error };
}

/** Clear the config value command cache. Exported for testing. */
export const clearApiKeyCache = clearConfigValueCache;

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
/**
 * SSOT audit helpers for models.json. The file is edited by humans and agent
 * sessions alike; these make silent entry loss visible instead of silent.
 */
let snapshotSequence = 0;

function collectModelIds(config: ModelsConfig): Set<string> {
	const ids = new Set<string>();
	for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
		for (const model of providerConfig.models ?? []) {
			ids.add(`${providerName}/${model.id}`);
		}
	}
	return ids;
}

function removedModelIds(previousContent: string, currentContent: string): string[] {
	try {
		const parse = (raw: string) => JSON.parse(stripJsonComments(raw)) as ModelsConfig;
		const before = collectModelIds(parse(previousContent));
		const after = collectModelIds(parse(currentContent));
		return [...before].filter((id) => !after.has(id)).sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

export class ModelRegistry {
	private models: Model<Api>[] = [];
	private customModels: Model<Api>[] = [];
	private providerOverrides = new Map<string, ProviderOverride>();
	private perModelOverrides = new Map<string, Map<string, ModelOverride>>();
	private builtInsLoaded = false;
	private providerRequestConfigs: Map<string, ProviderRequestConfig> = new Map();
	private modelRequestHeaders: Map<string, Record<string, string>> = new Map();
	private registeredProviders: Map<string, ProviderConfigInput> = new Map();
	private loadError: string | undefined = undefined;
	readonly authStorage: AuthStorage;
	private modelsJsonPath: string | undefined;

	private constructor(authStorage: AuthStorage, modelsJsonPath: string | undefined) {
		this.authStorage = authStorage;
		this.modelsJsonPath = modelsJsonPath ? normalizePath(modelsJsonPath) : undefined;
		this.loadModels();
	}

	static create(authStorage: AuthStorage, modelsJsonPath: string = join(getAgentDir(), "models.json")): ModelRegistry {
		return new ModelRegistry(authStorage, modelsJsonPath);
	}

	static inMemory(authStorage: AuthStorage): ModelRegistry {
		return new ModelRegistry(authStorage, undefined);
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	refresh(): void {
		this.providerRequestConfigs.clear();
		this.modelRequestHeaders.clear();
		this.loadError = undefined;
		this.builtInsLoaded = false;
		this.customModels = [];
		this.providerOverrides = new Map();
		this.perModelOverrides = new Map();

		// Ensure dynamic API/OAuth registrations are rebuilt from current provider state.
		resetApiProviders();
		resetOAuthProviders();

		this.loadModels();

		for (const [providerName, config] of this.registeredProviders.entries()) {
			this.applyProviderConfig(providerName, config);
		}
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): string | undefined {
		return this.loadError;
	}

	private loadModels(): void {
		// Custom models.json first; built-ins wait for ensureBuiltIns() (025 worker RSS).
		const {
			models: customModels,
			overrides,
			modelOverrides,
			error,
		} = this.modelsJsonPath ? this.loadCustomModels(this.modelsJsonPath) : emptyCustomModelsResult();

		if (error) {
			this.loadError = error;
			// Keep partial custom models; built-ins still on demand
		}

		this.customModels = customModels;
		this.providerOverrides = overrides;
		this.perModelOverrides = modelOverrides;
		this.builtInsLoaded = false;
		this.models = applyOAuthModelModifiers(this.authStorage, [...customModels]);
	}

	/** Load models.generated once; re-apply dynamic providers afterward. */
	ensureBuiltIns(): void {
		if (this.builtInsLoaded) {
			return;
		}
		const builtInModels = loadBuiltInModels(this.providerOverrides, this.perModelOverrides);
		const combined = mergeCustomModels(builtInModels, this.customModels);
		this.models = applyOAuthModelModifiers(this.authStorage, combined);
		this.builtInsLoaded = true;
		// Keep extension providers after rebuilding from the catalog.
		for (const [providerName, config] of this.registeredProviders.entries()) {
			this.applyProviderConfig(providerName, config);
		}
	}

	/** Whether models.generated has been merged in. */
	areBuiltInsLoaded(): boolean {
		return this.builtInsLoaded;
	}

	/** Load built-in models and apply provider/model overrides */
	private loadCustomModels(modelsJsonPath: string): CustomModelsResult {
		if (!existsSync(modelsJsonPath)) {
			return emptyCustomModelsResult();
		}

		try {
			const content = readFileSync(modelsJsonPath, "utf-8");
			const parsed = JSON.parse(stripJsonComments(content)) as unknown;

			if (!validateModelsConfig.Check(parsed)) {
				const errors =
					validateModelsConfig
						.Errors(parsed)
						.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
						.join("\n") || "Unknown schema error";
				return emptyCustomModelsResult(`Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`);
			}

			const config = parsed as ModelsConfig;

			// Additional validation
			this.validateConfig(config);
			this.snapshotModelsJson(content, modelsJsonPath);

			const overrides = new Map<string, ProviderOverride>();
			const modelOverrides = new Map<string, Map<string, ModelOverride>>();

			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				if (providerName === RETIRED_GROK_OAUTH_PROXY) {
					warnRetiredGrokOAuthProxy();
					continue;
				}
				if (providerConfig.baseUrl || providerConfig.compat) {
					overrides.set(providerName, {
						baseUrl: providerConfig.baseUrl,
						compat: providerConfig.compat,
					});
				}

				this.storeProviderRequestConfig(providerName, providerConfig);

				if (providerConfig.modelOverrides) {
					modelOverrides.set(providerName, new Map(Object.entries(providerConfig.modelOverrides)));
					for (const [modelId, modelOverride] of Object.entries(providerConfig.modelOverrides)) {
						this.storeModelHeaders(providerName, modelId, modelOverride.headers);
					}
				}
			}

			return { models: this.parseModels(config), overrides, modelOverrides, error: undefined };
		} catch (error) {
			if (error instanceof SyntaxError) {
				return emptyCustomModelsResult(`Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`);
			}
			return emptyCustomModelsResult(
				`Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
			);
		}
	}

	private validateConfig(config: ModelsConfig): void {
		// Only consult the built-in catalog when the answer changes validation, so a
		// fully specified custom provider never evaluates models.generated.
		let builtInProviders: Set<string> | undefined;
		const isBuiltInProvider = (providerName: string): boolean => {
			builtInProviders ??= new Set<string>(getProviders());
			return builtInProviders.has(providerName);
		};

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			if (providerName === RETIRED_GROK_OAUTH_PROXY) continue;
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];
			const hasModelOverrides =
				providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;

			if (models.length === 0) {
				// Override-only config: needs baseUrl, headers, compat, modelOverrides, or some combination.
				if (!providerConfig.baseUrl && !providerConfig.headers && !providerConfig.compat && !hasModelOverrides) {
					throw new Error(
						`Provider ${providerName}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
					);
				}
			} else if ((!providerConfig.baseUrl || !providerConfig.apiKey) && !isBuiltInProvider(providerName)) {
				// Non-built-in providers with custom models require endpoint + auth.
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
				if (!providerConfig.apiKey) {
					throw new Error(`Provider ${providerName}: "apiKey" is required when defining custom models.`);
				}
			}
			// Built-in providers with custom models: baseUrl/apiKey/api are optional,
			// inherited from built-in models. Auth comes from env vars / auth storage.

			for (const modelDef of models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi && !isBuiltInProvider(providerName)) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}
				// For built-in providers, api is optional — inherited from built-in models.

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				// Validate contextWindow/maxTokens only if provided (they have defaults)
				if (modelDef.contextWindow !== undefined && modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens !== undefined && modelDef.maxTokens <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
			}
		}
	}

	/**
	 * Keep a bounded audit trail of every successfully-loaded models.json and
	 * warn when model entries disappear between loads (e.g. another session
	 * rewrote the file). Best-effort: never blocks model loading.
	 */
	private snapshotModelsJson(content: string, modelsJsonPath: string): void {
		try {
			const snapshotDir = `${modelsJsonPath}.snapshots`;
			mkdirSync(snapshotDir, { recursive: true });
			const previous = this.latestSnapshotPath(snapshotDir);
			if (previous) {
				const previousContent = readFileSync(previous, "utf8");
				if (previousContent !== content) {
					const removed = removedModelIds(previousContent, content);
					if (removed.length > 0) {
						console.warn(
							`[model-registry] models.json changed since the last load; ${removed.length} model entr${removed.length === 1 ? "y" : "ies"} no longer present: ${removed.join(", ")}. Older versions are kept in ${snapshotDir}.`,
						);
					}
				}
			}
			snapshotSequence += 1;
			const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${snapshotSequence}`;
			writeFileSync(join(snapshotDir, `${stamp}.json`), content);
			this.pruneSnapshots(snapshotDir);
		} catch {
			// Snapshot failures must never prevent model loading.
		}
	}

	private latestSnapshotPath(snapshotDir: string): string | null {
		if (!existsSync(snapshotDir)) return null;
		const files = readdirSync(snapshotDir)
			.filter((file) => file.endsWith(".json"))
			.sort((a, b) => a.localeCompare(b));
		return files.length > 0 ? join(snapshotDir, files.at(-1) ?? "") : null;
	}

	private pruneSnapshots(snapshotDir: string, keep = 10): void {
		const files = readdirSync(snapshotDir)
			.filter((file) => file.endsWith(".json"))
			.sort((a, b) => a.localeCompare(b));
		for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
			rmSync(join(snapshotDir, stale ?? ""), { force: true });
		}
	}

	private parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];
		let builtInProviders: Set<string> | undefined;

		// Cache built-in defaults (api, baseUrl) per provider, extracted from first model.
		// Looked up only when a model lacks api/baseUrl, so complete custom entries
		// never evaluate models.generated.
		const builtInDefaultsCache = new Map<string, { api: string; baseUrl: string }>();
		const getBuiltInDefaults = (providerName: string): { api: string; baseUrl: string } | undefined => {
			builtInProviders ??= new Set<string>(getProviders());
			if (!builtInProviders.has(providerName)) return undefined;
			if (builtInDefaultsCache.has(providerName)) return builtInDefaultsCache.get(providerName);
			const builtIn = getModels(providerName as KnownProvider) as Model<Api>[];
			if (builtIn.length === 0) return undefined;
			const defaults = { api: builtIn[0].api, baseUrl: builtIn[0].baseUrl };
			builtInDefaultsCache.set(providerName, defaults);
			return defaults;
		};

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			if (providerName === RETIRED_GROK_OAUTH_PROXY) {
				warnRetiredGrokOAuthProxy();
				continue;
			}
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			for (const modelDef of modelDefs) {
				const api = modelDef.api ?? providerConfig.api ?? getBuiltInDefaults(providerName)?.api;
				if (!api) continue;

				const rawBaseUrl = modelDef.baseUrl ?? providerConfig.baseUrl ?? getBuiltInDefaults(providerName)?.baseUrl;
				if (!rawBaseUrl) continue;

				// Same doubling guard for custom models.json entries — the anthropic
				// adapter appends /v1/messages, so a versioned baseUrl would 404.
				const baseUrl = normalizeAnthropicBaseUrl(api, rawBaseUrl);

				const compat = mergeCompat(providerConfig.compat, modelDef.compat);
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				const defaultCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
				models.push({
					id: modelDef.id,
					name: modelDef.name ?? modelDef.id,
					api: api as Api,
					provider: providerName,
					baseUrl,
					reasoning: modelDef.reasoning ?? false,
					thinkingLevelMap: modelDef.thinkingLevelMap,
					input: (modelDef.input ?? ["text"]) as ("text" | "image")[],
					cost: modelDef.cost ?? defaultCost,
					contextWindow: modelDef.contextWindow ?? 128000,
					maxTokens: modelDef.maxTokens ?? 16384,
					headers: undefined,
					compat,
				} as Model<Api>);
			}
		}

		return models;
	}

	/** Custom/registered models without forcing models.generated. */
	getLoaded(): Model<Api>[] {
		return this.models;
	}

	/** Built-in + custom; loads the catalog on first call. */
	getAll(): Model<Api>[] {
		this.ensureBuiltIns();
		return this.models;
	}

	/**
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		this.ensureBuiltIns();
		return this.models.filter((m) => this.hasConfiguredAuth(m));
	}

	/** Prefer loaded custom models; load built-ins only on miss. */
	find(provider: string, modelId: string): Model<Api> | undefined {
		const loaded = this.models.find((m) => m.provider === provider && m.id === modelId);
		if (loaded || this.builtInsLoaded) {
			return loaded;
		}
		this.ensureBuiltIns();
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get API key for a model.
	 */
	hasConfiguredAuth(model: Model<Api>): boolean {
		const providerApiKey = this.providerRequestConfigs.get(model.provider)?.apiKey;
		return (
			this.authStorage.hasAuth(model.provider) ||
			(providerApiKey !== undefined && isConfigValueConfigured(providerApiKey))
		);
	}

	private getModelRequestKey(provider: string, modelId: string): string {
		return `${provider}:${modelId}`;
	}

	private storeProviderRequestConfig(
		providerName: string,
		config: {
			apiKey?: string;
			headers?: Record<string, string>;
			authHeader?: boolean;
		},
	): void {
		if (!config.apiKey && !config.headers && !config.authHeader) {
			return;
		}

		this.providerRequestConfigs.set(providerName, {
			apiKey: config.apiKey,
			headers: config.headers,
			authHeader: config.authHeader,
		});
	}

	private storeModelHeaders(providerName: string, modelId: string, headers?: Record<string, string>): void {
		const key = this.getModelRequestKey(providerName, modelId);
		if (!headers || Object.keys(headers).length === 0) {
			this.modelRequestHeaders.delete(key);
			return;
		}
		this.modelRequestHeaders.set(key, headers);
	}

	/**
	 * Force-refresh the model's OAuth credential after the provider rejected
	 * `rejectedApiKey` as expired despite a still-future stored expiry. Resolves
	 * with the replacement key, or `undefined` when the provider is not OAuth
	 * authenticated (nothing to refresh). A failed refresh rejects.
	 */
	async refreshRejectedOAuthToken(model: Model<Api>, rejectedApiKey: string): Promise<string | undefined> {
		if (this.authStorage.get(model.provider)?.type !== "oauth") return undefined;
		return this.authStorage.refreshRejectedOAuthToken(model.provider, rejectedApiKey);
	}

	/**
	 * Get API key and request headers for a model.
	 */
	async getApiKeyAndHeaders(model: Model<Api>, options?: { minRemainingMs?: number }): Promise<ResolvedRequestAuth> {
		try {
			const providerConfig = this.providerRequestConfigs.get(model.provider);
			const apiKeyFromAuthStorage = await this.authStorage.getApiKey(model.provider, {
				includeFallback: false,
				minRemainingMs: options?.minRemainingMs,
			});
			// A models.json provider key must not stand in for a stored credential whose store could not
			// be read: that substitution sent a stale environment token to the provider, and the 401
			// ("OAuth access token is invalid") survived re-running /login.
			const apiKey = apiKeyFromAuthStorage ?? this.resolveModelsJsonApiKey(model.provider, providerConfig);

			const providerHeaders = resolveHeadersOrThrow(providerConfig?.headers, `provider "${model.provider}"`);
			const modelHeaders = resolveHeadersOrThrow(
				this.modelRequestHeaders.get(this.getModelRequestKey(model.provider, model.id)),
				`model "${model.provider}/${model.id}"`,
			);

			let headers =
				model.headers || providerHeaders || modelHeaders
					? { ...model.headers, ...providerHeaders, ...modelHeaders }
					: undefined;

			if (providerConfig?.authHeader) {
				if (!apiKey) {
					return { ok: false, error: `No API key found for "${model.provider}"` };
				}
				headers = { ...headers, Authorization: `Bearer ${apiKey}` };
			}

			return {
				ok: true,
				apiKey,
				headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Return auth status for a provider, including request auth configured in models.json.
	 * This intentionally does not execute command-backed config values.
	 */
	getProviderAuthStatus(provider: string): AuthStatus {
		const authStatus = this.authStorage.getAuthStatus(provider);
		if (authStatus.source) return authStatus;

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		if (!providerApiKey) return authStatus;

		if (isCommandConfigValue(providerApiKey)) {
			return { configured: true, source: "models_json_command" };
		}

		const envVarNames = getConfigValueEnvVarNames(providerApiKey);
		if (envVarNames.length === 0) return { configured: true, source: "models_json_key" };
		return isConfigValueConfigured(providerApiKey)
			? { configured: true, source: "environment", label: envVarNames.join(", ") }
			: { configured: false };
	}

	/**
	 * Get display name for a provider.
	 */
	getProviderDisplayName(provider: string): string {
		const registeredProvider = this.registeredProviders.get(provider);
		const oauthProvider = this.authStorage.getOAuthProviders().find((p) => p.id === provider);

		return (
			registeredProvider?.name ??
			registeredProvider?.oauth?.name ??
			oauthProvider?.name ??
			BUILT_IN_PROVIDER_DISPLAY_NAMES[provider] ??
			provider
		);
	}

	/**
	 * Get API key for a provider.
	 */
	async getApiKeyForProvider(provider: string): Promise<string | undefined> {
		const apiKey = await this.authStorage.getApiKey(provider, { includeFallback: false });
		if (apiKey !== undefined) {
			return apiKey;
		}

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		return providerApiKey ? resolveConfigValueUncached(providerApiKey) : undefined;
	}

	/** Check if a provider is using OAuth credentials (subscription). */
	isUsingOAuthProvider(provider: string): boolean {
		return this.authStorage.get(provider)?.type === "oauth";
	}

	/**
	 * True when the credential store could not be read (for example, another session holds the lock).
	 * Callers must not treat this like a provider without credentials.
	 */
	hasCredentialStoreError(): boolean {
		return this.authStorage.hasLoadError();
	}

	/**
	 * A models.json provider key must not stand in for a stored credential whose store could not
	 * be read: that substitution sent a stale environment token to the provider, and the 401
	 * ("OAuth access token is invalid") survived re-running /login.
	 */
	private resolveModelsJsonApiKey(
		provider: string,
		providerConfig: ProviderRequestConfig | undefined,
	): string | undefined {
		if (this.authStorage.hasLoadError() || !providerConfig?.apiKey) return undefined;
		return resolveConfigValueOrThrow(providerConfig.apiKey, `API key for provider "${provider}"`);
	}

	/** Check if a model is using OAuth credentials (subscription). */
	isUsingOAuth(model: Model<Api>): boolean {
		return this.isUsingOAuthProvider(model.provider);
	}

	/**
	 * Register a provider dynamically (from extensions).
	 *
	 * If provider has models: replaces all existing models for this provider.
	 * If provider has only baseUrl/headers: overrides existing models' URLs.
	 * If provider has oauth: registers OAuth provider for /login support.
	 */
	registerProvider(providerName: string, config: ProviderConfigInput): void {
		const migratedConfig = migrateLegacyRegisterProviderConfigValues(providerName, config);
		this.validateProviderConfig(providerName, migratedConfig);
		this.applyProviderConfig(providerName, migratedConfig);
		this.upsertRegisteredProvider(providerName, migratedConfig);
	}

	/**
	 * Unregister a previously registered provider.
	 *
	 * Removes the provider from the registry and reloads models from disk so that
	 * built-in models overridden by this provider are restored to their original state.
	 * Also resets dynamic OAuth and API stream registrations before reapplying
	 * remaining dynamic providers.
	 * Has no effect if the provider was never registered.
	 */
	unregisterProvider(providerName: string): void {
		if (!this.registeredProviders.has(providerName)) return;
		this.registeredProviders.delete(providerName);
		this.refresh();
	}

	/**
	 * Upsert a provider config into registeredProviders.
	 * If the provider is already registered, defined values in the incoming config
	 * override existing ones; undefined values are preserved from the stored config.
	 * If the provider is not registered, the incoming config is stored as-is.
	 */
	private upsertRegisteredProvider(providerName: string, config: ProviderConfigInput): void {
		const existing = this.registeredProviders.get(providerName);
		if (!existing) {
			this.registeredProviders.set(providerName, config);
			return;
		}
		for (const k of Object.keys(config) as (keyof ProviderConfigInput)[]) {
			if (config[k] !== undefined) {
				(existing as Record<string, unknown>)[k] = config[k];
			}
		}
	}

	private validateProviderConfig(providerName: string, config: ProviderConfigInput): void {
		if (config.streamSimple && !config.api) {
			throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
		}

		if (!config.models || config.models.length === 0) {
			return;
		}

		if (!config.baseUrl) {
			throw new Error(`Provider ${providerName}: "baseUrl" is required when defining models.`);
		}
		if (!config.apiKey && !config.oauth) {
			throw new Error(`Provider ${providerName}: "apiKey" or "oauth" is required when defining models.`);
		}

		for (const modelDef of config.models) {
			const api = modelDef.api || config.api;
			if (!api) {
				throw new Error(`Provider ${providerName}, model ${modelDef.id}: no "api" specified.`);
			}
		}
	}

	private applyProviderConfig(providerName: string, config: ProviderConfigInput): void {
		// Register OAuth provider if provided
		if (config.oauth) {
			// Ensure the OAuth provider ID matches the provider name
			const oauthProvider: OAuthProviderInterface = {
				...config.oauth,
				id: providerName,
			};
			registerOAuthProvider(oauthProvider);
		}

		if (config.streamSimple) {
			const streamSimple = config.streamSimple;
			registerApiProvider(
				{
					api: config.api!,
					stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
					streamSimple,
				},
				`provider:${providerName}`,
			);
		}

		this.storeProviderRequestConfig(providerName, config);

		if (config.models && config.models.length > 0) {
			// Full replacement: remove existing models for this provider
			this.models = this.models.filter((m) => m.provider !== providerName);

			// Parse and add new models
			for (const modelDef of config.models) {
				const api = modelDef.api || config.api;
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				this.models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl: modelDef.baseUrl ?? config.baseUrl!,
					reasoning: modelDef.reasoning,
					thinkingLevelMap: modelDef.thinkingLevelMap,
					input: modelDef.input as ("text" | "image")[],
					cost: modelDef.cost,
					contextWindow: modelDef.contextWindow,
					maxTokens: modelDef.maxTokens,
					headers: undefined,
					compat: modelDef.compat,
				} as Model<Api>);
			}

			// Apply OAuth modifyModels if credentials exist (e.g., to update baseUrl)
			if (config.oauth?.modifyModels) {
				const cred = this.authStorage.get(providerName);
				if (cred?.type === "oauth") {
					this.models = config.oauth.modifyModels(this.models, cred);
				}
			}
		} else if (config.baseUrl || config.headers) {
			// Override-only: update baseUrl for existing models. Request headers are resolved per request.
			this.models = this.models.map((m) => {
				if (m.provider !== providerName) return m;
				return {
					...m,
					baseUrl: config.baseUrl ?? m.baseUrl,
				};
			});
		}
	}
}

/**
 * Input type for registerProvider API.
 */
export interface ProviderConfigInput {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: Api;
	streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
	headers?: Record<string, string>;
	authHeader?: boolean;
	/** OAuth provider for /login support */
	oauth?: Omit<OAuthProviderInterface, "id">;
	models?: Array<{
		id: string;
		name: string;
		api?: Api;
		baseUrl?: string;
		reasoning: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
		headers?: Record<string, string>;
		compat?: Model<Api>["compat"];
	}>;
}
