// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { join } from "node:path";
import {
	type AgentEndEvent,
	BorderedLoader,
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type SessionEntry,
} from "open-multi-agent-kit";
import type { SlyeTab } from "./cards.ts";
import { hasExistingRewrite, REWRITE_ENTRY_TYPE } from "./entries.ts";
import { completeModel } from "./model.ts";
import { getModelDisplayName } from "./model-picker.ts";
import { loadEffectivePrompt, PROMPT_FILENAME } from "./prompt.ts";
import { type CompleteRewrite, completeRewrite, ELI5_SYSTEM_PROMPT, type RewriteOutcome } from "./rewrite.ts";
import { chooseAndSaveModel, loadConfig, resolveUsableModel, type UsableModel } from "./settings.ts";
import { type PreparedRewriteRequest, prepareManualRewriteRequest, prepareRewriteRequest } from "./target.ts";

const NO_TARGET_MESSAGE = "There is no latest completed response to rewrite.";
const DUPLICATE_MESSAGE = "The latest response already has a SLYE rewrite.";
const IN_FLIGHT_MESSAGE = "SLYE is already rewriting the latest response.";
type ManualInspection =
	| { kind: "no-target" }
	| { kind: "duplicate"; prepared: PreparedRewriteRequest }
	| { kind: "in-flight"; prepared: PreparedRewriteRequest }
	| { kind: "ready"; prepared: PreparedRewriteRequest };

export class SlyeController {
	private activeTab: SlyeTab = "rewrite";
	private startupWarned = false;
	private processingWarned = false;
	private readonly inFlight = new Set<string>();
	private readonly automaticAttempts = new Set<string>();
	private readonly completed = new Set<string>();
	private readonly omk: ExtensionAPI;
	private readonly agentDir: string;
	private readonly complete: CompleteRewrite | undefined;

	constructor(omk: ExtensionAPI, agentDir: string, complete?: CompleteRewrite) {
		this.omk = omk;
		this.agentDir = agentDir;
		this.complete = complete;
	}
	get tab(): SlyeTab {
		return this.activeTab;
	}
	toggleTab(): void {
		this.activeTab = this.activeTab === "rewrite" ? "simple" : "rewrite";
	}
	notifyStartup(ctx: ExtensionContext, message: string): void {
		if (this.startupWarned) return;
		this.startupWarned = true;
		ctx.ui.notify(message, "warning");
	}
	notifyProcessing(ctx: ExtensionContext, message = "SLYE could not create a rewrite."): void {
		if (this.processingWarned) return;
		this.processingWarned = true;
		ctx.ui.notify(message, "warning");
	}
	async rewriteAutomatic(event: AgentEndEvent, ctx: ExtensionContext): Promise<void> {
		try {
			const config = await loadConfig(ctx, this.agentDir);
			if (config.kind !== "valid" || !config.config.enabled) return;
			const model = config.config.model === undefined ? undefined : resolveUsableModel(ctx, config.config.model);
			if (model === undefined) return;
			const branch = ctx.sessionManager.getBranch();
			const prepared = prepareRewriteRequest(event.messages, branch);
			if (prepared === undefined || !this.claimAutomatic(branch, prepared.entryId)) return;
			try {
				ctx.ui.setWorkingMessage("Rewriting AI-speak…");
				const outcome = await this.rewriteTarget(ctx, model, prepared, ctx.signal);
				if (outcome.kind === "failed") this.notifyProcessing(ctx);
			} catch {
				this.notifyProcessing(ctx);
			} finally {
				try {
					ctx.ui.setWorkingMessage();
				} catch {
					this.notifyProcessing(ctx);
				}
				this.inFlight.delete(prepared.entryId);
			}
		} catch {
			this.notifyProcessing(ctx);
		}
	}
	async rewriteLatest(ctx: ExtensionCommandContext): Promise<void> {
		await ctx.waitForIdle();
		let inspection = this.inspectManual(ctx.sessionManager.getBranch());
		if (inspection.kind !== "ready") return this.notifyInspection(ctx, inspection);
		const config = await loadConfig(ctx, this.agentDir);
		if (config.kind === "invalid") {
			ctx.ui.notify(
				`SLYE configuration is invalid at ${config.path}. It was not changed. Run /slye model.`,
				"warning",
			);
			return;
		}
		let model =
			config.kind === "valid" && config.config.model !== undefined
				? resolveUsableModel(ctx, config.config.model)
				: undefined;
		if (model === undefined) {
			model = await chooseAndSaveModel(ctx, this.agentDir, false);
			if (model === undefined) return;
			inspection = this.inspectManual(ctx.sessionManager.getBranch());
			if (inspection.kind !== "ready") return this.notifyInspection(ctx, inspection);
		}
		const claim = this.claimManual(inspection.prepared.entryId);
		if (claim === "completed") return void ctx.ui.notify(DUPLICATE_MESSAGE, "info");
		if (claim === "in-flight") return void ctx.ui.notify(IN_FLIGHT_MESSAGE, "info");
		try {
			const outcome = await ctx.ui.custom<RewriteOutcome>((tui, theme, _keys, done) => {
				const loader = new BorderedLoader(tui, theme, "Rewriting AI-speak…");
				void this.rewriteTarget(ctx, model, inspection.prepared, loader.signal)
					.then(done)
					.catch(() => done({ kind: "failed" }));
				return loader;
			});
			if (outcome.kind === "failed") this.notifyProcessing(ctx);
		} catch {
			this.notifyProcessing(ctx);
		} finally {
			this.inFlight.delete(inspection.prepared.entryId);
		}
	}
	private async rewriteTarget(
		ctx: ExtensionContext,
		model: UsableModel,
		prepared: PreparedRewriteRequest,
		signal: AbortSignal | undefined,
	): Promise<RewriteOutcome> {
		try {
			const prompt = await loadEffectivePrompt(
				join(this.agentDir, PROMPT_FILENAME),
				join(ctx.cwd, CONFIG_DIR_NAME, PROMPT_FILENAME),
				ctx.isProjectTrusted(),
			);
			if (signal?.aborted) return { kind: "cancelled" };
			if (prompt.kind === "invalid") {
				this.notifyProcessing(ctx, `SLYE system prompt is invalid at ${prompt.path}. Fix or remove it.`);
				return { kind: "failed" };
			}
			const complete =
				this.complete ?? ((request, options) => completeModel(ctx.modelRegistry, model.model, request, options));
			const customPrompt = prompt.kind === "valid" ? prompt.text : undefined;
			const [simple, rewrite] = await Promise.all([
				completeRewrite(prepared.request, signal, complete, customPrompt),
				completeRewrite(prepared.request, signal, complete, ELI5_SYSTEM_PROMPT),
			]);
			if (simple.kind === "cancelled" || rewrite.kind === "cancelled") return { kind: "cancelled" };
			if (simple.kind !== "success" || rewrite.kind !== "success") return { kind: "failed" };
			this.omk.appendEntry(REWRITE_ENTRY_TYPE, {
				display: simple.display,
				rewrite: rewrite.display,
				targetEntryId: prepared.entryId,
				modelName: getModelDisplayName(model.model),
			});
			this.completed.add(prepared.entryId);
			return simple;
		} catch {
			return { kind: "failed" };
		}
	}
	private inspectManual(branch: readonly SessionEntry[]): ManualInspection {
		const prepared = prepareManualRewriteRequest(branch);
		if (prepared === undefined) return { kind: "no-target" };
		if (hasExistingRewrite(branch, prepared.entryId) || this.completed.has(prepared.entryId))
			return { kind: "duplicate", prepared };
		if (this.inFlight.has(prepared.entryId)) return { kind: "in-flight", prepared };
		return { kind: "ready", prepared };
	}
	private notifyInspection(ctx: ExtensionCommandContext, inspection: ManualInspection): void {
		let message = IN_FLIGHT_MESSAGE;
		if (inspection.kind === "no-target") message = NO_TARGET_MESSAGE;
		if (inspection.kind === "duplicate") message = DUPLICATE_MESSAGE;
		ctx.ui.notify(message, "info");
	}
	private claimAutomatic(branch: readonly SessionEntry[], entryId: string): boolean {
		if (
			hasExistingRewrite(branch, entryId) ||
			this.completed.has(entryId) ||
			this.inFlight.has(entryId) ||
			this.automaticAttempts.has(entryId)
		)
			return false;
		this.automaticAttempts.add(entryId);
		this.inFlight.add(entryId);
		return true;
	}
	private claimManual(entryId: string): "claimed" | "completed" | "in-flight" {
		if (this.completed.has(entryId)) return "completed";
		if (this.inFlight.has(entryId)) return "in-flight";
		this.inFlight.add(entryId);
		return "claimed";
	}
}
