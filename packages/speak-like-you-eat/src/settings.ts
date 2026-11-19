// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionCommandContext, type ExtensionContext } from "open-multi-agent-kit";
import {
	CONFIG_FILENAME,
	type EffectiveConfig,
	loadEffectiveConfig,
	type ModelReference,
	readConfig,
	type SlyeConfig,
	writeConfigAtomically,
} from "./config.ts";
import { lowestSupportedThinkingLevel, type ThinkingLevel } from "./model.ts";
import { formatModelCandidate, pickModel, selectModelCandidates } from "./model-picker.ts";

const MODEL_SCOPE_ALL = "All projects";
const MODEL_SCOPE_PROJECT = "This project only";
export const MISSING_MODEL_GUIDANCE =
	"SLYE has no model configured. Run /slye model to configure manual rewrites, or /slye on to configure and enable automatic rewrites.";
type OmkModel = NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;
export type UsableModel = { model: OmkModel; thinkingLevel: ThinkingLevel };
export type SlyePaths = { global: string; project: string };

export function getConfigPaths(ctx: ExtensionContext, agentDir: string): SlyePaths {
	return { global: join(agentDir, CONFIG_FILENAME), project: join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILENAME) };
}
export function loadConfig(ctx: ExtensionContext, agentDir: string): Promise<EffectiveConfig> {
	const paths = getConfigPaths(ctx, agentDir);
	return loadEffectiveConfig(paths.global, paths.project, ctx.isProjectTrusted());
}
export function resolveUsableModel(ctx: ExtensionContext, reference: ModelReference): UsableModel | undefined {
	const model = ctx.modelRegistry.find(reference.provider, reference.id);
	if (model === undefined || !ctx.modelRegistry.hasConfiguredAuth(model)) return undefined;
	const thinkingLevel = lowestSupportedThinkingLevel(model);
	return thinkingLevel === undefined ? undefined : { model, thinkingLevel };
}
export async function chooseAndSaveModel(
	ctx: ExtensionCommandContext,
	agentDir: string,
	enabled: boolean,
): Promise<UsableModel | undefined> {
	const scoped = selectModelCandidates(ctx.scopedModels?.map(({ model }) => model) ?? [], (model) =>
		ctx.modelRegistry.hasConfiguredAuth(model),
	);
	const all = selectModelCandidates(ctx.modelRegistry.getAvailable(), (model) =>
		ctx.modelRegistry.hasConfiguredAuth(model),
	);
	if (scoped.length === 0 && all.length === 0) {
		ctx.ui.notify("No authenticated models are available for SLYE.", "warning");
		return undefined;
	}
	const selected = await pickModel(ctx, scoped, all);
	if (selected === undefined) return undefined;
	const reference = { provider: selected.provider, id: selected.id };
	const usable = resolveUsableModel(ctx, reference);
	if (usable === undefined) {
		ctx.ui.notify("SLYE's selected model is unavailable. Run /slye model.", "warning");
		return undefined;
	}
	const trusted = ctx.isProjectTrusted();
	const scope = await ctx.ui.select(
		"Save SLYE model for",
		trusted ? [MODEL_SCOPE_ALL, MODEL_SCOPE_PROJECT] : [MODEL_SCOPE_ALL],
	);
	if (scope === undefined) return undefined;
	const config: SlyeConfig = enabled ? { enabled: true, model: reference } : { enabled: false, model: reference };
	const paths = getConfigPaths(ctx, agentDir);
	const label = formatModelCandidate(selected);
	const saved =
		scope === MODEL_SCOPE_PROJECT
			? await saveModelConfig(ctx, paths.project, config, MODEL_SCOPE_PROJECT, label)
			: await saveGlobalConfig(ctx, paths, trusted, config, label);
	return saved ? usable : undefined;
}
export async function turnOff(ctx: ExtensionCommandContext, agentDir: string): Promise<void> {
	const effective = await loadConfig(ctx, agentDir);
	if (effective.kind === "invalid") {
		ctx.ui.notify(`SLYE configuration is invalid at ${effective.path}. It was not changed.`, "warning");
		return;
	}
	const path = effective.kind === "valid" ? effective.path : getConfigPaths(ctx, agentDir).global;
	const model = effective.kind === "valid" ? effective.config.model : undefined;
	const config: SlyeConfig = model === undefined ? { enabled: false } : { enabled: false, model };
	try {
		await writeConfigAtomically(path, config);
	} catch {
		ctx.ui.notify("Could not save SLYE configuration.", "warning");
		return;
	}
	ctx.ui.notify("SLYE automatic rewrites are off. Manual /slye remains available.", "info");
}
export async function turnOn(ctx: ExtensionCommandContext, agentDir: string): Promise<void> {
	const effective = await loadConfig(ctx, agentDir);
	if (effective.kind === "invalid") {
		ctx.ui.notify(`SLYE configuration is invalid at ${effective.path}. Repair it or run /slye model.`, "warning");
		return;
	}
	if (effective.kind === "valid" && effective.config.model !== undefined) {
		const model = effective.config.model;
		const usable = resolveUsableModel(ctx, model);
		if (usable !== undefined) {
			const scope = effective.scope === "project" ? MODEL_SCOPE_PROJECT : MODEL_SCOPE_ALL;
			await saveModelConfig(
				ctx,
				effective.path,
				{ enabled: true, model },
				scope,
				formatModelCandidate({ ...model, thinkingLevel: usable.thinkingLevel }),
			);
			return;
		}
	}
	await chooseAndSaveModel(ctx, agentDir, true);
}
async function saveGlobalConfig(
	ctx: ExtensionCommandContext,
	paths: SlyePaths,
	trusted: boolean,
	config: SlyeConfig,
	label: string,
): Promise<boolean> {
	let removeProject = false;
	if (trusted) {
		const project = await readConfig(paths.project);
		if (project.kind !== "missing") {
			const confirmed = await ctx.ui.confirm(
				"Project SLYE configuration",
				"The project file takes precedence over and blocks the global setting in this project. Remove it and use the global setting?",
			);
			if (!confirmed) return false;
			removeProject = true;
		}
	}
	try {
		await writeConfigAtomically(paths.global, config);
	} catch {
		ctx.ui.notify("Could not save SLYE configuration.", "warning");
		return false;
	}
	if (removeProject) {
		try {
			await rm(paths.project);
		} catch {
			ctx.ui.notify(
				"Global SLYE configuration was saved, but the project file could not be removed. It still takes precedence.",
				"warning",
			);
			return false;
		}
	}
	ctx.ui.notify(formatSavedModelMessage(config.enabled, label, MODEL_SCOPE_ALL), "info");
	return true;
}
async function saveModelConfig(
	ctx: ExtensionCommandContext,
	path: string,
	config: SlyeConfig,
	scope: string,
	label: string,
): Promise<boolean> {
	try {
		await writeConfigAtomically(path, config);
	} catch {
		ctx.ui.notify("Could not save SLYE configuration.", "warning");
		return false;
	}
	ctx.ui.notify(formatSavedModelMessage(config.enabled, label, scope), "info");
	return true;
}
function formatSavedModelMessage(enabled: boolean, label: string, scope: string): string {
	return enabled
		? `SLYE enabled with ${label} for ${scope}.`
		: `SLYE manual rewrites configured with ${label} for ${scope}.`;
}
