/**
 * Edit tool module.
 *
 * Supports two modes:
 * - Replace mode (default): oldText/newText replacement with fuzzy matching
 * - Patch mode: structured diff format with explicit operation type
 *
 * The mode is determined by the `edit.patchMode` setting.
 */

import { mkdir } from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { Type } from "@sinclair/typebox";
import patchDescription from "../../../prompts/tools/patch.md" with { type: "text" };
import replaceDescription from "../../../prompts/tools/replace.md" with { type: "text" };
import { renderPromptTemplate } from "../../prompt-templates";
import type { ToolSession } from "../index";
import {
	createLspWritethrough,
	type FileDiagnosticsResult,
	type WritethroughCallback,
	writethroughNoop,
} from "../lsp/index";
import { resolveToCwd } from "../path-utils";
import { applyPatch } from "./applicator";
import { generateDiffString, generateUnifiedDiffString, replaceText } from "./diff";
import { DEFAULT_FUZZY_THRESHOLD, findMatch } from "./fuzzy";
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "./normalize";
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
export {
	DEFAULT_FUZZY_THRESHOLD,
	findContextLine,
	findMatch,
	findMatch as findEditMatch,
	seekSequence,
} from "./fuzzy";

// Normalization
export {
	adjustIndentation as adjustNewTextIndentation,
	detectLineEnding,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./normalize";

// Parsing
export { normalizeCreateContent, normalizeDiff, parseHunks as parseDiffHunks } from "./parser";
// Rendering
export type { EditRenderContext, EditToolDetails } from "./shared";
export { editToolRenderer, getLspBatchRequest } from "./shared";
// Types
// Legacy aliases for backwards compatibility
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
	FuzzyMatch,
	FuzzyMatch as EditMatch,
	MatchOutcome,
	MatchOutcome as EditMatchOutcome,
	Operation,
	PatchInput,
	SequenceSearchResult,
} from "./types";
export { ApplyPatchError, EditMatchError, ParseError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════════════════

const replaceEditSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({
		description: "Text to find and replace (high-confidence fuzzy matching for whitespace/indentation is always on)",
	}),
	newText: Type.String({ description: "New text to replace the old text with" }),
	all: Type.Optional(Type.Boolean({ description: "Replace all occurrences instead of requiring unique match" })),
});

const patchEditSchema = Type.Object({
	path: Type.String({ description: "Path to the file (relative or absolute)" }),
	operation: Type.Union([Type.Literal("create"), Type.Literal("delete"), Type.Literal("update")], {
		description: "Operation type: create new file, delete existing file, or update file content",
	}),
	moveTo: Type.Optional(Type.String({ description: "New path for rename (update only)" })),
	diff: Type.Optional(
		Type.String({
			description:
				"For create: full file content. For update: diff hunks with @@ markers, context lines, +/- changes",
		}),
	),
});

type ReplaceParams = { path: string; oldText: string; newText: string; all?: boolean };
type PatchParams = { path: string; operation: Operation; moveTo?: string; diff?: string };

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
		await mkdir(path, { recursive: true });
	}

	getDiagnostics(): FileDiagnosticsResult | undefined {
		return this.lastDiagnostics;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Edit tool implementation.
 *
 * Creates replace-mode or patch-mode behavior based on session settings.
 */
export class EditTool implements AgentTool<typeof replaceEditSchema | typeof patchEditSchema, EditToolDetails> {
	public readonly name = "edit";
	public readonly label = "Edit";
	public readonly description: string;
	public readonly parameters: typeof replaceEditSchema | typeof patchEditSchema;

	private readonly session: ToolSession;
	private readonly patchMode: boolean;
	private readonly allowFuzzy: boolean;
	private readonly fuzzyThreshold: number;
	private readonly writethrough: WritethroughCallback;

	constructor(session: ToolSession) {
		this.session = session;
		this.patchMode = session.settings?.getEditPatchMode?.() ?? false;
		this.allowFuzzy = session.settings?.getEditFuzzyMatch() ?? true;
		this.fuzzyThreshold = session.settings?.getEditFuzzyThreshold?.() ?? DEFAULT_FUZZY_THRESHOLD;
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
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails>> {
		const batchRequest = getLspBatchRequest(context?.toolCall);

		// ─────────────────────────────────────────────────────────────────
		// Patch mode execution
		// ─────────────────────────────────────────────────────────────────
		if ("operation" in params) {
			const { path, operation, moveTo, diff } = params as PatchParams;

			if (path.endsWith(".ipynb")) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}

			const input: PatchInput = { path, operation, moveTo, diff };
			const fs = new LspFileSystem(this.writethrough, signal, batchRequest);
			const result = await applyPatch(input, { cwd: this.session.cwd, fs, fuzzyThreshold: this.fuzzyThreshold });
			const effectiveMoveTo = result.change.newPath ? moveTo : undefined;

			// Generate diff for display
			let diffResult = { diff: "", firstChangedLine: undefined as number | undefined };
			if (result.change.type === "update" && result.change.oldContent && result.change.newContent) {
				const normalizedOld = normalizeToLF(stripBom(result.change.oldContent).text);
				const normalizedNew = normalizeToLF(stripBom(result.change.newContent).text);
				diffResult = generateUnifiedDiffString(normalizedOld, normalizedNew);
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
					resultText = effectiveMoveTo ? `Updated and moved ${path} to ${effectiveMoveTo}` : `Updated ${path}`;
					break;
			}

			const diagnostics = fs.getDiagnostics();
			if (diagnostics?.messages?.length) {
				resultText += `\n\nLSP Diagnostics (${diagnostics.summary}):\n`;
				resultText += diagnostics.messages.map((d) => `  ${d}`).join("\n");
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					diff: diffResult.diff,
					firstChangedLine: diffResult.firstChangedLine,
					diagnostics,
					operation,
					moveTo: effectiveMoveTo,
				},
			};
		}

		// ─────────────────────────────────────────────────────────────────
		// Replace mode execution
		// ─────────────────────────────────────────────────────────────────
		const { path, oldText, newText, all } = params as ReplaceParams;

		if (path.endsWith(".ipynb")) {
			throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
		}

		if (oldText.length === 0) {
			throw new Error("oldText must not be empty.");
		}

		const absolutePath = resolveToCwd(path, this.session.cwd);
		const file = Bun.file(absolutePath);

		if (!(await file.exists())) {
			throw new Error(`File not found: ${path}`);
		}

		const rawContent = await file.text();
		const { bom, text: content } = stripBom(rawContent);
		const originalEnding = detectLineEnding(content);
		const normalizedContent = normalizeToLF(content);
		const normalizedOldText = normalizeToLF(oldText);
		const normalizedNewText = normalizeToLF(newText);

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
				throw new Error(
					`Found ${matchOutcome.occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique, or use all: true to replace all.`,
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

		let resultText =
			result.count > 1
				? `Successfully replaced ${result.count} occurrences in ${path}.`
				: `Successfully replaced text in ${path}.`;

		if (diagnostics?.messages?.length) {
			resultText += `\n\nLSP Diagnostics (${diagnostics.summary}):\n`;
			resultText += diagnostics.messages.map((d) => `  ${d}`).join("\n");
		}

		return {
			content: [{ type: "text", text: resultText }],
			details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine, diagnostics },
		};
	}
}
