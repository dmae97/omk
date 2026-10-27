import { existsSync } from "fs";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { type AgentTool, ToolTerminalError } from "omk-agent-core";
import { dirname } from "path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	EditDiagnosticsRun,
	ensureEditDiagnosticsSession,
	isEditDiagnosticsEnabled,
	isEditDiagnosticsReported,
	type NewDiagnosticsDetails,
} from "./edit-diagnostics.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { assertWorkspaceWrite } from "./workspace-write-guard.ts";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/** Only present when OMK_EDIT_DIAGNOSTICS=1 (spec 107); `undefined` otherwise, as before. */
export interface WriteToolDetails {
	newDiagnostics: NewDiagnosticsDetails;
}

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
	canWritePath?: (absolutePath: string) => boolean;
	/**
	 * Directories the tool may write into. When set, a path that resolves outside
	 * all of them (after `..` and symlinks) is refused. Unset keeps the old
	 * unrestricted behaviour for SDK callers; agent sessions always set it.
	 */
	workspaceRoots?: readonly string[];
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails | undefined> {
	ensureEditDiagnosticsSession();
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			assertWorkspaceWrite(options?.workspaceRoots, "Write", path, absolutePath);
			if (options?.canWritePath && !options.canWritePath(absolutePath)) {
				throw new Error(`Write blocked by active loadout policy: ${path}`);
			}
			const dir = dirname(absolutePath);
			const diag =
				// Custom operations (e.g. SSH) edit a remote file; the checker only sees local paths.
				options?.operations === undefined && isEditDiagnosticsEnabled() && EditDiagnosticsRun.applies(path)
					? new EditDiagnosticsRun("write", cwd, path, absolutePath, signal)
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
				// Create parent directories if needed.
				await ops.mkdir(dir);
				throwIfAborted();

				if (diag) {
					await diag.baseline(existsSync(absolutePath));
					throwIfAborted();
				}

				// Write the file contents.
				await ops.writeFile(absolutePath, content);
				throwIfAborted();
				await diag?.afterWrite();

				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}`,
						},
					],
					details: undefined,
				};
			});
			if (!diag) return result;
			// Post-check runs outside the mutation queue (spec 107 Q6).
			const report = await diag.report();
			if (signal?.aborted) throw new ToolTerminalError("aborted", "Operation aborted");
			// Shadow: results went to the run log only; the model sees exactly the OFF result.
			if (!isEditDiagnosticsReported()) return result;
			const text = report.text ? `${result.content[0].text}\n${report.text}` : result.content[0].text;
			return { content: [{ type: "text" as const, text }], details: { newDiagnostics: report.details } };
		},
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}
