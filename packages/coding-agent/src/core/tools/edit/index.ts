/**
 * Edit tool module.
 *
 * Supports two modes:
 * - Replace mode (default): oldText/newText replacement with fuzzy matching
 * - Patch mode: structured diff format with explicit operation type
 *
 * The mode is determined by the `edit.patchMode` setting.
 */

import { mkdirSync, unlinkSync } from "node:fs";
import type { AgentTool, AgentToolContext } from "@oh-my-pi/pi-agent-core";
import { Type } from "@sinclair/typebox";
import applyPatchDescription from "../../../prompts/tools/apply-patch.md" with { type: "text" };
import editDescription from "../../../prompts/tools/edit.md" with { type: "text" };
import { renderPromptTemplate } from "../../prompt-templates";
import type { ToolSession } from "../index";
import { createLspWritethrough, type FileDiagnosticsResult, writethroughNoop } from "../lsp/index";
import { resolveToCwd } from "../path-utils";
import { applyPatch, type FileSystem, type Operation, type PatchInput } from "./apply-patch";
import {
	adjustNewTextIndentation,
	DEFAULT_FUZZY_THRESHOLD,
	detectLineEnding,
	EditMatchError,
	findEditMatch,
	generateDiffString,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./diff";
import { type EditToolDetails, getLspBatchRequest } from "./shared";

// Re-export apply-patch types and functions
export {
	ApplyPatchError,
	type ApplyPatchOptions,
	type ApplyPatchResult,
	applyPatch,
	defaultFileSystem,
	type FileChange,
	type FileSystem,
	type Operation,
	ParseError,
	type PatchInput,
	parseDiffHunks,
	previewPatch,
	type UpdateChunk,
	type UpdateFileChunk,
} from "./apply-patch";

// Re-export diff utilities
export {
	adjustNewTextIndentation,
	computeEditDiff,
	DEFAULT_FUZZY_THRESHOLD,
	detectLineEnding,
	type EditDiffError,
	type EditDiffResult,
	type EditMatch,
	EditMatchError,
	type EditMatchOutcome,
	findEditMatch,
	generateDiffString,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./diff";
export { type SeekSequenceResult, seekSequence } from "./seek-sequence";
// Re-export shared utilities (renderer, LSP batching, types)
export { type EditRenderContext, type EditToolDetails, editToolRenderer, getLspBatchRequest } from "./shared";

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

function createLspFileSystem(
	writethrough: (
		dst: string,
		content: string,
		signal?: AbortSignal,
		file?: import("bun").BunFile,
		batch?: { id: string; flush: boolean },
	) => Promise<FileDiagnosticsResult | undefined>,
	signal?: AbortSignal,
	batchRequest?: { id: string; flush: boolean },
): FileSystem & { getDiagnostics: () => FileDiagnosticsResult | undefined } {
	let lastDiagnostics: FileDiagnosticsResult | undefined;

	return {
		async exists(path: string): Promise<boolean> {
			return Bun.file(path).exists();
		},
		async read(path: string): Promise<string> {
			return Bun.file(path).text();
		},
		async write(path: string, content: string): Promise<void> {
			const file = Bun.file(path);
			const result = await writethrough(path, content, signal, file, batchRequest);
			if (result) {
				lastDiagnostics = result;
			}
		},
		async delete(path: string): Promise<void> {
			unlinkSync(path);
		},
		async mkdir(path: string): Promise<void> {
			mkdirSync(path, { recursive: true });
		},
		getDiagnostics(): FileDiagnosticsResult | undefined {
			return lastDiagnostics;
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the edit tool based on settings.
 * Returns replace-mode or patch-mode tool depending on edit.patchMode setting.
 */
export function createEditTool(
	session: ToolSession,
): AgentTool<typeof replaceEditSchema | typeof patchEditSchema, EditToolDetails> {
	const patchMode = session.settings?.getEditPatchMode?.() ?? false;
	const allowFuzzy = session.settings?.getEditFuzzyMatch() ?? true;
	const enableLsp = session.enableLsp ?? true;
	const enableDiagnostics = enableLsp ? (session.settings?.getLspDiagnosticsOnEdit() ?? false) : false;
	const enableFormat = enableLsp ? (session.settings?.getLspFormatOnWrite() ?? true) : false;
	const writethrough = enableLsp
		? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics })
		: writethroughNoop;

	return {
		name: "edit",
		label: "Edit",
		description: patchMode ? renderPromptTemplate(applyPatchDescription) : renderPromptTemplate(editDescription),
		parameters: patchMode ? patchEditSchema : replaceEditSchema,
		execute: async (
			_toolCallId: string,
			params: ReplaceParams | PatchParams,
			signal?: AbortSignal,
			_onUpdate?: unknown,
			context?: AgentToolContext,
		) => {
			const batchRequest = getLspBatchRequest(context?.toolCall);

			// Patch mode execution
			if ("operation" in params) {
				const { path, operation, moveTo, diff } = params as PatchParams;

				if (path.endsWith(".ipynb")) {
					throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
				}

				const input: PatchInput = { path, operation, moveTo, diff };
				const fs = createLspFileSystem(writethrough, signal, batchRequest);
				const result = await applyPatch(input, { cwd: session.cwd, fs });

				// Generate diff for display
				let diffResult = { diff: "", firstChangedLine: undefined as number | undefined };
				if (result.change.type === "update" && result.change.oldContent && result.change.newContent) {
					diffResult = generateDiffString(result.change.oldContent, result.change.newContent);
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
						resultText = moveTo ? `Updated and moved ${path} to ${moveTo}` : `Updated ${path}`;
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
						moveTo,
					},
				};
			}

			// Replace mode execution
			const { path, oldText, newText, all } = params as ReplaceParams;

			if (path.endsWith(".ipynb")) {
				throw new Error("Cannot edit Jupyter notebooks with the Edit tool. Use the NotebookEdit tool instead.");
			}

			const absolutePath = resolveToCwd(path, session.cwd);
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

			let normalizedNewContent: string;
			let replacementCount = 0;

			if (all) {
				normalizedNewContent = normalizedContent;
				const exactCount = normalizedContent.split(normalizedOldText).length - 1;
				if (exactCount > 0) {
					normalizedNewContent = normalizedContent.split(normalizedOldText).join(normalizedNewText);
					replacementCount = exactCount;
				} else {
					while (true) {
						const matchOutcome = findEditMatch(normalizedNewContent, normalizedOldText, {
							allowFuzzy,
							similarityThreshold: DEFAULT_FUZZY_THRESHOLD,
						});
						const match =
							matchOutcome.match ||
							(allowFuzzy && matchOutcome.closest && matchOutcome.closest.confidence >= DEFAULT_FUZZY_THRESHOLD
								? matchOutcome.closest
								: undefined);
						if (!match) {
							if (replacementCount === 0) {
								throw new EditMatchError(path, normalizedOldText, matchOutcome.closest, {
									allowFuzzy,
									similarityThreshold: DEFAULT_FUZZY_THRESHOLD,
									fuzzyMatches: matchOutcome.fuzzyMatches,
								});
							}
							break;
						}
						// Adjust newText indentation for each match (may vary across file)
						const adjustedNewText = adjustNewTextIndentation(
							normalizedOldText,
							match.actualText,
							normalizedNewText,
						);
						normalizedNewContent =
							normalizedNewContent.substring(0, match.startIndex) +
							adjustedNewText +
							normalizedNewContent.substring(match.startIndex + match.actualText.length);
						replacementCount++;
					}
				}
			} else {
				const matchOutcome = findEditMatch(normalizedContent, normalizedOldText, {
					allowFuzzy,
					similarityThreshold: DEFAULT_FUZZY_THRESHOLD,
				});
				if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
					throw new Error(
						`Found ${matchOutcome.occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique, or use all: true to replace all.`,
					);
				}
				if (!matchOutcome.match) {
					throw new EditMatchError(path, normalizedOldText, matchOutcome.closest, {
						allowFuzzy,
						similarityThreshold: DEFAULT_FUZZY_THRESHOLD,
						fuzzyMatches: matchOutcome.fuzzyMatches,
					});
				}
				const match = matchOutcome.match;
				// Adjust newText indentation if fuzzy match found text at different indent level
				const adjustedNewText = adjustNewTextIndentation(normalizedOldText, match.actualText, normalizedNewText);
				normalizedNewContent =
					normalizedContent.substring(0, match.startIndex) +
					adjustedNewText +
					normalizedContent.substring(match.startIndex + match.actualText.length);
				replacementCount = 1;
			}

			if (normalizedContent === normalizedNewContent) {
				throw new Error(
					`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
				);
			}

			const finalContent = bom + restoreLineEndings(normalizedNewContent, originalEnding);
			const diagnostics = await writethrough(absolutePath, finalContent, signal, file, batchRequest);
			const diffResult = generateDiffString(normalizedContent, normalizedNewContent);

			let resultText =
				replacementCount > 1
					? `Successfully replaced ${replacementCount} occurrences in ${path}.`
					: `Successfully replaced text in ${path}.`;

			if (diagnostics?.messages?.length) {
				resultText += `\n\nLSP Diagnostics (${diagnostics.summary}):\n`;
				resultText += diagnostics.messages.map((d) => `  ${d}`).join("\n");
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine, diagnostics },
			};
		},
	};
}
