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
import {
	invalidateFsScanAfterDelete,
	invalidateFsScanAfterRename,
	invalidateFsScanAfterWrite,
} from "../tools/fs-cache-invalidation";
import { outputMeta } from "../tools/output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "../tools/plan-mode-guard";
import { applyPatch } from "./applicator";
import { generateDiffString, generateUnifiedDiffString, replaceText } from "./diff";
import { findMatch } from "./fuzzy";
import {
	applyHashlineEdits,
	computeLineHash,
	type HashlineEdit,
	type LineTag,
	parseTag,
	type ReplaceTextEdit,
} from "./hashline";
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
	parseTag,
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

/** Pattern matching hashline display format: `LINE#ID:CONTENT` */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+#[0-9a-zA-Z]{1,16}:/;

/** Pattern matching a unified-diff added-line `+` prefix (but not `++`). Does NOT match `-` to avoid corrupting Markdown list items. */
const DIFF_PLUS_RE = /^[+](?![+])/;

/**
 * Strip hashline display prefixes and diff `+` markers from replacement lines.
 *
 * Models frequently copy the `LINE#ID  ` prefix from read output into their
 * replacement content, or include unified-diff `+` prefixes. Both corrupt the
 * output file. This strips them heuristically before application.
 */
export function stripNewLinePrefixes(lines: string[]): string[] {
	// Detect whether the *majority* of non-empty lines carry a prefix —
	// if only one line out of many has a match it's likely real content.
	let hashPrefixCount = 0;
	let diffPlusCount = 0;
	let nonEmpty = 0;
	for (const l of lines) {
		if (l.length === 0) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(l)) hashPrefixCount++;
		if (DIFF_PLUS_RE.test(l)) diffPlusCount++;
	}
	if (nonEmpty === 0) return lines;

	const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5;
	const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5;

	if (!stripHash && !stripPlus) return lines;

	return lines.map(l => {
		if (stripHash) return l.replace(HASHLINE_PREFIX_RE, "");
		if (stripPlus) return l.replace(DIFF_PLUS_RE, "");
		return l;
	});
}

const hashlineReplaceContentFormat = (kind: string) =>
	Type.Union([
		Type.Null(),
		Type.Array(Type.String(), { description: `${kind} lines` }),
		Type.String({ description: `${kind} line` }),
	]);

const hashlineInsertContentFormat = (kind: string) =>
	Type.Union([
		Type.Array(Type.String(), { description: `${kind} lines`, minItems: 1 }),
		Type.String({ description: `${kind} line`, minLength: 1 }),
	]);

const hashlineTagFormat = (what: string) =>
	Type.String({
		description: `Tag identifying the ${what} in "LINE#ID" format`,
	});

export function hashlineParseContent(edit: string | string[] | null): string[] {
	if (edit === null) return [];
	if (Array.isArray(edit)) return edit;
	const lines = stripNewLinePrefixes(edit.split("\n"));
	if (lines.length === 0) return [];
	if (lines[lines.length - 1].trim() === "") return lines.slice(0, -1);
	return lines;
}

function hashlineParseContentString(edit: string | string[] | null): string {
	if (edit === null) return "";
	if (Array.isArray(edit)) return edit.join("\n");
	return edit;
}

const hashlineTargetEditSchema = Type.Object(
	{
		op: Type.Literal("set"),
		tag: hashlineTagFormat("line being replaced"),
		content: hashlineReplaceContentFormat("Replacement"),
	},
	{ additionalProperties: false },
);

const hashlineAppendEditSchema = Type.Object(
	{
		op: Type.Literal("append"),
		after: Type.Optional(hashlineTagFormat("line after which to append")),
		content: hashlineInsertContentFormat("Appended"),
	},
	{ additionalProperties: false },
);

const hashlinePrependEditSchema = Type.Object(
	{
		op: Type.Literal("prepend"),
		before: Type.Optional(hashlineTagFormat("line before which to prepend")),
		content: hashlineInsertContentFormat("Prepended"),
	},
	{ additionalProperties: false },
);

const hashlineRangeEditSchema = Type.Object(
	{
		op: Type.Literal("replace"),
		first: hashlineTagFormat("first line"),
		last: hashlineTagFormat("last line"),
		content: hashlineReplaceContentFormat("Replacement"),
	},
	{ additionalProperties: false },
);

const hashlineInsertEditSchema = Type.Object(
	{
		op: Type.Literal("insert"),
		before: Type.Optional(hashlineTagFormat("line before which to insert")),
		after: Type.Optional(hashlineTagFormat("line after which to insert")),
		content: hashlineInsertContentFormat("Inserted"),
	},
	{ additionalProperties: false },
);

const hashlineReplaceTextEditSchema = Type.Object(
	{
		op: Type.Literal("replaceText"),
		old_text: Type.String({ description: "Text to find", minLength: 1 }),
		new_text: hashlineReplaceContentFormat("Replacement"),
		all: Type.Optional(Type.Boolean({ description: "Replace all occurrences" })),
	},
	{ additionalProperties: false },
);

const HL_REPLACE_ENABLED = Bun.env.PI_HL_REPLACETXT === "1";

const hashlineEditSpecSchema = Type.Union([
	hashlineTargetEditSchema,
	hashlineRangeEditSchema,
	hashlineAppendEditSchema,
	hashlinePrependEditSchema,
	hashlineInsertEditSchema,
	...(HL_REPLACE_ENABLED ? [hashlineReplaceTextEditSchema] : []),
]);

const hashlineEditSchema = Type.Object(
	{
		path: Type.String({ description: "File path (relative or absolute)" }),
		edits: Type.Array(hashlineEditSpecSchema, {
			description: "Changes to apply to the file at `path`",
			minItems: 0,
		}),
		delete: Type.Optional(Type.Boolean({ description: "Delete the file when true" })),
		rename: Type.Optional(Type.String({ description: "New path if moving" })),
	},
	{ additionalProperties: false },
);

export type HashlineToolEdit = Static<typeof hashlineEditSpecSchema>;
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
				return renderPromptTemplate(hashlineDescription, { allowReplaceText: HL_REPLACE_ENABLED });
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
			const { path, edits, delete: deleteFile, rename } = params as HashlineParams;

			enforcePlanModeWrite(this.session, path, { op: deleteFile ? "delete" : "update", rename });

			if (path.endsWith(".ipynb") && edits?.length > 0) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}

			const absolutePath = resolvePlanPath(this.session, path);
			const resolvedRename = rename ? resolvePlanPath(this.session, rename) : undefined;
			const file = Bun.file(absolutePath);

			if (deleteFile) {
				if (await file.exists()) {
					await file.unlink();
				}
				invalidateFsScanAfterDelete(absolutePath);
				return {
					content: [{ type: "text", text: `Deleted ${path}` }],
					details: {
						diff: "",
						op: "delete",
						meta: outputMeta().get(),
					},
				};
			}

			if (!(await file.exists())) {
				const content: string[] = [];
				for (const edit of edits) {
					switch (edit.op) {
						case "append": {
							if (edit.after) {
								throw new Error(`File not found: ${path}`);
							}
							content.push(...hashlineParseContent(edit.content));
							break;
						}
						case "prepend": {
							if (edit.before) {
								throw new Error(`File not found: ${path}`);
							}
							content.unshift(...hashlineParseContent(edit.content));
							break;
						}
						default: {
							throw new Error(`File not found: ${path}`);
						}
					}
				}
				await file.write(content.join("\n"));
				return {
					content: [{ type: "text", text: `Created ${path}` }],
					details: {
						diff: "",
						op: "create",
						meta: outputMeta().get(),
					},
				};
			}

			const anchorEdits: HashlineEdit[] = [];
			const replaceEdits: ReplaceTextEdit[] = [];
			for (const edit of edits) {
				switch (edit.op) {
					case "set": {
						const { tag, content } = edit;
						anchorEdits.push({ op: "set", tag: parseTag(tag), content: hashlineParseContent(content) });
						break;
					}
					case "replace": {
						const { first, last, content } = edit;
						anchorEdits.push({
							op: "replace",
							first: parseTag(first),
							last: parseTag(last),
							content: hashlineParseContent(content),
						});
						break;
					}
					case "append": {
						const { after, content } = edit;
						anchorEdits.push({
							op: "append",
							...(after ? { after: parseTag(after) } : {}),
							content: hashlineParseContent(content),
						});
						break;
					}
					case "prepend": {
						const { before, content } = edit;
						anchorEdits.push({
							op: "prepend",
							...(before ? { before: parseTag(before) } : {}),
							content: hashlineParseContent(content),
						});
						break;
					}
					case "insert": {
						const { before, after, content } = edit;
						if (before && !after) {
							anchorEdits.push({
								op: "prepend",
								before: parseTag(before),
								content: hashlineParseContent(content),
							});
						} else if (after && !before) {
							anchorEdits.push({
								op: "append",
								after: parseTag(after),
								content: hashlineParseContent(content),
							});
						} else if (before && after) {
							anchorEdits.push({
								op: "insert",
								before: parseTag(before),
								after: parseTag(after),
								content: hashlineParseContent(content),
							});
						} else {
							throw new Error(`Insert must have both before and after tags.`);
						}
						break;
					}
					case "replaceText": {
						const { old_text, new_text, all } = edit;
						replaceEdits.push({
							op: "replaceText",
							old_text: old_text,
							new_text: hashlineParseContentString(new_text),
							all: all ?? false,
						});
						break;
					}
					default:
						throw new Error(`Invalid edit operation: ${JSON.stringify(edit)}`);
				}
			}

			const rawContent = await file.text();
			const { bom, text: content } = stripBom(rawContent);
			const originalEnding = detectLineEnding(content);
			const originalNormalized = normalizeToLF(content);
			let normalizedContent = originalNormalized;

			// Apply anchor-based edits first (set, set_range, insert)
			const anchorResult = applyHashlineEdits(normalizedContent, anchorEdits);
			normalizedContent = anchorResult.content;

			// Apply content-replace edits (substr-style fuzzy replace)
			for (const r of replaceEdits) {
				if (r.old_text.length === 0) {
					throw new Error("old_text must not be empty.");
				}
				const rep = replaceText(normalizedContent, r.old_text, r.new_text, {
					fuzzy: this.#allowFuzzy,
					all: r.all ?? false,
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
			if (originalNormalized === result.content && !rename) {
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
					const refs: LineTag[] = [];
					for (const edit of anchorEdits) {
						refs.length = 0;
						switch (edit.op) {
							case "set":
								refs.push(edit.tag);
								break;
							case "replace":
								refs.push(edit.first, edit.last);
								break;
							case "append":
								if (edit.after) refs.push(edit.after);
								break;
							case "prepend":
								if (edit.before) refs.push(edit.before);
								break;
							case "insert":
								refs.push(edit.after, edit.before);
								break;
							default:
								break;
						}

						for (const ref of refs) {
							try {
								if (ref.line >= 1 && ref.line <= lines.length) {
									const lineContent = lines[ref.line - 1];
									const hash = computeLineHash(ref.line, lineContent);
									targetLines.push(`${ref.line}#${hash}:${lineContent}`);
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
			const writePath = resolvedRename ?? absolutePath;
			const diagnostics = await this.#writethrough(
				writePath,
				finalContent,
				signal,
				Bun.file(writePath),
				batchRequest,
			);
			if (resolvedRename && resolvedRename !== absolutePath) {
				await file.unlink();
				invalidateFsScanAfterRename(absolutePath, resolvedRename);
			} else {
				invalidateFsScanAfterWrite(absolutePath);
			}
			const diffResult = generateDiffString(originalNormalized, result.content);

			const normative = buildNormativeUpdateInput({
				path,
				...(rename ? { rename } : {}),
				oldContent: rawContent,
				newContent: finalContent,
			});

			const meta = outputMeta()
				.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
				.get();

			const resultText = rename ? `Updated and moved ${path} to ${rename}` : `Updated ${path}`;
			return {
				content: [
					{
						type: "text",
						text: `${resultText}${result.warnings?.length ? `\n\nWarnings:\n${result.warnings.join("\n")}` : ""}`,
					},
				],
				details: {
					diff: diffResult.diff,
					firstChangedLine: result.firstChangedLine ?? diffResult.firstChangedLine,
					diagnostics,
					op: "update",
					rename,
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
			if (resolvedRename) {
				invalidateFsScanAfterRename(resolvedPath, resolvedRename);
			} else if (result.change.type === "delete") {
				invalidateFsScanAfterDelete(resolvedPath);
			} else {
				invalidateFsScanAfterWrite(resolvedPath);
			}
			const effRename = result.change.newPath ? rename : undefined;

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
		invalidateFsScanAfterWrite(absolutePath);
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
