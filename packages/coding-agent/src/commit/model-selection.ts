import type { Api, Model } from "@oh-my-pi/pi-ai";
import { parseModelPattern, parseModelString, SMOL_MODEL_PRIORITY } from "../config/model-resolver";
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
	const model = override
		? resolveModelFromString(expandRoleAlias(override, settings), available, matchPreferences)
		: resolveModelFromSettings(settings, available, matchPreferences);
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
	const roleModel = role ? resolveModelFromString(role, available, matchPreferences) : undefined;
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

function resolveModelFromSettings(
	settings: Settings,
	available: Model<Api>[],
	matchPreferences: { usageOrder?: string[] },
): Model<Api> | undefined {
	const roles = ["commit", "smol", "default"];
	for (const role of roles) {
		const configured = settings.getModelRole(role);
		if (!configured) continue;
		const resolved = resolveModelFromString(expandRoleAlias(configured, settings), available, matchPreferences);
		if (resolved) return resolved;
	}
	return available[0];
}

function resolveModelFromString(
	value: string,
	available: Model<Api>[],
	matchPreferences: { usageOrder?: string[] },
): Model<Api> | undefined {
	const parsed = parseModelString(value);
	if (parsed) {
		return available.find(model => model.provider === parsed.provider && model.id === parsed.id);
	}
	return parseModelPattern(value, available, matchPreferences).model;
}

function expandRoleAlias(value: string, settings: Settings): string {
	const lower = value.toLowerCase();
	if (lower.startsWith("pi/")) {
		const role = value.slice(3);
		return settings.getModelRole(role) ?? value;
	}
	return value;
}
