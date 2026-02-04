import type { Api, Model } from "@oh-my-pi/pi-ai";
import { MODEL_ROLE_IDS } from "../config/model-registry";
import {
	expandRoleAlias,
	parseModelPattern,
	resolveModelFromSettings,
	resolveModelFromString,
	SMOL_MODEL_PRIORITY,
} from "../config/model-resolver";
import type { Settings } from "../config/settings";

export async function resolvePrimaryModel(
	override: string | undefined,
	settings: Settings,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const matchPreferences = { usageOrder: settings.getStorage()?.getModelUsageOrder() };
	const roleOrder = ["commit", "smol", ...MODEL_ROLE_IDS] as const;
	const model = override
		? resolveModelFromString(expandRoleAlias(override, settings), available, matchPreferences)
		: resolveModelFromSettings({
				settings,
				availableModels: available,
				matchPreferences,
				roleOrder,
			});
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
	settings: Settings,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
	fallbackModel: Model<Api>,
	fallbackApiKey: string,
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const matchPreferences = { usageOrder: settings.getStorage()?.getModelUsageOrder() };
	const role = settings.getModelRole("smol");
	const roleModel = role
		? resolveModelFromString(expandRoleAlias(role, settings), available, matchPreferences)
		: undefined;
	if (roleModel) {
		const apiKey = await modelRegistry.getApiKey(roleModel);
		if (apiKey) return { model: roleModel, apiKey };
	}

	for (const pattern of SMOL_MODEL_PRIORITY) {
		const candidate = parseModelPattern(pattern, available, matchPreferences).model;
		if (!candidate) continue;
		const apiKey = await modelRegistry.getApiKey(candidate);
		if (apiKey) return { model: candidate, apiKey };
	}

	return { model: fallbackModel, apiKey: fallbackApiKey };
}
