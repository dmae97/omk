// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CONFIG_FILENAME = "slye.json";
export type ModelReference = { provider: string; id: string };
export type SlyeConfig = { enabled: false; model?: ModelReference } | { enabled: true; model: ModelReference };
export type ConfigReadResult =
	| { kind: "missing"; path: string }
	| { kind: "valid"; path: string; config: SlyeConfig }
	| { kind: "invalid"; path: string };
export type EffectiveConfig =
	| { kind: "unconfigured" }
	| { kind: "invalid"; path: string }
	| { kind: "valid"; path: string; scope: "global" | "project"; config: SlyeConfig };

export function parseConfig(value: unknown): SlyeConfig | undefined {
	if (!isPlainObject(value)) return undefined;
	const keys = Object.keys(value);
	if (keys.some((key) => key !== "enabled" && key !== "model")) return undefined;
	if (typeof value.enabled !== "boolean") return undefined;
	const model = value.model === undefined ? undefined : parseModelReference(value.model);
	if (value.model !== undefined && model === undefined) return undefined;
	if (value.enabled) return model === undefined ? undefined : { enabled: true, model };
	return model === undefined ? { enabled: false } : { enabled: false, model };
}

export async function readConfig(path: string): Promise<ConfigReadResult> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return { kind: isMissingFile(error) ? "missing" : "invalid", path };
	}
	try {
		const config = parseConfig(JSON.parse(text) as unknown);
		return config === undefined ? { kind: "invalid", path } : { kind: "valid", path, config };
	} catch {
		return { kind: "invalid", path };
	}
}

export async function loadEffectiveConfig(
	globalPath: string,
	projectPath: string,
	projectTrusted: boolean,
): Promise<EffectiveConfig> {
	if (projectTrusted) {
		const projectConfig = await readConfig(projectPath);
		if (projectConfig.kind === "invalid") return projectConfig;
		if (projectConfig.kind === "valid") return { ...projectConfig, scope: "project" };
	}
	const globalConfig = await readConfig(globalPath);
	if (globalConfig.kind === "invalid") return globalConfig;
	if (globalConfig.kind === "valid") return { ...globalConfig, scope: "global" };
	return { kind: "unconfigured" };
}

export async function writeConfigAtomically(path: string, config: SlyeConfig): Promise<void> {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	const contents = `${JSON.stringify(config, null, 2)}\n`;
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

function parseModelReference(value: unknown): ModelReference | undefined {
	if (!isPlainObject(value)) return undefined;
	const keys = Object.keys(value);
	if (keys.length !== 2 || keys.some((key) => key !== "provider" && key !== "id")) return undefined;
	if (typeof value.provider !== "string" || value.provider.trim() === "") return undefined;
	if (typeof value.id !== "string" || value.id.trim() === "") return undefined;
	return { provider: value.provider, id: value.id };
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
