import { Type } from "@sinclair/typebox";
import type { CommitAgentState, GitOverviewSnapshot } from "$c/commit/agentic/state";
import { extractScopeCandidates } from "$c/commit/analysis/scope";
import type { ControlledGit } from "$c/commit/git";
import type { CustomTool } from "$c/extensibility/custom-tools/types";

const gitOverviewSchema = Type.Object({
	staged: Type.Optional(Type.Boolean({ description: "Use staged changes (default: true)" })),
	include_untracked: Type.Optional(Type.Boolean({ description: "Include untracked files when staged=false" })),
});

export function createGitOverviewTool(
	git: ControlledGit,
	state: CommitAgentState,
): CustomTool<typeof gitOverviewSchema> {
	return {
		name: "git_overview",
		label: "Git Overview",
		description: "Return staged files, diff stat summary, and numstat entries.",
		parameters: gitOverviewSchema,
		async execute(_toolCallId, params) {
			const staged = params.staged ?? true;
			const files = staged ? await git.getStagedFiles() : await git.getChangedFiles(false);
			const stat = await git.getStat(staged);
			const numstat = await git.getNumstat(staged);
			const scopeResult = extractScopeCandidates(numstat);
			const untrackedFiles = !staged && params.include_untracked ? await git.getUntrackedFiles() : undefined;
			const snapshot: GitOverviewSnapshot = {
				files,
				stat,
				numstat,
				scopeCandidates: scopeResult.scopeCandidates,
				isWideScope: scopeResult.isWide,
				untrackedFiles,
			};
			state.overview = snapshot;
			return {
				content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
				details: snapshot,
			};
		},
	};
}
