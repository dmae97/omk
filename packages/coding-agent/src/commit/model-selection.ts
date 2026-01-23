import type { Api, Model } from "@oh-my-pi/pi-ai";
import { parseModelPattern, parseModelString, SMOL_MODEL_PRIORITY } from "$c/config/model-resolver";
import type { SettingsManager } from "$c/config/settings-manager";

export async function resolvePrimaryModel(
	override: string | undefined,
	settingsManager: SettingsManager,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const model = override
		? resolveModelFromString(override, available)
		: resolveModelFromSettings(settingsManager, available);
	if (!model) {
		throw new Error("No model available for commit generation");
	}
	const apiKey = await modelRegistry.getApiKey(model);
	if (!apiKey) {
		throw new Error(`No API key available for model ${model.provider}/${model.id}`);
	}
	return { model, apiKey };
}

export async function resolveSmolModel(
	settingsManager: SettingsManager,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
	fallbackModel: Model<Api>,
	fallbackApiKey: string,
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const role = settingsManager.getModelRole("smol");
	const roleModel = role ? resolveModelFromString(role, available) : undefined;
	if (roleModel) {
		const apiKey = await modelRegistry.getApiKey(roleModel);
		if (apiKey) return { model: roleModel, apiKey };
	}

	for (const pattern of SMOL_MODEL_PRIORITY) {
		const candidate = parseModelPattern(pattern, available).model;
		if (!candidate) continue;
		const apiKey = await modelRegistry.getApiKey(candidate);
		if (apiKey) return { model: candidate, apiKey };
	}

	return { model: fallbackModel, apiKey: fallbackApiKey };
}

function resolveModelFromSettings(settingsManager: SettingsManager, available: Model<Api>[]): Model<Api> | undefined {
	const configured = settingsManager.getModelRole("default");
	if (!configured) return available[0];
	return resolveModelFromString(configured, available) ?? available[0];
}

function resolveModelFromString(value: string, available: Model<Api>[]): Model<Api> | undefined {
	const parsed = parseModelString(value);
	if (parsed) {
		return available.find((model) => model.provider === parsed.provider && model.id === parsed.id);
	}
	return parseModelPattern(value, available).model;
}
