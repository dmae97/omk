/**
 * Edit tool module.
 *
 * Supports two modes:
 * - Replace mode (default): oldText/newText replacement with fuzzy matching
 * - Patch mode: structured diff format with explicit operation type
 *
 * The mode is determined by the `edit.patchMode` setting.
 */
import * as fs from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import {
	createLspWritethrough,
	type FileDiagnosticsResult,
	flushLspWritethroughBatch,
	type WritethroughCallback,
	writethroughNoop,
} from "../lsp";
import patchDescription from "../prompts/tools/patch.md" with { type: "text" };
import replaceDescription from "../prompts/tools/replace.md" with { type: "text" };
import type { ToolSession } from "../tools";
import { outputMeta } from "../tools/output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "../tools/plan-mode-guard";
import { applyPatch } from "./applicator";
import { generateDiffString, generateUnifiedDiffString, replaceText } from "./diff";
import { DEFAULT_FUZZY_THRESHOLD, findMatch } from "./fuzzy";
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "./normalize";
import { buildNormativeUpdateInput } from "./normative";
import { type EditToolDetails, getLspBatchRequest } from "./shared";
// Internal imports
import type { FileSystem, Operation, PatchInput } from "./types";
import { EditMatchError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Re-exports
// ═══════════════════════════════════════════════════════════════════════════

// Application
export { applyPatch, defaultFileSystem, previewPatch } from "./applicator";
// Diff generation
export { computeEditDiff, computePatchDiff, generateDiffString, generateUnifiedDiffString, replaceText } from "./diff";

// Fuzzy matching
export { DEFAULT_FUZZY_THRESHOLD, findContextLine, findMatch as findEditMatch, findMatch, seekSequence } from "./fuzzy";

// Normalization
export { adjustIndentation, detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "./normalize";

// Parsing
export { normalizeCreateContent, normalizeDiff, parseHunks as parseDiffHunks } from "./parser";
export type { EditRenderContext, EditToolDetails } from "./shared";
// Rendering
export { editToolRenderer, getLspBatchRequest } from "./shared";
export type {
	ApplyPatchOptions,
	ApplyPatchResult,
	ContextLineResult,
	DiffError,
	DiffError as EditDiffError,
	DiffHunk,
	DiffHunk as UpdateChunk,
	DiffHunk as UpdateFileChunk,
	DiffResult,
	DiffResult as EditDiffResult,
	FileChange,
	FileSystem,
	FuzzyMatch as EditMatch,
	FuzzyMatch,
	MatchOutcome as EditMatchOutcome,
	MatchOutcome,
	Operation,
	PatchInput,
	SequenceSearchResult,
} from "./types";
// Types
// Legacy aliases for backwards compatibility
export { ApplyPatchError, EditMatchError, ParseError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════════════════

const replaceEditSchema = Type.Object({
	path: Type.String({ description: "File path (relative or absolute)" }),
	old_text: Type.String({ description: "Text to find (fuzzy whitespace matching enabled)" }),
	new_text: Type.String({ description: "Replacement text" }),
	all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: unique match required)" })),
});

const patchEditSchema = Type.Object({
	path: Type.String({ description: "File path" }),
	op: Type.Optional(
		StringEnum(["create", "delete", "update"], {
			description: "Operation (default: update)",
		}),
	),
	rename: Type.Optional(Type.String({ description: "New path for move" })),
	diff: Type.Optional(Type.String({ description: "Diff hunks (update) or full content (create)" })),
});

export type ReplaceParams = { path: string; old_text: string; new_text: string; all?: boolean };
export type PatchParams = { path: string; op?: string; rename?: string; diff?: string };

// ═══════════════════════════════════════════════════════════════════════════
// LSP FileSystem for patch mode
// ═══════════════════════════════════════════════════════════════════════════

class LspFileSystem implements FileSystem {
	private lastDiagnostics: FileDiagnosticsResult | undefined;
	private fileCache: Record<string, Bun.BunFile> = {};

	constructor(
		private readonly writethrough: (
			dst: string,
			content: string,
			signal?: AbortSignal,
			file?: import("bun").BunFile,
			batch?: { id: string; flush: boolean },
		) => Promise<FileDiagnosticsResult | undefined>,
		private readonly signal?: AbortSignal,
		private readonly batchRequest?: { id: string; flush: boolean },
	) {}

	#getFile(path: string): Bun.BunFile {
		if (this.fileCache[path]) {
			return this.fileCache[path];
		}
		const file = Bun.file(path);
		this.fileCache[path] = file;
		return file;
	}

	async exists(path: string): Promise<boolean> {
		return this.#getFile(path).exists();
	}

	async read(path: string): Promise<string> {
		return this.#getFile(path).text();
	}

	async readBinary(path: string): Promise<Uint8Array> {
		const buffer = await this.#getFile(path).arrayBuffer();
		return new Uint8Array(buffer);
	}

	async write(path: string, content: string): Promise<void> {
		const file = this.#getFile(path);
		const result = await this.writethrough(path, content, this.signal, file, this.batchRequest);
		if (result) {
			this.lastDiagnostics = result;
		}
	}

	async delete(path: string): Promise<void> {
		await this.#getFile(path).unlink();
	}

	async mkdir(path: string): Promise<void> {
		await fs.mkdir(path, { recursive: true });
	}

	getDiagnostics(): FileDiagnosticsResult | undefined {
		return this.lastDiagnostics;
	}
}

function mergeDiagnosticsWithWarnings(
	diagnostics: FileDiagnosticsResult | undefined,
	warnings: string[],
): FileDiagnosticsResult | undefined {
	if (warnings.length === 0) return diagnostics;
	const warningMessages = warnings.map(warning => `patch: ${warning}`);
	if (!diagnostics) {
		return {
			server: "patch",
			messages: warningMessages,
			summary: `Patch warnings: ${warnings.length}`,
			errored: false,
		};
	}
	return {
		...diagnostics,
		messages: [...warningMessages, ...diagnostics.messages],
		summary: `${diagnostics.summary}; Patch warnings: ${warnings.length}`,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Class
// ═══════════════════════════════════════════════════════════════════════════

type TInput = typeof replaceEditSchema | typeof patchEditSchema;

/**
 * Edit tool implementation.
 *
 * Creates replace-mode or patch-mode behavior based on session settings.
 */
export class EditTool implements AgentTool<TInput> {
	public readonly name = "edit";
	public readonly label = "Edit";
	public readonly description: string;
	public readonly parameters: TInput;

	private readonly session: ToolSession;
	private readonly patchMode: boolean;
	private readonly allowFuzzy: boolean;
	private readonly fuzzyThreshold: number;
	private readonly writethrough: WritethroughCallback;

	constructor(session: ToolSession) {
		this.session = session;

		const {
			OMP_EDIT_FUZZY: editFuzzy = "auto",
			OMP_EDIT_FUZZY_THRESHOLD: editFuzzyThreshold = "auto",
			OMP_EDIT_VARIANT: editVariant = "auto",
		} = process.env;

		switch (editVariant) {
			case "replace":
				this.patchMode = false;
				break;
			case "patch":
				this.patchMode = true;
				break;
			case "auto":
				this.patchMode = session.settings?.getEditPatchMode?.() ?? true;
				break;
			default:
				throw new Error(`Invalid OMP_EDIT_VARIANT: ${process.env.OMP_EDIT_VARIANT}`);
		}
		switch (editFuzzy) {
			case "true":
			case "1":
				this.allowFuzzy = true;
				break;
			case "false":
			case "0":
				this.allowFuzzy = false;
				break;
			case "auto":
				this.allowFuzzy = session.settings?.getEditFuzzyMatch() ?? true;
				break;
			default:
				throw new Error(`Invalid OMP_EDIT_FUZZY: ${editFuzzy}`);
		}
		switch (editFuzzyThreshold) {
			case "auto":
				this.fuzzyThreshold = session.settings?.getEditFuzzyThreshold?.() ?? DEFAULT_FUZZY_THRESHOLD;
				break;
			default:
				this.fuzzyThreshold = parseFloat(editFuzzyThreshold);
				if (Number.isNaN(this.fuzzyThreshold) || this.fuzzyThreshold < 0 || this.fuzzyThreshold > 1) {
					throw new Error(`Invalid OMP_EDIT_FUZZY_THRESHOLD: ${editFuzzyThreshold}`);
				}
				break;
		}

		const enableLsp = session.enableLsp ?? true;
		const enableDiagnostics = enableLsp ? (session.settings?.getLspDiagnosticsOnEdit() ?? false) : false;
		const enableFormat = enableLsp ? (session.settings?.getLspFormatOnWrite() ?? true) : false;
		this.writethrough = enableLsp
			? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics })
			: writethroughNoop;
		this.description = this.patchMode
			? renderPromptTemplate(patchDescription)
			: renderPromptTemplate(replaceDescription);
		this.parameters = this.patchMode ? patchEditSchema : replaceEditSchema;
	}

	public async execute(
		_toolCallId: string,
		params: ReplaceParams | PatchParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>> {
		const batchRequest = getLspBatchRequest(context?.toolCall);

		// ─────────────────────────────────────────────────────────────────
		// Patch mode execution
		// ─────────────────────────────────────────────────────────────────
		if (this.patchMode) {
			const { path, op: rawOp, rename, diff } = params as PatchParams;

			// Normalize unrecognized operations to "update"
			const op: Operation = rawOp === "create" || rawOp === "delete" ? rawOp : "update";

			enforcePlanModeWrite(this.session, path, { op, rename });
			const resolvedPath = resolvePlanPath(this.session, path);
			const resolvedRename = rename ? resolvePlanPath(this.session, rename) : undefined;

			if (path.endsWith(".ipynb")) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}
			if (rename?.endsWith(".ipynb")) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}

			const input: PatchInput = { path: resolvedPath, op, rename: resolvedRename, diff };
			const fs = new LspFileSystem(this.writethrough, signal, batchRequest);
			const result = await applyPatch(input, {
				cwd: this.session.cwd,
				fs,
				fuzzyThreshold: this.fuzzyThreshold,
				allowFuzzy: this.allowFuzzy,
			});
			const effRename = result.change.newPath ? rename : undefined;

			// Generate diff for display
			let diffResult = { diff: "", firstChangedLine: undefined as number | undefined };
			let normative: PatchInput | undefined;
			if (result.change.type === "update" && result.change.oldContent && result.change.newContent) {
				const normalizedOld = normalizeToLF(stripBom(result.change.oldContent).text);
				const normalizedNew = normalizeToLF(stripBom(result.change.newContent).text);
				diffResult = generateUnifiedDiffString(normalizedOld, normalizedNew);
				normative = buildNormativeUpdateInput({
					path,
					rename: effRename,
					oldContent: result.change.oldContent,
					newContent: result.change.newContent,
				});
			}

			let resultText: string;
			switch (result.change.type) {
				case "create":
					resultText = `Created ${path}`;
					break;
				case "delete":
					resultText = `Deleted ${path}`;
					break;
				case "update":
					resultText = effRename ? `Updated and moved ${path} to ${effRename}` : `Updated ${path}`;
					break;
			}

			let diagnostics = fs.getDiagnostics();
			if (op === "delete" && batchRequest?.flush) {
				const flushedDiagnostics = await flushLspWritethroughBatch(batchRequest.id, this.session.cwd, signal);
				diagnostics ??= flushedDiagnostics;
			}
			const patchWarnings = result.warnings ?? [];
			const mergedDiagnostics = mergeDiagnosticsWithWarnings(diagnostics, patchWarnings);

			const meta = outputMeta()
				.diagnostics(mergedDiagnostics?.summary ?? "", mergedDiagnostics?.messages ?? [])
				.get();

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					diff: diffResult.diff,
					firstChangedLine: diffResult.firstChangedLine,
					diagnostics: mergedDiagnostics,
					op,
					rename: effRename,
					meta,
				},
				$normative: normative,
			};
		}

		// ─────────────────────────────────────────────────────────────────
		// Replace mode execution
		// ─────────────────────────────────────────────────────────────────
		const { path, old_text, new_text, all } = params as ReplaceParams;

		enforcePlanModeWrite(this.session, path);

		if (path.endsWith(".ipynb")) {
			throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
		}

		if (old_text.length === 0) {
			throw new Error("old_text must not be empty.");
		}

		const absolutePath = resolvePlanPath(this.session, path);
		const file = Bun.file(absolutePath);

		if (!(await file.exists())) {
			throw new Error(`File not found: ${path}`);
		}

		const rawContent = await file.text();
		const { bom, text: content } = stripBom(rawContent);
		const originalEnding = detectLineEnding(content);
		const normalizedContent = normalizeToLF(content);
		const normalizedOldText = normalizeToLF(old_text);
		const normalizedNewText = normalizeToLF(new_text);

		const result = replaceText(normalizedContent, normalizedOldText, normalizedNewText, {
			fuzzy: this.allowFuzzy,
			all: all ?? false,
			threshold: this.fuzzyThreshold,
		});

		if (result.count === 0) {
			// Get error details
			const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
				allowFuzzy: this.allowFuzzy,
				threshold: this.fuzzyThreshold,
			});

			if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
				const previews = matchOutcome.occurrencePreviews?.join("\n\n") ?? "";
				const moreMsg = matchOutcome.occurrences > 5 ? ` (showing first 5 of ${matchOutcome.occurrences})` : "";
				throw new Error(
					`Found ${matchOutcome.occurrences} occurrences in ${path}${moreMsg}:\n\n${previews}\n\n` +
						`Add more context lines to disambiguate.`,
				);
			}

			throw new EditMatchError(path, normalizedOldText, matchOutcome.closest, {
				allowFuzzy: this.allowFuzzy,
				threshold: this.fuzzyThreshold,
				fuzzyMatches: matchOutcome.fuzzyMatches,
			});
		}

		if (normalizedContent === result.content) {
			throw new Error(
				`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
			);
		}

		const finalContent = bom + restoreLineEndings(result.content, originalEnding);
		const diagnostics = await this.writethrough(absolutePath, finalContent, signal, file, batchRequest);
		const diffResult = generateDiffString(normalizedContent, result.content);

		const resultText =
			result.count > 1
				? `Successfully replaced ${result.count} occurrences in ${path}.`
				: `Successfully replaced text in ${path}.`;

		const meta = outputMeta()
			.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
			.get();

		return {
			content: [{ type: "text", text: resultText }],
			details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine, diagnostics, meta },
		};
	}
}
