// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { type ExtensionAPI, getAgentDir } from "open-multi-agent-kit";
import { buildLegacyCard, buildTabbedCard, cardBackground } from "./cards.ts";
import { SlyeController } from "./controller.ts";
import { parseRewriteEntryData, REWRITE_ENTRY_TYPE } from "./entries.ts";
import type { CompleteRewrite } from "./rewrite.ts";
import {
	chooseAndSaveModel,
	loadConfig,
	MISSING_MODEL_GUIDANCE,
	resolveUsableModel,
	turnOff,
	turnOn,
} from "./settings.ts";

const USAGE = "Usage: /slye [model|on|off]";
export type SlyeExtensionOptions = { agentDir?: string; complete?: CompleteRewrite };

export default function speakLikeYouEat(omk: ExtensionAPI, options: SlyeExtensionOptions = {}): void {
	const controller = new SlyeController(omk, options.agentDir ?? getAgentDir(), options.complete);
	omk.registerEntryRenderer(REWRITE_ENTRY_TYPE, (entry, _options, theme) => {
		const data = parseRewriteEntryData(entry.data);
		if (data === undefined) return undefined;
		return data.rewrite === undefined
			? buildLegacyCard(theme, data.display, cardBackground(theme), data.modelName)
			: buildTabbedCard(theme, data.display, data.rewrite, () => controller.tab, data.modelName);
	});
	omk.registerShortcut("ctrl+\\", {
		description: "Switch SLYE tab",
		handler: (ctx) => {
			controller.toggleTab();
			ctx.ui.setStatus("slye", undefined);
		},
	});
	omk.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const config = await loadConfig(ctx, options.agentDir ?? getAgentDir());
		if (config.kind === "unconfigured") return controller.notifyStartup(ctx, MISSING_MODEL_GUIDANCE);
		if (config.kind === "invalid")
			return controller.notifyStartup(
				ctx,
				`SLYE configuration is invalid at ${config.path}. Fix it or run /slye model.`,
			);
		if (config.config.model === undefined) return controller.notifyStartup(ctx, MISSING_MODEL_GUIDANCE);
		if (config.config.enabled && resolveUsableModel(ctx, config.config.model) === undefined) {
			controller.notifyStartup(ctx, "SLYE's selected model is unavailable. Run /slye model.");
		}
	});
	omk.on("agent_end", async (event, ctx) => {
		if (ctx.mode === "tui") await controller.rewriteAutomatic(event, ctx);
	});
	omk.registerCommand("slye", {
		description: "Rewrite the latest response or configure Speak like you eat",
		getArgumentCompletions: (prefix) => {
			const matches = ["model", "on", "off"].filter((command) => command.startsWith(prefix));
			return matches.length === 0 ? null : matches.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const command = args.trim();
			try {
				if (command === "") return await controller.rewriteLatest(ctx);
				if (command === "model") {
					const config = await loadConfig(ctx, options.agentDir ?? getAgentDir());
					await chooseAndSaveModel(
						ctx,
						options.agentDir ?? getAgentDir(),
						config.kind === "valid" && config.config.enabled,
					);
					return;
				}
				if (command === "off") return await turnOff(ctx, options.agentDir ?? getAgentDir());
				if (command === "on") return await turnOn(ctx, options.agentDir ?? getAgentDir());
				ctx.ui.notify(USAGE, "info");
			} catch {
				controller.notifyProcessing(ctx);
			}
		},
	});
}
