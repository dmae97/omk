import { Type } from "@sinclair/typebox";
import type { CommitAgentState, GitOverviewSnapshot } from "$c/commit/agentic/state";
import { extractScopeCandidates } from "$c/commit/analysis/scope";
import type { ControlledGit } from "$c/commit/git";
import type { CustomTool } from "$c/extensibility/custom-tools/types";

const EXCLUDED_LOCK_FILES = new Set([
	"Cargo.lock",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"bun.lockb",
	"go.sum",
	"poetry.lock",
	"Pipfile.lock",
	"uv.lock",
	"composer.lock",
	"Gemfile.lock",
	"flake.lock",
	"pubspec.lock",
	"Podfile.lock",
	"mix.lock",
	"gradle.lockfile",
]);

function isExcludedFile(path: string): boolean {
	const basename = path.split("/").pop() ?? path;
	return EXCLUDED_LOCK_FILES.has(basename);
}

function filterExcludedFiles(files: string[]): { filtered: string[]; excluded: string[] } {
	const filtered: string[] = [];
	const excluded: string[] = [];
	for (const file of files) {
		if (isExcludedFile(file)) {
			excluded.push(file);
		} else {
			filtered.push(file);
		}
	}
	return { filtered, excluded };
}

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
			const allFiles = staged ? await git.getStagedFiles() : await git.getChangedFiles(false);
			const { filtered: files, excluded } = filterExcludedFiles(allFiles);
			const stat = await git.getStat(staged);
			const allNumstat = await git.getNumstat(staged);
			const numstat = allNumstat.filter((entry) => !isExcludedFile(entry.path));
			const scopeResult = extractScopeCandidates(numstat);
			const untrackedFiles = !staged && params.include_untracked ? await git.getUntrackedFiles() : undefined;
			const snapshot: GitOverviewSnapshot = {
				files,
				stat,
				numstat,
				scopeCandidates: scopeResult.scopeCandidates,
				isWideScope: scopeResult.isWide,
				untrackedFiles,
				excludedFiles: excluded.length > 0 ? excluded : undefined,
			};
			state.overview = snapshot;
			return {
				content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
				details: snapshot,
			};
		},
	};
}
