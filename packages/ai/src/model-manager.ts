import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";
import { type GeneratedProvider, getBundledModels } from "./models";
import type { Api, Model, Provider } from "./types";

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Controls when dynamic endpoint models should be fetched.
 */
export type ModelRefreshStrategy = "online" | "offline" | "online-if-uncached";

/**
 * Hook for loading and mapping models.dev fallback data into canonical model objects.
 */
export interface ModelsDevFallback<TApi extends Api = Api, TPayload = unknown> {
	/** Fetches raw fallback payload (for example from models.dev). */
	fetch(): Promise<TPayload>;
	/** Maps payload into provider models. */
	map(payload: TPayload, providerId: Provider): readonly Model<TApi>[];
}

/**
 * Configuration for provider model resolution.
 */
export interface ModelManagerOptions<TApi extends Api = Api, TModelsDevPayload = unknown> {
	/** Provider id used for static lookup and cache namespacing. */
	providerId: Provider;
	/** Optional static list override. When omitted, bundled models.json is used. */
	staticModels?: readonly Model<TApi>[];
	/** Optional absolute cache path override. Default: <agent-dir>/models/<provider>.json. */
	cachePath?: string;
	/** Maximum cache age in milliseconds before considered stale. Default: 24h. */
	cacheTtlMs?: number;
	/** Optional dynamic endpoint fetcher. */
	fetchDynamicModels?: () => Promise<readonly Model<TApi>[] | null>;
	/** Optional models.dev fallback hook. */
	modelsDev?: ModelsDevFallback<TApi, TModelsDevPayload>;
	/** Clock override for deterministic tests. */
	now?: () => number;
}

/**
 * Resolution result.
 *
 * `stale` is false when the resolved catalog is authoritative for the selected provider:
 * - dynamic endpoint data was fetched in this call,
 * - a still-fresh authoritative cache was reused in `online-if-uncached` mode, or
 * - the provider has no dynamic fetcher configured.
 */
export interface ModelResolutionResult<TApi extends Api = Api> {
	models: Model<TApi>[];
	stale: boolean;
}

/**
 * Stateful facade over provider model resolution.
 */
export interface ModelManager<TApi extends Api = Api> {
	refresh(strategy?: ModelRefreshStrategy): Promise<ModelResolutionResult<TApi>>;
}

interface CachedProviderModels<TApi extends Api = Api> {
	version: number;
	providerId: string;
	updatedAt: number;
	models: Model<TApi>[];
	authoritative: boolean;
}
interface CacheReadResult<TApi extends Api = Api> {
	models: Model<TApi>[];
	fresh: boolean;
	authoritative: boolean;
}

/**
 * Creates a reusable provider model manager.
 */
export function createModelManager<TApi extends Api = Api, TModelsDevPayload = unknown>(
	options: ModelManagerOptions<TApi, TModelsDevPayload>,
): ModelManager<TApi> {
	return {
		refresh(strategy: ModelRefreshStrategy = "online-if-uncached") {
			return resolveProviderModels(options, strategy);
		},
	};
}

/**
 * Resolves provider models with source precedence:
 * static -> models.dev -> cache -> dynamic.
 *
 * Later sources override earlier ones by model id.
 */
export async function resolveProviderModels<TApi extends Api = Api, TModelsDevPayload = unknown>(
	options: ModelManagerOptions<TApi, TModelsDevPayload>,
	strategy: ModelRefreshStrategy = "online-if-uncached",
): Promise<ModelResolutionResult<TApi>> {
	const now = options.now ?? Date.now;
	const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const cachePath = options.cachePath ?? getDefaultCachePath(options.providerId);
	const staticModels = normalizeModelList<TApi>(
		options.staticModels ?? getBundledModels(options.providerId as GeneratedProvider),
	);
	const cache = await readCache<TApi>(cachePath, options.providerId, ttlMs, now);
	const dynamicFetcher = options.fetchDynamicModels;
	const hasDynamicFetcher = typeof dynamicFetcher === "function";
	const hasAuthoritativeCache = (cache?.authoritative ?? false) || !hasDynamicFetcher;
	const shouldFetchFromNetwork = shouldFetchRemoteSources(strategy, cache?.fresh ?? false, hasAuthoritativeCache);
	const fetchedModelsDevModels = shouldFetchFromNetwork ? await fetchModelsDev(options) : null;
	const modelsDevModels = normalizeModelList<TApi>(fetchedModelsDevModels ?? []);
	const shouldUseFreshCacheAsAuthoritative =
		strategy === "online-if-uncached" && (cache?.fresh ?? false) && hasAuthoritativeCache;
	let fetchedDynamicModels: Model<TApi>[] | null = null;
	if (dynamicFetcher && shouldFetchFromNetwork) {
		fetchedDynamicModels = await fetchDynamicModels(dynamicFetcher);
	}
	const dynamicFetchSucceeded = fetchedDynamicModels !== null;
	const cacheModels = dynamicFetchSucceeded ? [] : (cache?.models ?? []);
	const dynamicModels = fetchedDynamicModels ?? [];
	const mergedWithoutDynamic = mergeModelSources(staticModels, modelsDevModels, cacheModels);
	const models = mergeDynamicModels(mergedWithoutDynamic, dynamicModels);
	const dynamicAuthoritative = !hasDynamicFetcher || dynamicFetchSucceeded || shouldUseFreshCacheAsAuthoritative;
	if (shouldFetchFromNetwork) {
		if (dynamicFetchSucceeded) {
			const snapshotModels = mergeDynamicModels(mergeModelSources(staticModels, modelsDevModels), dynamicModels);
			await writeCache(cachePath, {
				version: CACHE_SCHEMA_VERSION,
				providerId: options.providerId,
				updatedAt: now(),
				models: snapshotModels,
				authoritative: true,
			});
		} else if (fetchedModelsDevModels !== null) {
			const latestCache = await readCache<TApi>(cachePath, options.providerId, ttlMs, now);
			if (!latestCache?.authoritative) {
				await writeCache(cachePath, {
					version: CACHE_SCHEMA_VERSION,
					providerId: options.providerId,
					updatedAt: now(),
					models: mergeModelSources(staticModels, modelsDevModels),
					authoritative: false,
				});
			}
		}
	}
	return {
		models,
		stale: !dynamicAuthoritative,
	};
}

function getDefaultCachePath(providerId: string): string {
	const encodedProvider = encodeURIComponent(providerId);
	return path.join(getAgentDir(), "models", `${encodedProvider}.json`);
}

async function fetchModelsDev<TApi extends Api, TModelsDevPayload>(
	options: ModelManagerOptions<TApi, TModelsDevPayload>,
): Promise<Model<TApi>[] | null> {
	if (!options.modelsDev) {
		return null;
	}

	try {
		const payload = await options.modelsDev.fetch();
		return normalizeModelList<TApi>(options.modelsDev.map(payload, options.providerId));
	} catch {
		return null;
	}
}

async function fetchDynamicModels<TApi extends Api>(
	fetcher: () => Promise<readonly Model<TApi>[] | null>,
): Promise<Model<TApi>[] | null> {
	try {
		const models = await fetcher();
		if (models === null) {
			return null;
		}
		return normalizeModelList<TApi>(models);
	} catch {
		return null;
	}
}

function shouldFetchRemoteSources(
	strategy: ModelRefreshStrategy,
	hasFreshCache: boolean,
	hasAuthoritativeCache: boolean,
): boolean {
	if (strategy === "offline") {
		return false;
	}
	if (strategy === "online") {
		return true;
	}
	return !hasFreshCache || !hasAuthoritativeCache;
}

async function readCache<TApi extends Api>(
	cachePath: string,
	expectedProviderId: string,
	ttlMs: number,
	now: () => number,
): Promise<CacheReadResult<TApi> | null> {
	let raw: string;
	try {
		raw = await Bun.file(cachePath).text();
	} catch (error) {
		if (isEnoent(error)) {
			return null;
		}
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	const cache = parseCache<TApi>(parsed);
	if (!cache || cache.providerId !== expectedProviderId) {
		return null;
	}

	const ageMs = now() - cache.updatedAt;
	const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs;
	return {
		models: cache.models,
		fresh,
		authoritative: cache.authoritative,
	};
}

function parseCache<TApi extends Api>(value: unknown): CachedProviderModels<TApi> | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.version !== CACHE_SCHEMA_VERSION) {
		return null;
	}
	if (typeof value.providerId !== "string") {
		return null;
	}
	if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) {
		return null;
	}
	const rawModels = Array.isArray(value.models)
		? value.models
		: Array.isArray(value.dynamicModels)
			? value.dynamicModels
			: null;
	if (!rawModels) {
		return null;
	}
	const authoritative =
		typeof value.authoritative === "boolean" ? value.authoritative : Array.isArray(value.dynamicModels);
	return {
		version: value.version,
		providerId: value.providerId,
		updatedAt: value.updatedAt,
		models: normalizeModelList<TApi>(rawModels),
		authoritative,
	};
}

async function writeCache<TApi extends Api>(cachePath: string, cache: CachedProviderModels<TApi>): Promise<void> {
	const content = `${JSON.stringify(cache, null, 2)}\n`;
	try {
		await Bun.write(cachePath, content);
		await fs.chmod(cachePath, 0o600).catch(() => undefined);
	} catch {
		// Cache writes are best-effort; failures should not break model resolution.
	}
}

function mergeModelSources<TApi extends Api>(...sources: readonly (readonly Model<TApi>[])[]): Model<TApi>[] {
	const merged = new Map<string, Model<TApi>>();
	for (const source of sources) {
		for (const model of source) {
			if (!model?.id) {
				continue;
			}
			merged.set(model.id, model);
		}
	}
	return Array.from(merged.values());
}

function mergeDynamicModels<TApi extends Api>(
	baseModels: readonly Model<TApi>[],
	dynamicModels: readonly Model<TApi>[],
): Model<TApi>[] {
	const merged = new Map<string, Model<TApi>>(baseModels.map(model => [model.id, model]));
	for (const dynamicModel of dynamicModels) {
		if (!dynamicModel?.id) {
			continue;
		}
		const existingModel = merged.get(dynamicModel.id);
		if (!existingModel) {
			merged.set(dynamicModel.id, dynamicModel);
			continue;
		}
		merged.set(dynamicModel.id, mergeDynamicModel(existingModel, dynamicModel));
	}
	return Array.from(merged.values());
}

function mergeDynamicModel<TApi extends Api>(existingModel: Model<TApi>, dynamicModel: Model<TApi>): Model<TApi> {
	const supportsImage = existingModel.input.includes("image") || dynamicModel.input.includes("image");
	return {
		...existingModel,
		...dynamicModel,
		name: preferDiscoveryName(dynamicModel.name, existingModel.name, dynamicModel.id),
		reasoning: existingModel.reasoning || dynamicModel.reasoning,
		input: supportsImage ? ["text", "image"] : ["text"],
		cost: {
			input: preferDiscoveryCost(dynamicModel.cost.input, existingModel.cost.input),
			output: preferDiscoveryCost(dynamicModel.cost.output, existingModel.cost.output),
			cacheRead: preferDiscoveryCost(dynamicModel.cost.cacheRead, existingModel.cost.cacheRead),
			cacheWrite: preferDiscoveryCost(dynamicModel.cost.cacheWrite, existingModel.cost.cacheWrite),
		},
		contextWindow: preferDiscoveryLimit(dynamicModel.contextWindow, existingModel.contextWindow),
		maxTokens: preferDiscoveryLimit(dynamicModel.maxTokens, existingModel.maxTokens),
		headers: dynamicModel.headers ? { ...existingModel.headers, ...dynamicModel.headers } : existingModel.headers,
		compat: dynamicModel.compat ?? existingModel.compat,
		contextPromotionTarget: dynamicModel.contextPromotionTarget ?? existingModel.contextPromotionTarget,
	};
}

function preferDiscoveryCost(discoveryCost: number, fallbackCost: number): number {
	if (Number.isFinite(discoveryCost) && discoveryCost > 0) {
		return discoveryCost;
	}
	return fallbackCost;
}

function preferDiscoveryName(discoveryName: string, fallbackName: string, modelId: string): string {
	const normalizedDiscoveryName = discoveryName.trim();
	if (normalizedDiscoveryName.length === 0) {
		return fallbackName;
	}
	if (normalizedDiscoveryName === modelId && fallbackName !== modelId) {
		return fallbackName;
	}
	return normalizedDiscoveryName;
}

function preferDiscoveryLimit(discoveryLimit: number, fallbackLimit: number): number {
	if (!Number.isFinite(discoveryLimit) || discoveryLimit <= 0) {
		return fallbackLimit;
	}
	if (discoveryLimit === 4096 && fallbackLimit > discoveryLimit) {
		return fallbackLimit;
	}
	return discoveryLimit;
}

function normalizeModelList<TApi extends Api>(value: unknown): Model<TApi>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const models: Model<TApi>[] = [];
	for (const item of value) {
		if (isModelLike(item)) {
			models.push(item as Model<TApi>);
		}
	}
	return models;
}

function isModelLike(value: unknown): value is Model<Api> {
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.id !== "string" || value.id.length === 0) {
		return false;
	}
	if (typeof value.name !== "string" || value.name.length === 0) {
		return false;
	}
	if (typeof value.api !== "string" || value.api.length === 0) {
		return false;
	}
	if (typeof value.provider !== "string" || value.provider.length === 0) {
		return false;
	}
	if (typeof value.baseUrl !== "string" || value.baseUrl.length === 0) {
		return false;
	}
	if (typeof value.reasoning !== "boolean") {
		return false;
	}
	if (!isModelInputArray(value.input)) {
		return false;
	}
	if (!isModelCost(value.cost)) {
		return false;
	}
	if (typeof value.contextWindow !== "number" || !Number.isFinite(value.contextWindow) || value.contextWindow <= 0) {
		return false;
	}
	if (typeof value.maxTokens !== "number" || !Number.isFinite(value.maxTokens) || value.maxTokens <= 0) {
		return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isModelInputArray(value: unknown): value is ("text" | "image")[] {
	if (!Array.isArray(value) || value.length === 0) {
		return false;
	}
	return value.every(item => item === "text" || item === "image");
}

function isModelCost(value: unknown): value is Model<Api>["cost"] {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.input === "number" &&
		Number.isFinite(value.input) &&
		typeof value.output === "number" &&
		Number.isFinite(value.output) &&
		typeof value.cacheRead === "number" &&
		Number.isFinite(value.cacheRead) &&
		typeof value.cacheWrite === "number" &&
		Number.isFinite(value.cacheWrite)
	);
}
