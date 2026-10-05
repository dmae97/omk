import type { ThinkingLevel } from "omk-agent-core";
import type { Api, Model } from "omk-ai";

export type LoadedModelsSource = {
	getLoaded?: () => Model<Api>[];
};

export interface ResolveCliModelResult {
	model: Model<Api> | undefined;
	thinkingLevel?: ThinkingLevel;
	warning: string | undefined;
	/** CLI error text; when set, model is undefined. */
	error: string | undefined;
}

/** Resolve explicit --provider/--model against custom models without getAll(). */
export function findLoadedCliModel(
	registry: LoadedModelsSource,
	cliProvider: string,
	cliModel: string,
): Model<Api> | undefined {
	const loaded = typeof registry.getLoaded === "function" ? registry.getLoaded() : [];
	const providerLower = cliProvider.toLowerCase();
	let pattern = cliModel;
	const prefix = `${cliProvider}/`;
	if (cliModel.toLowerCase().startsWith(prefix.toLowerCase())) {
		pattern = cliModel.slice(prefix.length);
	}
	const patternLower = pattern.toLowerCase();
	return loaded.find((m) => m.provider.toLowerCase() === providerLower && m.id.toLowerCase() === patternLower);
}

export function resolveLoadedCliModel(
	registry: LoadedModelsSource,
	cliProvider: string | undefined,
	cliModel: string,
): ResolveCliModelResult | undefined {
	if (!cliProvider) return undefined;
	const model = findLoadedCliModel(registry, cliProvider, cliModel);
	if (!model) return undefined;
	return { model, warning: undefined, thinkingLevel: undefined, error: undefined };
}
