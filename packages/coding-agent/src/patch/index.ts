/**
 * Edit tool module.
 *
 * Supports three modes:
 * - Replace mode (default): oldText/newText replacement with fuzzy matching
 * - Patch mode: structured diff format with explicit operation type
 * - Hashline mode: line-addressed edits using content hashes for integrity
 *
 * The mode is determined by the `edit.mode` setting.
 */
import * as fs from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import {
	createLspWritethrough,
	type FileDiagnosticsResult,
	flushLspWritethroughBatch,
	type WritethroughCallback,
	writethroughNoop,
} from "../lsp";
import hashlineDescription from "../prompts/tools/hashline.md" with { type: "text" };
import patchDescription from "../prompts/tools/patch.md" with { type: "text" };
import replaceDescription from "../prompts/tools/replace.md" with { type: "text" };
import type { ToolSession } from "../tools";
import { outputMeta } from "../tools/output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "../tools/plan-mode-guard";
import { applyPatch } from "./applicator";
import { generateDiffString, generateUnifiedDiffString, replaceText } from "./diff";
import { findMatch } from "./fuzzy";
import { applyHashlineEdits, computeLineHash, parseLineRef } from "./hashline";
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
export {
	computeEditDiff,
	computeHashlineDiff,
	computePatchDiff,
	generateDiffString,
	generateUnifiedDiffString,
	replaceText,
} from "./diff";

// Fuzzy matching
export { DEFAULT_FUZZY_THRESHOLD, findContextLine, findMatch as findEditMatch, findMatch, seekSequence } from "./fuzzy";
// Hashline
export {
	applyHashlineEdits,
	computeLineHash,
	formatHashLines,
	HashlineMismatchError,
	parseLineRef,
	streamHashLinesFromLines,
	streamHashLinesFromUtf8,
	validateLineRef,
} from "./hashline";
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
	HashMismatch,
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

export type ReplaceParams = Static<typeof replaceEditSchema>;
export type PatchParams = Static<typeof patchEditSchema>;

const hashlineSingleSchema = Type.Object(
	{
		set_line: Type.Object({
			anchor: Type.String({ description: 'Line reference "LINE:HASH"' }),
			new_text: Type.String({ description: 'Replacement content (\\n-separated) — "" for delete' }),
		}),
	},
	{ additionalProperties: true },
);

const hashlineRangeSchema = Type.Object(
	{
		replace_lines: Type.Object({
			start_anchor: Type.String({ description: 'Start line ref "LINE:HASH"' }),
			end_anchor: Type.String({ description: 'End line ref "LINE:HASH"' }),
			new_text: Type.String({ description: 'Replacement content (\\n-separated) — "" for delete' }),
		}),
	},
	{ additionalProperties: true },
);
const hashlineInsertAfterSchema = Type.Object(
	{
		insert_after: Type.Object({
			anchor: Type.String({ description: 'Insert after this line "LINE:HASH"' }),
			text: Type.String({ description: "Content to insert (\\n-separated); must be non-empty" }),
		}),
	},
	{ additionalProperties: true },
);
const hashlineReplaceSchema = Type.Object(
	{
		replace: Type.Object({
			old_text: Type.String({ description: "Text to find (fuzzy whitespace matching enabled)" }),
			new_text: Type.String({ description: "Replacement text" }),
			all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: unique match required)" })),
		}),
	},
	{ additionalProperties: true },
);
const hashlineEditItemSchema = Type.Union([
	hashlineSingleSchema,
	hashlineRangeSchema,
	hashlineInsertAfterSchema,
	hashlineReplaceSchema,
]);
const hashlineEditSchema = Type.Object(
	{
		path: Type.String({ description: "File path (relative or absolute)" }),
		edits: Type.Array(hashlineEditItemSchema, { description: "Array of edit operations" }),
	},
	{ additionalProperties: true },
);

export type HashlineEdit = Static<typeof hashlineEditItemSchema>;
export type HashlineParams = Static<typeof hashlineEditSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// LSP FileSystem for patch mode
// ═══════════════════════════════════════════════════════════════════════════

class LspFileSystem implements FileSystem {
	#lastDiagnostics: FileDiagnosticsResult | undefined;
	#fileCache: Record<string, Bun.BunFile> = {};

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
		if (this.#fileCache[path]) {
			return this.#fileCache[path];
		}
		const file = Bun.file(path);
		this.#fileCache[path] = file;
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
			this.#lastDiagnostics = result;
		}
	}

	async delete(path: string): Promise<void> {
		await this.#getFile(path).unlink();
	}

	async mkdir(path: string): Promise<void> {
		await fs.mkdir(path, { recursive: true });
	}

	getDiagnostics(): FileDiagnosticsResult | undefined {
		return this.#lastDiagnostics;
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

type TInput = typeof replaceEditSchema | typeof patchEditSchema | typeof hashlineEditSchema;

export type EditMode = "replace" | "patch" | "hashline";

export const DEFAULT_EDIT_MODE: EditMode = "patch";

export function normalizeEditMode(mode?: string | null): EditMode | null {
	switch (mode) {
		case "replace":
			return "replace";
		case "patch":
			return "patch";
		case "hashline":
			return "hashline";
		default:
			return null;
	}
}

/**
 * Edit tool implementation.
 *
 * Creates replace-mode, patch-mode, or hashline-mode behavior based on session settings.
 */
export class EditTool implements AgentTool<TInput> {
	readonly name = "edit";
	readonly label = "Edit";
	readonly nonAbortable = true;
	readonly concurrency = "exclusive";

	readonly #allowFuzzy: boolean;
	readonly #fuzzyThreshold: number;
	readonly #writethrough: WritethroughCallback;
	readonly #editMode?: EditMode | null;

	constructor(private readonly session: ToolSession) {
		const {
			PI_EDIT_FUZZY: editFuzzy = "auto",
			PI_EDIT_FUZZY_THRESHOLD: editFuzzyThreshold = "auto",
			PI_EDIT_VARIANT: envEditVariant = "auto",
		} = Bun.env;

		if (envEditVariant && envEditVariant !== "auto") {
			const editMode = normalizeEditMode(envEditVariant);
			if (!editMode) {
				throw new Error(`Invalid PI_EDIT_VARIANT: ${envEditVariant}`);
			}
			this.#editMode = editMode;
		}

		switch (editFuzzy) {
			case "true":
			case "1":
				this.#allowFuzzy = true;
				break;
			case "false":
			case "0":
				this.#allowFuzzy = false;
				break;
			case "auto":
				this.#allowFuzzy = session.settings.get("edit.fuzzyMatch");
				break;
			default:
				throw new Error(`Invalid PI_EDIT_FUZZY: ${editFuzzy}`);
		}
		switch (editFuzzyThreshold) {
			case "auto":
				this.#fuzzyThreshold = session.settings.get("edit.fuzzyThreshold");
				break;
			default:
				this.#fuzzyThreshold = parseFloat(editFuzzyThreshold);
				if (Number.isNaN(this.#fuzzyThreshold) || this.#fuzzyThreshold < 0 || this.#fuzzyThreshold > 1) {
					throw new Error(`Invalid PI_EDIT_FUZZY_THRESHOLD: ${editFuzzyThreshold}`);
				}
				break;
		}

		const enableLsp = session.enableLsp ?? true;
		const enableDiagnostics = enableLsp && session.settings.get("lsp.diagnosticsOnEdit");
		const enableFormat = enableLsp && session.settings.get("lsp.formatOnWrite");
		this.#writethrough = enableLsp
			? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics })
			: writethroughNoop;
	}

	/**
	 * Determine edit mode dynamically based on current model.
	 * This is re-evaluated on each access so tool definitions stay current when model changes.
	 */
	get mode(): EditMode {
		if (this.#editMode) return this.#editMode;
		const activeModel = this.session.getActiveModelString?.();
		const editVariant =
			this.session.settings.getEditVariantForModel(activeModel) ??
			normalizeEditMode(this.session.settings.get("edit.mode"));
		return editVariant ?? DEFAULT_EDIT_MODE;
	}

	/**
	 * Dynamic description based on current edit mode (which depends on current model).
	 */
	get description(): string {
		switch (this.mode) {
			case "patch":
				return renderPromptTemplate(patchDescription);
			case "hashline":
				return renderPromptTemplate(hashlineDescription);
			default:
				return renderPromptTemplate(replaceDescription);
		}
	}

	/**
	 * Dynamic parameters schema based on current edit mode (which depends on current model).
	 */
	get parameters(): TInput {
		switch (this.mode) {
			case "patch":
				return patchEditSchema;
			case "hashline":
				return hashlineEditSchema;
			default:
				return replaceEditSchema;
		}
	}

	async execute(
		_toolCallId: string,
		params: ReplaceParams | PatchParams | HashlineParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EditToolDetails, TInput>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<EditToolDetails, TInput>> {
		const batchRequest = getLspBatchRequest(context?.toolCall);

		// ─────────────────────────────────────────────────────────────────
		// Hashline mode execution
		// ─────────────────────────────────────────────────────────────────
		if (this.mode === "hashline") {
			const { path, edits } = params as HashlineParams;

			enforcePlanModeWrite(this.session, path);

			if (path.endsWith(".ipynb")) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}

			// Detect wrong-format fields from models confusing edit modes
			for (let i = 0; i < edits.length; i++) {
				const edit = edits[i] as Record<string, unknown>;
				if (("old_text" in edit || "new_text" in edit) && !("replace" in edit)) {
					throw new Error(
						`edits[${i}] contains 'old_text'/'new_text' at top level (replace mode). ` +
							`Use {replace: {old_text, new_text}} for hashline content replace, or {set_line}, {replace_lines}, {insert_after}.`,
					);
				}
				if ("diff" in edit) {
					throw new Error(
						`edits[${i}] contains 'diff' field from patch mode. ` +
							`Hashline edits use: {set_line}, {replace_lines}, {insert_after}, or {replace}.`,
					);
				}
				if (
					!("set_line" in edit) &&
					!("replace_lines" in edit) &&
					!("insert_after" in edit) &&
					!("replace" in edit)
				) {
					throw new Error(
						`edits[${i}] must contain exactly one of: 'set_line', 'replace_lines', 'insert_after', or 'replace'. Got keys: [${Object.keys(edit).join(", ")}].`,
					);
				}
			}

			const anchorEdits = edits.filter(
				(e): e is HashlineEdit => "set_line" in e || "replace_lines" in e || "insert_after" in e,
			);
			const replaceEdits = edits.filter(
				(e): e is { replace: { old_text: string; new_text: string; all?: boolean } } => "replace" in e,
			);

			const absolutePath = resolvePlanPath(this.session, path);
			const file = Bun.file(absolutePath);

			if (!(await file.exists())) {
				throw new Error(`File not found: ${path}`);
			}

			const rawContent = await file.text();
			const { bom, text: content } = stripBom(rawContent);
			const originalEnding = detectLineEnding(content);
			const originalNormalized = normalizeToLF(content);
			let normalizedContent = originalNormalized;

			// Apply anchor-based edits first (set_line, replace_lines, insert_after)
			const anchorResult = applyHashlineEdits(normalizedContent, anchorEdits);
			normalizedContent = anchorResult.content;

			// Apply content-replace edits (substr-style fuzzy replace)
			for (const r of replaceEdits) {
				if (r.replace.old_text.length === 0) {
					throw new Error("replace.old_text must not be empty.");
				}
				const rep = replaceText(normalizedContent, r.replace.old_text, r.replace.new_text, {
					fuzzy: this.#allowFuzzy,
					all: r.replace.all ?? false,
					threshold: this.#fuzzyThreshold,
				});
				normalizedContent = rep.content;
			}

			const result = {
				content: normalizedContent,
				firstChangedLine: anchorResult.firstChangedLine,
				warnings: anchorResult.warnings,
				noopEdits: anchorResult.noopEdits,
			};
			if (originalNormalized === result.content) {
				let diagnostic = `No changes made to ${path}. The edits produced identical content.`;
				if (result.noopEdits && result.noopEdits.length > 0) {
					const details = result.noopEdits
						.map(
							e =>
								`Edit ${e.editIndex}: replacement for ${e.loc} is identical to current content:\n  ${e.loc}| ${e.currentContent}`,
						)
						.join("\n");
					diagnostic += `\n${details}`;
					diagnostic +=
						"\nYour content must differ from what the file already contains. Re-read the file to see the current state.";
				} else {
					// Edits were not literally identical but heuristics normalized them back
					const lines = result.content.split("\n");
					const targetLines: string[] = [];
					for (const edit of edits) {
						const refs: string[] = [];
						if ("set_line" in edit) refs.push(edit.set_line.anchor);
						else if ("replace_lines" in edit)
							refs.push(edit.replace_lines.start_anchor, edit.replace_lines.end_anchor);
						else if ("insert_after" in edit) refs.push(edit.insert_after.anchor);
						for (const ref of refs) {
							try {
								const parsed = parseLineRef(ref);
								if (parsed.line >= 1 && parsed.line <= lines.length) {
									const lineContent = lines[parsed.line - 1];
									const hash = computeLineHash(parsed.line, lineContent);
									targetLines.push(`${parsed.line}:${hash}  ${lineContent}`);
								}
							} catch {
								/* skip malformed refs */
							}
						}
					}
					if (targetLines.length > 0) {
						const preview = [...new Set(targetLines)].slice(0, 5).join("\n");
						diagnostic += `\nThe file currently contains these lines:\n${preview}\nYour edits were normalized back to the original content (whitespace-only differences are preserved as-is). Ensure your replacement changes actual code, not just formatting.`;
					}
				}
				throw new Error(diagnostic);
			}

			const finalContent = bom + restoreLineEndings(result.content, originalEnding);
			const diagnostics = await this.#writethrough(absolutePath, finalContent, signal, file, batchRequest);
			const diffResult = generateDiffString(originalNormalized, result.content);

			const normative = buildNormativeUpdateInput({
				path,
				oldContent: rawContent,
				newContent: finalContent,
			});

			const meta = outputMeta()
				.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
				.get();

			return {
				content: [
					{
						type: "text",
						text: `Updated ${path}${result.warnings?.length ? `\n\nWarnings:\n${result.warnings.join("\n")}` : ""}`,
					},
				],
				details: {
					diff: diffResult.diff,
					firstChangedLine: result.firstChangedLine ?? diffResult.firstChangedLine,
					diagnostics,
					meta,
				},
				$normative: normative,
			};
		}

		// ─────────────────────────────────────────────────────────────────
		// Patch mode execution
		// ─────────────────────────────────────────────────────────────────
		if (this.mode === "patch") {
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
			const fs = new LspFileSystem(this.#writethrough, signal, batchRequest);
			const result = await applyPatch(input, {
				cwd: this.session.cwd,
				fs,
				fuzzyThreshold: this.#fuzzyThreshold,
				allowFuzzy: this.#allowFuzzy,
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
			fuzzy: this.#allowFuzzy,
			all: all ?? false,
			threshold: this.#fuzzyThreshold,
		});

		if (result.count === 0) {
			// Get error details
			const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
				allowFuzzy: this.#allowFuzzy,
				threshold: this.#fuzzyThreshold,
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
				allowFuzzy: this.#allowFuzzy,
				threshold: this.#fuzzyThreshold,
				fuzzyMatches: matchOutcome.fuzzyMatches,
			});
		}

		if (normalizedContent === result.content) {
			throw new Error(
				`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
			);
		}

		const finalContent = bom + restoreLineEndings(result.content, originalEnding);
		const diagnostics = await this.#writethrough(absolutePath, finalContent, signal, file, batchRequest);
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
