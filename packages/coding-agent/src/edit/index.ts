import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { prompt } from "@oh-my-pi/pi-utils";
import {
	createLspWritethrough,
	type FileDiagnosticsResult,
	type WritethroughCallback,
	type WritethroughDeferredHandle,
	writethroughNoop,
} from "../lsp";
import chunkEditDescription from "../prompts/tools/chunk-edit.md" with { type: "text" };
import hashlineDescription from "../prompts/tools/hashline.md" with { type: "text" };
import patchDescription from "../prompts/tools/patch.md" with { type: "text" };
import replaceDescription from "../prompts/tools/replace.md" with { type: "text" };
import type { ToolSession } from "../tools";
import { type EditMode, normalizeEditMode, resolveEditMode } from "../utils/edit-mode";
import {
	type ChunkParams,
	chunkEditParamsSchema,
	executeChunkMode,
	isChunkParams,
	resolveAnchorStyle,
} from "./modes/chunk";
import { executeHashlineMode, type HashlineParams, hashlineEditParamsSchema, isHashlineParams } from "./modes/hashline";
import { executePatchMode, isPatchParams, type PatchParams, patchEditSchema } from "./modes/patch";
import { executeReplaceMode, isReplaceParams, type ReplaceParams, replaceEditSchema } from "./modes/replace";
import { type EditToolDetails, getLspBatchRequest, type LspBatchRequest } from "./renderer";

export { DEFAULT_EDIT_MODE, type EditMode, normalizeEditMode } from "../utils/edit-mode";
export * from "./diff";
export * from "./modes/chunk";
export * from "./modes/hashline";
export * from "./modes/patch";
export * from "./modes/replace";
export * from "./normalize";
export * from "./renderer";

type TInput =
	| typeof replaceEditSchema
	| typeof patchEditSchema
	| typeof hashlineEditParamsSchema
	| typeof chunkEditParamsSchema;

type EditParams = ReplaceParams | PatchParams | HashlineParams | ChunkParams;

type ModeExecutionArgs = {
	params: EditParams;
	signal: AbortSignal | undefined;
	batchRequest: LspBatchRequest | undefined;
};

type EditModeDefinition = {
	description: (session: ToolSession) => string;
	parameters: TInput;
	invalidParamsMessage: string;
	validate: (params: EditParams) => boolean;
	execute: (tool: EditTool, args: ModeExecutionArgs) => Promise<AgentToolResult<EditToolDetails, TInput>>;
};

function resolveConfiguredEditMode(rawEditMode: string): EditMode | undefined {
	if (!rawEditMode || rawEditMode === "auto") {
		return undefined;
	}

	const editMode = normalizeEditMode(rawEditMode);
	if (!editMode) {
		throw new Error(`Invalid PI_EDIT_VARIANT: ${rawEditMode}`);
	}

	return editMode;
}

function resolveAllowFuzzy(session: ToolSession, rawValue: string): boolean {
	switch (rawValue) {
		case "true":
		case "1":
			return true;
		case "false":
		case "0":
			return false;
		case "auto":
			return session.settings.get("edit.fuzzyMatch");
		default:
			throw new Error(`Invalid PI_EDIT_FUZZY: ${rawValue}`);
	}
}

function resolveFuzzyThreshold(session: ToolSession, rawValue: string): number {
	if (rawValue === "auto") {
		return session.settings.get("edit.fuzzyThreshold");
	}

	const threshold = Number.parseFloat(rawValue);
	if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
		throw new Error(`Invalid PI_EDIT_FUZZY_THRESHOLD: ${rawValue}`);
	}

	return threshold;
}

function createEditWritethrough(session: ToolSession): WritethroughCallback {
	const enableLsp = session.enableLsp ?? true;
	const enableDiagnostics = enableLsp && session.settings.get("lsp.diagnosticsOnEdit");
	const enableFormat = enableLsp && session.settings.get("lsp.formatOnWrite");
	return enableLsp ? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics }) : writethroughNoop;
}

export class EditTool implements AgentTool<TInput> {
	readonly name = "edit";
	readonly label = "Edit";
	readonly nonAbortable = true;
	readonly concurrency = "exclusive";
	readonly strict = true;

	readonly #allowFuzzy: boolean;
	readonly #fuzzyThreshold: number;
	readonly #writethrough: WritethroughCallback;
	readonly #editMode?: EditMode;
	readonly #pendingDeferredFetches = new Map<string, AbortController>();

	constructor(private readonly session: ToolSession) {
		const {
			PI_EDIT_FUZZY: editFuzzy = "auto",
			PI_EDIT_FUZZY_THRESHOLD: editFuzzyThreshold = "auto",
			PI_EDIT_VARIANT: envEditVariant = "auto",
		} = Bun.env;

		this.#editMode = resolveConfiguredEditMode(envEditVariant);
		this.#allowFuzzy = resolveAllowFuzzy(session, editFuzzy);
		this.#fuzzyThreshold = resolveFuzzyThreshold(session, editFuzzyThreshold);
		this.#writethrough = createEditWritethrough(session);
	}

	get mode(): EditMode {
		if (this.#editMode) return this.#editMode;
		return resolveEditMode(this.session);
	}

	get description(): string {
		return this.#getModeDefinition().description(this.session);
	}

	get parameters(): TInput {
		return this.#getModeDefinition().parameters;
	}

	async execute(
		_toolCallId: string,
		params: ReplaceParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>>;
	async execute(
		_toolCallId: string,
		params: PatchParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>>;
	async execute(
		_toolCallId: string,
		params: HashlineParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>>;
	async execute(
		_toolCallId: string,
		params: ChunkParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>>;
	async execute(
		_toolCallId: string,
		params: EditParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>> {
		const modeDefinition = this.#getModeDefinition();
		if (!modeDefinition.validate(params)) {
			throw new Error(modeDefinition.invalidParamsMessage);
		}

		return modeDefinition.execute(this, {
			params,
			signal,
			batchRequest: getLspBatchRequest(context?.toolCall),
		});
	}

	#getModeDefinition(): EditModeDefinition {
		return {
			chunk: {
				description: (session: ToolSession) =>
					prompt.render(chunkEditDescription, {
						anchorStyle: resolveAnchorStyle(session.settings),
					}),
				parameters: chunkEditParamsSchema,
				invalidParamsMessage: "Invalid edit parameters for chunk mode.",
				validate: isChunkParams,
				async execute(tool: EditTool, args: ModeExecutionArgs) {
					return executeChunkMode({
						session: tool.session,
						params: args.params as ChunkParams,
						signal: args.signal,
						batchRequest: args.batchRequest,
						writethrough: tool.#writethrough,
						beginDeferredDiagnosticsForPath: path => tool.#beginDeferredDiagnosticsForPath(path),
					});
				},
			},
			patch: {
				description: () => prompt.render(patchDescription),
				parameters: patchEditSchema,
				invalidParamsMessage: "Invalid edit parameters for patch mode.",
				validate: isPatchParams,
				async execute(tool: EditTool, args: ModeExecutionArgs) {
					return executePatchMode({
						session: tool.session,
						params: args.params as PatchParams,
						signal: args.signal,
						batchRequest: args.batchRequest,
						allowFuzzy: tool.#allowFuzzy,
						fuzzyThreshold: tool.#fuzzyThreshold,
						writethrough: tool.#writethrough,
						beginDeferredDiagnosticsForPath: path => tool.#beginDeferredDiagnosticsForPath(path),
					});
				},
			},
			hashline: {
				description: () => prompt.render(hashlineDescription),
				parameters: hashlineEditParamsSchema,
				invalidParamsMessage: "Invalid edit parameters for hashline mode.",
				validate: isHashlineParams,
				async execute(tool: EditTool, args: ModeExecutionArgs) {
					return executeHashlineMode({
						session: tool.session,
						params: args.params as HashlineParams,
						signal: args.signal,
						batchRequest: args.batchRequest,
						writethrough: tool.#writethrough,
						beginDeferredDiagnosticsForPath: path => tool.#beginDeferredDiagnosticsForPath(path),
					});
				},
			},
			replace: {
				description: () => prompt.render(replaceDescription),
				parameters: replaceEditSchema,
				invalidParamsMessage: "Invalid edit parameters for replace mode.",
				validate: isReplaceParams,
				async execute(tool: EditTool, args: ModeExecutionArgs) {
					return executeReplaceMode({
						session: tool.session,
						params: args.params as ReplaceParams,
						signal: args.signal,
						batchRequest: args.batchRequest,
						allowFuzzy: tool.#allowFuzzy,
						fuzzyThreshold: tool.#fuzzyThreshold,
						writethrough: tool.#writethrough,
						beginDeferredDiagnosticsForPath: path => tool.#beginDeferredDiagnosticsForPath(path),
					});
				},
			},
		}[this.mode];
	}

	#beginDeferredDiagnosticsForPath(path: string): WritethroughDeferredHandle {
		const existingDeferred = this.#pendingDeferredFetches.get(path);
		if (existingDeferred) {
			existingDeferred.abort();
			this.#pendingDeferredFetches.delete(path);
		}

		const deferredController = new AbortController();
		return {
			onDeferredDiagnostics: (lateDiagnostics: FileDiagnosticsResult) => {
				this.#pendingDeferredFetches.delete(path);
				this.#injectLateDiagnostics(path, lateDiagnostics);
			},
			signal: deferredController.signal,
			finalize: (diagnostics: FileDiagnosticsResult | undefined) => {
				if (!diagnostics) {
					this.#pendingDeferredFetches.set(path, deferredController);
				} else {
					deferredController.abort();
				}
			},
		};
	}

	#injectLateDiagnostics(path: string, diagnostics: FileDiagnosticsResult): void {
		const summary = diagnostics.summary ?? "";
		const lines = diagnostics.messages ?? [];
		const body = [`Late LSP diagnostics for ${path} (arrived after the edit tool returned):`, summary, ...lines]
			.filter(Boolean)
			.join("\n");

		this.session.queueDeferredMessage?.({
			role: "custom",
			customType: "lsp-late-diagnostic",
			content: body,
			display: false,
			timestamp: Date.now(),
		});
	}
}
