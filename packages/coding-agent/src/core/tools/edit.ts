import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { type AgentTool, ToolTerminalError } from "omk-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	EditDiagnosticsRun,
	ensureEditDiagnosticsSession,
	isEditDiagnosticsEnabled,
	isEditDiagnosticsReported,
	type NewDiagnosticsDetails,
} from "./edit-diagnostics.ts";
import {
	applyEditsToNormalizedContent,
	detectLineEnding,
	type Edit,
	generateDiffString,
	generateUnifiedPatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./edit-diff.ts";
import { editMatchObserver } from "./edit-match-observe.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { assertWorkspaceWrite } from "./workspace-write-guard.ts";

type EditRenderState = {
	callComponent?: unknown;
};

const replaceEditSchema = Type.Object(
	{
		oldText: Type.String({
			description:
				"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted edit." }),
	},
	{ additionalProperties: false },
);

const editSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(replaceEditSchema, {
			description:
				"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
		}),
	},
	{ additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & {
	oldText?: unknown;
	newText?: unknown;
};

export interface EditToolDetails {
	/** Display-oriented diff of the changes made */
	diff: string;
	/** Standard unified patch of the changes made */
	patch: string;
	/** Line number of the first change in the new file (for editor navigation) */
	firstChangedLine?: number;
	/** Spec 107, only when OMK_EDIT_DIAGNOSTICS=1 and the file has a checker. */
	newDiagnostics?: NewDiagnosticsDetails;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (for example SSH).
 */
export interface EditOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Check if file is readable and writable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
	/** Custom operations for file editing. Default: local filesystem */
	operations?: EditOperations;
	canWritePath?: (absolutePath: string) => boolean;
	workspaceRoots?: readonly string[];
}

function prepareEditArguments(input: unknown): EditToolInput {
	if (!input || typeof input !== "object") {
		return input as EditToolInput;
	}

	const args = input as Record<string, unknown>;

	// Some models (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array
	if (typeof args.edits === "string") {
		try {
			const parsed = JSON.parse(args.edits);
			if (Array.isArray(parsed)) args.edits = parsed;
		} catch {}
	}

	const legacy = args as LegacyEditToolInput;
	if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
		return args as EditToolInput;
	}

	const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
	edits.push({ oldText: legacy.oldText, newText: legacy.newText });
	const { oldText: _oldText, newText: _newText, ...rest } = legacy;
	return { ...rest, edits } as EditToolInput;
}

function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
	if (!Array.isArray(input.edits) || input.edits.length === 0) {
		throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
	}
	return { path: input.path, edits: input.edits };
}

export function createEditToolDefinition(
	cwd: string,
	options?: EditToolOptions,
): ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState> {
	ensureEditDiagnosticsSession();
	const ops = options?.operations ?? defaultEditOperations;
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		promptSnippet:
			"Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
		promptGuidelines: [
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
		],
		parameters: editSchema,
		prepareArguments: prepareEditArguments,
		async execute(_toolCallId, input: EditToolInput, signal?: AbortSignal, _onUpdate?, ctx?) {
			const { path, edits } = validateEditInput(input);
			const absolutePath = resolveToCwd(path, cwd);
			assertWorkspaceWrite(options?.workspaceRoots, "Edit", path, absolutePath);
			if (options?.canWritePath && !options.canWritePath(absolutePath)) {
				throw new Error(`Edit blocked by active loadout policy: ${path}`);
			}

			const diag =
				// Custom operations (e.g. SSH) edit a remote file; the checker only sees local paths.
				options?.operations === undefined && isEditDiagnosticsEnabled() && EditDiagnosticsRun.applies(path)
					? new EditDiagnosticsRun("edit", cwd, path, absolutePath, signal)
					: undefined;
			const result = await withFileMutationQueue(absolutePath, async () => {
				// Do not reject from an abort event listener here: that would release the
				// mutation queue while an in-flight filesystem operation may still finish.
				// Checking signal.aborted after each await observes the same aborts while
				// keeping the queue locked until the current operation has settled.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new ToolTerminalError("aborted", "Operation aborted");
				};

				throwIfAborted();

				// Check if file exists.
				try {
					await ops.access(absolutePath);
				} catch (error: unknown) {
					throwIfAborted();
					const errorMessage =
						error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
					throw new Error(`Could not edit file: ${path}. ${errorMessage}.`);
				}
				throwIfAborted();

				// Read the file.
				const buffer = await ops.readFile(absolutePath);
				const rawContent = buffer.toString("utf-8");
				throwIfAborted();

				// Strip BOM before matching. The model will not include an invisible BOM in oldText.
				const { bom, text: content } = stripBom(rawContent);
				const originalEnding = detectLineEnding(content);
				const normalizedContent = normalizeToLF(content);
				let applied: ReturnType<typeof applyEditsToNormalizedContent>;
				try {
					applied = applyEditsToNormalizedContent(normalizedContent, edits, path);
				} catch (error) {
					// Failure path only: the classifier never runs on a successful edit.
					editMatchObserver.logFailure(absolutePath, normalizedContent, edits, ctx);
					throw error;
				}
				const { baseContent, newContent } = applied;
				throwIfAborted();

				const finalContent = bom + restoreLineEndings(newContent, originalEnding);
				await diag?.baseline();
				throwIfAborted();
				await ops.writeFile(absolutePath, finalContent);
				throwIfAborted();
				await diag?.afterWrite();

				editMatchObserver.logSuccess(absolutePath, normalizedContent, edits, ctx);

				const diffResult = generateDiffString(baseContent, newContent);
				const patch = generateUnifiedPatch(path, baseContent, newContent);
				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
						},
					],
					details: {
						diff: diffResult.diff,
						patch,
						firstChangedLine: diffResult.firstChangedLine,
					} as EditToolDetails,
				};
			});
			if (!diag) return result;
			// Post-check runs outside the mutation queue (spec 107 Q6).
			const report = await diag.report();
			if (signal?.aborted) throw new ToolTerminalError("aborted", "Operation aborted");
			// Shadow: results went to the run log only; the model sees exactly the OFF result.
			if (!isEditDiagnosticsReported()) return result;
			const text = report.text ? `${result.content[0].text}\n${report.text}` : result.content[0].text;
			return {
				content: [{ type: "text" as const, text }],
				details: { ...result.details, newDiagnostics: report.details },
			};
		},
	};
}

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
	return wrapToolDefinition(createEditToolDefinition(cwd, options));
}
