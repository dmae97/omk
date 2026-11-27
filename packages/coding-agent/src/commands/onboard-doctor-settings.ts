import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "omk-agent-core";
import { type Api, getProviders, type Model, modelsAreEqual } from "omk-ai";
import { CONFIG_DIR_NAME } from "../config.ts";
import type { AuthStorage } from "../core/auth-storage.ts";
import type { ModelRegistry } from "../core/model-registry.ts";
import { findInitialModel, resolveModelScope } from "../core/model-resolver.ts";
import type { CheckResult } from "../core/onboarding/check-dag.ts";
import { AMBIENT_CREDENTIAL_PROVIDERS } from "../core/provider-default-models.ts";
import { findCustomDefaultModel, isConfiguredCredentialSource } from "./onboard-doctor-custom.ts";

export type DoctorSettingsSource = "project" | "global" | "default";

export interface EffectiveDoctorSettings {
	readonly defaultProvider?: string;
	readonly defaultModel?: string;
	readonly defaultThinkingLevel?: ThinkingLevel;
	readonly enabledModels?: readonly string[];
	readonly settingsSource: DoctorSettingsSource;
	readonly projectSettingsPath?: string;
	readonly globalSettingsPath?: string;
}

type JsonReader = (path: string) => Record<string, unknown> | undefined;

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return items.length > 0 ? items : undefined;
}

export function resolveEffectiveDoctorSettings(
	cwd: string,
	agentDir: string,
	readJsonObject: JsonReader,
): EffectiveDoctorSettings {
	const globalPath = join(agentDir, "settings.json");
	const projectPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
	const globalSettings = readJsonObject(globalPath) ?? {};
	const projectExists = existsSync(projectPath);
	const projectSettings = projectExists ? (readJsonObject(projectPath) ?? {}) : {};

	const pickString = (key: string): { value?: string; fromProject: boolean } => {
		const proj = nonEmptyString(projectSettings[key]);
		if (proj !== undefined) return { value: proj, fromProject: true };
		return { value: nonEmptyString(globalSettings[key]), fromProject: false };
	};

	const providerPick = pickString("defaultProvider");
	const modelPick = pickString("defaultModel");
	const thinkingPick = pickString("defaultThinkingLevel");
	const projectEnabled = stringList(projectSettings.enabledModels);
	const globalEnabled = stringList(globalSettings.enabledModels);
	const enabledModels = projectEnabled ?? globalEnabled;

	const projectInfluenced =
		providerPick.fromProject || modelPick.fromProject || thinkingPick.fromProject || projectEnabled !== undefined;
	const globalInfluenced =
		providerPick.value !== undefined ||
		modelPick.value !== undefined ||
		thinkingPick.value !== undefined ||
		enabledModels !== undefined;

	const settingsSource: DoctorSettingsSource = projectInfluenced ? "project" : globalInfluenced ? "global" : "default";
	return {
		defaultProvider: providerPick.value,
		defaultModel: modelPick.value,
		defaultThinkingLevel: thinkingPick.value as ThinkingLevel | undefined,
		enabledModels,
		settingsSource,
		projectSettingsPath: projectExists ? projectPath : undefined,
		globalSettingsPath: existsSync(globalPath) ? globalPath : undefined,
	};
}

function resolveCredentialSource(
	model: Model<Api>,
	registry: ModelRegistry,
	auth: AuthStorage,
	ambient: boolean,
): string {
	const registryAuthStatus = registry.getProviderAuthStatus(model.provider);
	let source: string | undefined = registryAuthStatus.source ?? auth.getAuthStatus(model.provider).source;
	if (!source && !getProviders().includes(model.provider as never)) source = "models.json";
	return source ?? (ambient ? "ambient" : "environment");
}

export async function diagnoseDefaultModel(
	cwd: string,
	agentDir: string,
	env: Readonly<Record<string, string | undefined>>,
	auth: AuthStorage,
	registry: ModelRegistry,
	readJsonObject: JsonReader,
): Promise<CheckResult> {
	const effective = resolveEffectiveDoctorSettings(cwd, agentDir, readJsonObject);
	const configuredModel =
		effective.defaultProvider && effective.defaultModel
			? `${effective.defaultProvider}/${effective.defaultModel}`
			: undefined;

	const scopedModels =
		effective.enabledModels && effective.enabledModels.length > 0
			? await resolveModelScope([...effective.enabledModels], registry)
			: [];

	let model: Model<Api> | undefined;
	let divergenceReason: string | undefined;

	if (scopedModels.length > 0) {
		const savedModel =
			effective.defaultProvider && effective.defaultModel
				? registry.find(effective.defaultProvider, effective.defaultModel)
				: undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;
		if (savedInScope) {
			model = savedInScope.model;
		} else {
			model = scopedModels[0].model;
			if (configuredModel) {
				divergenceReason = `configured default ${configuredModel} is outside enabledModels; runtime uses ${model.provider}/${model.id}`;
			}
		}
	} else {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: effective.defaultProvider,
			defaultModelId: effective.defaultModel,
			defaultThinkingLevel: effective.defaultThinkingLevel,
			modelRegistry: registry,
		});
		model = result.model;
		if (configuredModel && model && `${model.provider}/${model.id}` !== configuredModel) {
			divergenceReason = `configured default ${configuredModel} was not found in the static catalog (or is registered only by runtime extensions); fallback resolved ${model.provider}/${model.id}`;
		}
	}

	if (!model) {
		const customFallback = findCustomDefaultModel(env, registry);
		if (customFallback) {
			return {
				status: configuredModel ? "warn" : "pass",
				summary: configuredModel
					? `${customFallback.summary} (configured default ${configuredModel} not in static catalog)`
					: customFallback.summary,
			};
		}
		return {
			status: "fail",
			summary: configuredModel
				? `configured default ${configuredModel} unavailable and no fallback model`
				: "no usable model",
			fix: "Configure credentials first (see above).",
		};
	}

	const resolvedModel = `${model.provider}/${model.id}`;
	const ambient = AMBIENT_CREDENTIAL_PROVIDERS.has(model.provider);
	const source = resolveCredentialSource(model, registry, auth, ambient);
	const settingsTag = effective.settingsSource === "project" ? " · project settings" : "";
	const baseSummary = `${resolvedModel} (credential: ${source}${settingsTag})`;
	const data = {
		cwd,
		settingsSource: effective.settingsSource,
		...(effective.projectSettingsPath ? { projectSettingsPath: effective.projectSettingsPath } : {}),
		...(configuredModel ? { configuredModel } : {}),
		resolvedModel,
		matchesConfigured: configuredModel === undefined || configuredModel === resolvedModel,
		...(divergenceReason ? { divergenceReason } : {}),
		credentialSource: source,
		...(effective.defaultThinkingLevel ? { thinkingLevel: effective.defaultThinkingLevel } : {}),
	};

	if (divergenceReason) {
		return {
			status: "warn",
			summary: `${baseSummary} · ${divergenceReason}`,
			fix: "Align defaultProvider/defaultModel and enabledModels in settings.json, or run /model inside OMK.",
			data,
		};
	}
	const isConfiguredSource = isConfiguredCredentialSource(source);
	if (ambient && !isConfiguredSource) {
		return {
			status: "warn",
			summary: `${baseSummary} chosen from ambient cloud credentials`,
			fix: "If those credentials are not meant for OMK, pick another provider with /login or /model.",
			data,
		};
	}
	return { status: "pass", summary: baseSummary, data };
}
