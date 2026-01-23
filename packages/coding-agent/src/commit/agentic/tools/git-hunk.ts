import { Type } from "@sinclair/typebox";
import type { ControlledGit } from "$c/commit/git";
import type { DiffHunk, FileHunks } from "$c/commit/types";
import type { CustomTool } from "$c/extensibility/custom-tools/types";

const gitHunkSchema = Type.Object({
	file: Type.String({ description: "File path" }),
	hunks: Type.Optional(Type.Array(Type.Number({ description: "1-based hunk indices" }), { minItems: 1 })),
	staged: Type.Optional(Type.Boolean({ description: "Use staged changes (default: true)" })),
});

function selectHunks(fileHunks: FileHunks, requested?: number[]): DiffHunk[] {
	if (!requested || requested.length === 0) return fileHunks.hunks;
	const wanted = new Set(requested.map((value) => Math.max(1, Math.floor(value))));
	return fileHunks.hunks.filter((hunk) => wanted.has(hunk.index + 1));
}

export function createGitHunkTool(git: ControlledGit): CustomTool<typeof gitHunkSchema> {
	return {
		name: "git_hunk",
		label: "Git Hunk",
		description: "Return specific hunks from a file diff.",
		parameters: gitHunkSchema,
		async execute(_toolCallId, params) {
			const staged = params.staged ?? true;
			const hunks = await git.getHunks([params.file], staged);
			const fileHunks = hunks.find((entry) => entry.filename === params.file) ?? {
				filename: params.file,
				isBinary: false,
				hunks: [],
			};
			if (fileHunks.isBinary) {
				return {
					content: [{ type: "text", text: "Binary file diff; no hunks available." }],
					details: { file: params.file, staged, hunks: [] },
				};
			}
			const selected = selectHunks(fileHunks, params.hunks);
			const text = selected.length ? selected.map((hunk) => hunk.content).join("\n\n") : "(no matching hunks)";
			return {
				content: [{ type: "text", text }],
				details: {
					file: params.file,
					staged,
					hunks: selected,
				},
			};
		},
	};
}
