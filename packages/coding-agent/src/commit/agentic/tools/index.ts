import type { CommitAgentState } from "$c/commit/agentic/state";
import { createAnalyzeFileTool } from "$c/commit/agentic/tools/analyze-file";
import { createGitFileDiffTool } from "$c/commit/agentic/tools/git-file-diff";
import { createGitHunkTool } from "$c/commit/agentic/tools/git-hunk";
import { createGitOverviewTool } from "$c/commit/agentic/tools/git-overview";
import { createProposeChangelogTool } from "$c/commit/agentic/tools/propose-changelog";
import { createProposeCommitTool } from "$c/commit/agentic/tools/propose-commit";
import { createRecentCommitsTool } from "$c/commit/agentic/tools/recent-commits";
import { createSplitCommitTool } from "$c/commit/agentic/tools/split-commit";
import type { ControlledGit } from "$c/commit/git";
import type { ModelRegistry } from "$c/config/model-registry";
import type { SettingsManager } from "$c/config/settings-manager";
import type { CustomTool } from "$c/extensibility/custom-tools/types";
import type { AuthStorage } from "$c/session/auth-storage";

export interface CommitToolOptions {
	cwd: string;
	git: ControlledGit;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	spawns: string;
	state: CommitAgentState;
	changelogTargets: string[];
	enableAnalyzeFiles?: boolean;
}

export function createCommitTools(options: CommitToolOptions): Array<CustomTool<any, any>> {
	const tools: Array<CustomTool<any, any>> = [
		createGitOverviewTool(options.git, options.state),
		createGitFileDiffTool(options.git, options.state),
		createGitHunkTool(options.git),
		createRecentCommitsTool(options.git),
	];

	if (options.enableAnalyzeFiles ?? true) {
		tools.push(
			createAnalyzeFileTool({
				cwd: options.cwd,
				authStorage: options.authStorage,
				modelRegistry: options.modelRegistry,
				settingsManager: options.settingsManager,
				spawns: options.spawns,
				state: options.state,
			}),
		);
	}

	tools.push(
		createProposeChangelogTool(options.state, options.changelogTargets),
		createProposeCommitTool(options.git, options.state),
		createSplitCommitTool(options.git, options.state, options.changelogTargets),
	);

	return tools;
}
