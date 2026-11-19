import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getProviders } from "omk-ai";
import type { ModelRegistry } from "../core/model-registry.ts";
import { resolveKimiConfig } from "./doctor-provider.ts";

export function findCustomProviders(
	agentDir: string,
	env: Readonly<Record<string, string | undefined>>,
	readJsonObject: (path: string) => Record<string, unknown> | undefined,
): string[] {
	const custom: string[] = [];
	const modelsConfig = readJsonObject(join(agentDir, "models.json"));
	if (modelsConfig && typeof modelsConfig.providers === "object" && modelsConfig.providers !== null) {
		for (const [name, cfg] of Object.entries(modelsConfig.providers as Record<string, unknown>)) {
			if (typeof cfg === "object" && cfg !== null) {
				const c = cfg as { apiKey?: string; baseUrl?: string; models?: unknown[] };
				if (c.apiKey || c.baseUrl || (Array.isArray(c.models) && c.models.length > 0)) {
					custom.push(`${name} (models.json)`);
				}
			}
		}
	}

	const kimiHome = env.HOME ?? homedir();
	const kimiPath = env.KIMI_CONFIG_PATH ?? join(kimiHome, ".kimi", "config.toml");
	if (existsSync(kimiPath)) {
		const res = resolveKimiConfig(kimiPath);
		if (!res.failure) {
			if (res.customProvider) custom.push(`kimi:${res.customProvider.name} (~/.kimi/config.toml)`);
			else if (res.baseUrl) custom.push("kimi-coding (~/.kimi/config.toml)");
		}
	}
	return custom;
}

export function findCustomDefaultModel(
	env: Readonly<Record<string, string | undefined>>,
	registry: ModelRegistry,
): { summary: string } | undefined {
	const customModels = registry.getAll().filter((m) => !getProviders().includes(m.provider as any));
	if (customModels.length > 0) {
		const model = customModels[0];
		const source = registry.getProviderAuthStatus(model.provider).source ?? "models.json";
		return { summary: `${model.provider}/${model.id} (credential: ${source})` };
	}

	const kimiHome = env.HOME ?? homedir();
	const kimiPath = env.KIMI_CONFIG_PATH ?? join(kimiHome, ".kimi", "config.toml");
	if (existsSync(kimiPath)) {
		const res = resolveKimiConfig(kimiPath);
		if (!res.failure && (res.customProvider || res.baseUrl)) {
			const modelId = res.customProvider?.modelName ?? res.modelName ?? "kimi-k2.6";
			const prov = res.customProvider ? `kimi-coding (custom:${res.customProvider.name})` : "kimi-coding";
			const src = res.customProvider ? `kimi-config-toml:providers.${res.customProvider.name}` : "kimi-config-toml";
			return { summary: `${prov}/${modelId} (credential: ${src})` };
		}
	}
	return undefined;
}

export function isConfiguredCredentialSource(source: string): boolean {
	return (
		source === "stored" ||
		source === "runtime" ||
		source === "models_json_key" ||
		source === "models_json_command" ||
		source === "models.json" ||
		source.startsWith("kimi-config-toml")
	);
}
