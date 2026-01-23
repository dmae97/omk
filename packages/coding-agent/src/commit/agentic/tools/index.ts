import type { CommitAgentState } from "@oh-my-pi/pi-coding-agent/commit/agentic/state";
import { createAnalyzeFileTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/analyze-file";
import { createGitFileDiffTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/git-file-diff";
import { createGitHunkTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/git-hunk";
import { createGitOverviewTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/git-overview";
import { createProposeChangelogTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/propose-changelog";
import { createProposeCommitTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/propose-commit";
import { createRecentCommitsTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/recent-commits";
import { createSplitCommitTool } from "@oh-my-pi/pi-coding-agent/commit/agentic/tools/split-commit";
import type { ControlledGit } from "@oh-my-pi/pi-coding-agent/commit/git";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { SettingsManager } from "@oh-my-pi/pi-coding-agent/config/settings-manager";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools/types";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

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
