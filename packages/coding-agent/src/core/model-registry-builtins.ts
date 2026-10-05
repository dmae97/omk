import {
	type AnthropicMessagesCompat,
	type Api,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	type OpenAICompletionsCompat,
	type OpenAIResponsesCompat,
} from "omk-ai";
import type { AuthStorage } from "./auth-storage.ts";
import type { ModelOverride } from "./model-registry-schema.ts";

export interface ProviderOverride {
	baseUrl?: string;
	compat?: Model<Api>["compat"];
}

/** Apply OAuth providers' modifyModels hooks to a model list. */
export function applyOAuthModelModifiers(authStorage: AuthStorage, models: Model<Api>[]): Model<Api>[] {
	let combined = models;
	for (const oauthProvider of authStorage.getOAuthProviders()) {
		const credentials = authStorage.getOAuthCredentials(oauthProvider.id);
		if (credentials && oauthProvider.modifyModels) {
			combined = oauthProvider.modifyModels(combined, credentials);
		}
	}
	return combined;
}

export function normalizeAnthropicBaseUrl(api: string, baseUrl: string): string {
	if (api !== "anthropic-messages") return baseUrl;
	return baseUrl.replace(/\/v\d+\/?$/i, "");
}

function mergeCompat(
	baseCompat: Model<Api>["compat"],
	overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
	if (!overrideCompat) return baseCompat;
	const base = baseCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | undefined;
	const override = overrideCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
	const merged = { ...base, ...override } as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
	const baseCompletions = base as OpenAICompletionsCompat | undefined;
	const overrideCompletions = override as OpenAICompletionsCompat;
	const mergedCompletions = merged as OpenAICompletionsCompat;
	if (baseCompletions?.openRouterRouting || overrideCompletions.openRouterRouting) {
		mergedCompletions.openRouterRouting = {
			...baseCompletions?.openRouterRouting,
			...overrideCompletions.openRouterRouting,
		};
	}
	if (baseCompletions?.vercelGatewayRouting || overrideCompletions.vercelGatewayRouting) {
		mergedCompletions.vercelGatewayRouting = {
			...baseCompletions?.vercelGatewayRouting,
			...overrideCompletions.vercelGatewayRouting,
		};
	}
	return merged as Model<Api>["compat"];
}

function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };
	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.thinkingLevelMap !== undefined) {
		result.thinkingLevelMap = { ...model.thinkingLevelMap, ...override.thinkingLevelMap };
	}
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
	result.compat = mergeCompat(model.compat, override.compat);
	return result;
}

/** Materialize built-in catalog models with models.json overrides applied. */
export function loadBuiltInModels(
	overrides: Map<string, ProviderOverride>,
	modelOverrides: Map<string, Map<string, ModelOverride>>,
): Model<Api>[] {
	return getProviders().flatMap((provider) => {
		const models = getModels(provider as KnownProvider) as Model<Api>[];
		const providerOverride = overrides.get(provider);
		const perModelOverrides = modelOverrides.get(provider);
		return models.map((m) => {
			let model = m;
			if (providerOverride) {
				model = {
					...model,
					baseUrl: providerOverride.baseUrl ?? model.baseUrl,
					compat: mergeCompat(model.compat, providerOverride.compat),
				};
			}
			const modelOverride = perModelOverrides?.get(m.id);
			if (modelOverride) model = applyModelOverride(model, modelOverride);
			const normalizedBaseUrl = normalizeAnthropicBaseUrl(model.api, model.baseUrl);
			return normalizedBaseUrl === model.baseUrl ? model : { ...model, baseUrl: normalizedBaseUrl };
		});
	});
}

/** Merge custom models into built-in list by provider+id (custom wins). */
export function mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
	const merged = [...builtInModels];
	for (const customModel of customModels) {
		const existingIndex = merged.findIndex((m) => m.provider === customModel.provider && m.id === customModel.id);
		if (existingIndex >= 0) merged[existingIndex] = customModel;
		else merged.push(customModel);
	}
	return merged;
}

export { mergeCompat };
