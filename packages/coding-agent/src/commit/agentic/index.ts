import { createInterface } from "node:readline/promises";
import { runCommitAgentSession } from "$c/commit/agentic/agent";
import splitConfirmPrompt from "$c/commit/agentic/prompts/split-confirm.md" with { type: "text" };
import type { CommitProposal, SplitCommitPlan } from "$c/commit/agentic/state";
import { runChangelogFlow } from "$c/commit/changelog";
import { ControlledGit } from "$c/commit/git";
import { formatCommitMessage } from "$c/commit/message";
import { resolvePrimaryModel } from "$c/commit/model-selection";
import type { CommitCommandArgs, ConventionalAnalysis } from "$c/commit/types";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { SettingsManager } from "$c/config/settings-manager";
import { discoverAuthStorage, discoverModels } from "$c/sdk";

interface CommitExecutionContext {
	git: ControlledGit;
	dryRun: boolean;
	push: boolean;
}

export async function runAgenticCommit(args: CommitCommandArgs): Promise<void> {
	const cwd = process.cwd();
	const settingsManager = await SettingsManager.create(cwd);
	const commitSettings = settingsManager.getCommitSettings();
	const authStorage = await discoverAuthStorage();
	const modelRegistry = await discoverModels(authStorage);

	const { model: primaryModel, apiKey: primaryApiKey } = await resolvePrimaryModel(
		args.model,
		settingsManager,
		modelRegistry,
	);

	const git = new ControlledGit(cwd);
	let stagedFiles = await git.getStagedFiles();
	if (stagedFiles.length === 0) {
		writeStdout("No staged changes detected, staging all changes...");
		await git.stageAll();
		stagedFiles = await git.getStagedFiles();
	}
	if (stagedFiles.length === 0) {
		writeStderr("No changes to commit.");
		return;
	}

	if (!args.noChangelog) {
		await runChangelogFlow({
			git,
			cwd,
			model: primaryModel,
			apiKey: primaryApiKey,
			stagedFiles,
			dryRun: args.dryRun,
			maxDiffChars: commitSettings.changelogMaxDiffChars,
		});
	}

	const commitState = await runCommitAgentSession({
		cwd,
		git,
		model: primaryModel,
		settingsManager,
		modelRegistry,
		authStorage,
		userContext: args.context,
	});

	if (commitState.proposal) {
		await runSingleCommit(commitState.proposal, { git, dryRun: args.dryRun, push: args.push });
		return;
	}

	if (commitState.splitProposal) {
		await runSplitCommit(commitState.splitProposal, { git, dryRun: args.dryRun, push: args.push });
		return;
	}

	writeStderr("Commit agent did not provide a proposal.");
}

async function runSingleCommit(proposal: CommitProposal, ctx: CommitExecutionContext): Promise<void> {
	if (proposal.warnings.length > 0) {
		writeStdout(formatWarnings(proposal.warnings));
	}
	const commitMessage = formatCommitMessage(proposal.analysis, proposal.summary);
	if (ctx.dryRun) {
		writeStdout("\nGenerated commit message:\n");
		writeStdout(commitMessage);
		return;
	}
	await ctx.git.commit(commitMessage);
	writeStdout("Commit created.");
	if (ctx.push) {
		await ctx.git.push();
		writeStdout("Pushed to remote.");
	}
}

async function runSplitCommit(plan: SplitCommitPlan, ctx: CommitExecutionContext): Promise<void> {
	if (plan.warnings.length > 0) {
		writeStdout(formatWarnings(plan.warnings));
	}
	const stagedFiles = await ctx.git.getStagedFiles();
	const plannedFiles = new Set(plan.commits.flatMap((commit) => commit.files));
	const missingFiles = stagedFiles.filter((file) => !plannedFiles.has(file));
	if (missingFiles.length > 0) {
		writeStderr(`Split commit plan missing staged files: ${missingFiles.join(", ")}`);
		return;
	}

	if (ctx.dryRun) {
		writeStdout("\nSplit commit plan (dry run):\n");
		for (const [index, commit] of plan.commits.entries()) {
			const analysis: ConventionalAnalysis = {
				type: commit.type,
				scope: commit.scope,
				details: commit.details,
				issueRefs: commit.issueRefs,
			};
			const message = formatCommitMessage(analysis, commit.summary);
			writeStdout(`Commit ${index + 1}:\n${message}\n`);
			writeStdout(`Files: ${commit.files.join(", ")}\n`);
		}
		return;
	}

	if (!(await confirmSplitCommitPlan(plan))) {
		writeStdout("Split commit aborted by user.");
		return;
	}

	await ctx.git.resetStaging();
	for (const commit of plan.commits) {
		await ctx.git.stageFiles(commit.files);
		const analysis: ConventionalAnalysis = {
			type: commit.type,
			scope: commit.scope,
			details: commit.details,
			issueRefs: commit.issueRefs,
		};
		const message = formatCommitMessage(analysis, commit.summary);
		await ctx.git.commit(message);
		await ctx.git.resetStaging();
	}
	writeStdout("Split commits created.");
	if (ctx.push) {
		await ctx.git.push();
		writeStdout("Pushed to remote.");
	}
}

async function confirmSplitCommitPlan(plan: SplitCommitPlan): Promise<boolean> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return true;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const prompt = renderPromptTemplate(splitConfirmPrompt, { count: plan.commits.length });
		const answer = await rl.question(prompt);
		return ["y", "yes"].includes(answer.trim().toLowerCase());
	} finally {
		rl.close();
	}
}

function formatWarnings(warnings: string[]): string {
	return `Warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`;
}

function writeStdout(message: string): void {
	process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}
