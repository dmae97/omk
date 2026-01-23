import { Type } from "@sinclair/typebox";
import type { ControlledGit } from "$c/commit/git";
import type { CustomTool } from "$c/extensibility/custom-tools/types";

const gitFileDiffSchema = Type.Object({
	files: Type.Array(Type.String({ description: "Files to diff" }), { minItems: 1, maxItems: 10 }),
	staged: Type.Optional(Type.Boolean({ description: "Use staged changes (default: true)" })),
});

export function createGitFileDiffTool(git: ControlledGit): CustomTool<typeof gitFileDiffSchema> {
	return {
		name: "git_file_diff",
		label: "Git File Diff",
		description: "Return the diff for specific files.",
		parameters: gitFileDiffSchema,
		async execute(_toolCallId, params) {
			const staged = params.staged ?? true;
			const diff = await git.getDiffForFiles(params.files, staged);
			return {
				content: [{ type: "text", text: diff || "(no diff)" }],
				details: {
					files: params.files,
					staged,
					diff,
				},
			};
		},
	};
}
