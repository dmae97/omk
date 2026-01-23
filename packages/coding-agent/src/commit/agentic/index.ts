import { createInterface } from "node:readline/promises";
import { runCommitAgentSession } from "$c/commit/agentic/agent";
import { generateFallbackProposal } from "$c/commit/agentic/fallback";
import splitConfirmPrompt from "$c/commit/agentic/prompts/split-confirm.md" with { type: "text" };
import { detectTrivialChange } from "$c/commit/agentic/trivial";
import type { CommitAgentState, CommitProposal, HunkSelector, SplitCommitPlan } from "$c/commit/agentic/state";
import { computeDependencyOrder } from "$c/commit/agentic/topo-sort";
import { applyChangelogProposals } from "$c/commit/changelog";
import { detectChangelogBoundaries } from "$c/commit/changelog/detect";
import { ControlledGit } from "$c/commit/git";
import { parseFileDiffs } from "$c/commit/git/diff";
import { runMapPhase } from "$c/commit/map-reduce/map-phase";
import { shouldUseMapReduce } from "$c/commit/map-reduce";
import { formatCommitMessage } from "$c/commit/message";
import { resolvePrimaryModel, resolveSmolModel } from "$c/commit/model-selection";
import type { CommitCommandArgs, ConventionalAnalysis, FileObservation } from "$c/commit/types";
import { isExcludedFile } from "$c/commit/utils/exclusions";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { SettingsManager } from "$c/config/settings-manager";
import { discoverAuthStorage, discoverContextFiles, discoverModels } from "$c/sdk";

interface CommitExecutionContext {
	git: ControlledGit;
	dryRun: boolean;
	push: boolean;
}

export async function runAgenticCommit(args: CommitCommandArgs): Promise<void> {
	const cwd = process.cwd();
	const settingsManager = await SettingsManager.create(cwd);
	const authStorage = await discoverAuthStorage();
	const modelRegistry = await discoverModels(authStorage);

	writeStdout("● Resolving model...");
	const { model: primaryModel, apiKey: primaryApiKey } = await resolvePrimaryModel(
		args.model,
		settingsManager,
		modelRegistry,
	);
	writeStdout(`  └─ ${primaryModel.name}`);

	const { model: agentModel } = await resolveSmolModel(settingsManager, modelRegistry, primaryModel, primaryApiKey);

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
		writeStdout("● Detecting changelog targets...");
	}
	const changelogBoundaries = args.noChangelog ? [] : await detectChangelogBoundaries(cwd, stagedFiles);
	const changelogTargets = changelogBoundaries.map((boundary) => boundary.changelogPath);
	if (!args.noChangelog) {
		if (changelogTargets.length > 0) {
			for (const path of changelogTargets) {
				writeStdout(`  └─ ${path}`);
			}
		} else {
			writeStdout("  └─ (none found)");
		}
	}

	writeStdout("● Discovering context files...");
	const contextFiles = await discoverContextFiles(cwd);
	const agentsMdFiles = contextFiles.filter((file) => file.path.endsWith("AGENTS.md"));
	if (agentsMdFiles.length > 0) {
		for (const file of agentsMdFiles) {
			writeStdout(`  └─ ${file.path}`);
		}
	} else {
		writeStdout("  └─ (none found)");
	}

	const numstat = await git.getNumstat(true);
	const diff = await git.getDiff(true);

	const trivialChange = detectTrivialChange(diff);
	if (trivialChange) {
		writeStdout(`● Detected trivial change: ${trivialChange.summary}`);
		const trivialProposal: CommitProposal = {
			analysis: {
				type: trivialChange.type,
				scope: null,
				details: [],
				issueRefs: [],
			},
			summary: trivialChange.summary,
			warnings: [],
		};
		await runSingleCommit(trivialProposal, { git, dryRun: args.dryRun, push: args.push });
		return;
	}

	let preComputedObservations: FileObservation[] | undefined;
	if (shouldUseMapReduce(diff, { minFiles: 4, maxFileTokens: 50_000 })) {
		writeStdout("● Running parallel file analysis...");
		const fileDiffs = parseFileDiffs(diff).filter((f) => !isExcludedFile(f.filename));
		const { model: smolModel, apiKey: smolApiKey } = await resolveSmolModel(
			settingsManager,
			modelRegistry,
			primaryModel,
			primaryApiKey,
		);
		preComputedObservations = await runMapPhase({
			model: smolModel,
			apiKey: smolApiKey,
			files: fileDiffs,
		});
		writeStdout(`  └─ Analyzed ${preComputedObservations.length} files`);
	}

	writeStdout("● Starting commit agent...");
	let commitState: CommitAgentState;
	let usedFallback = false;

	try {
		commitState = await runCommitAgentSession({
			cwd,
			git,
			model: agentModel,
			settingsManager,
			modelRegistry,
			authStorage,
			userContext: args.context,
			contextFiles,
			changelogTargets,
			requireChangelog: !args.noChangelog && changelogTargets.length > 0,
			preComputedObservations,
		});
	} catch (error) {
		writeStderr(`Agent error: ${error instanceof Error ? error.message : String(error)}`);
		writeStdout("● Using fallback commit generation...");
		commitState = { proposal: generateFallbackProposal(numstat) };
		usedFallback = true;
	}

	if (!usedFallback && !commitState.proposal && !commitState.splitProposal) {
		if (process.env.OMP_COMMIT_NO_FALLBACK?.toLowerCase() !== "true") {
			writeStdout("● Agent did not provide proposal, using fallback...");
			commitState.proposal = generateFallbackProposal(numstat);
			usedFallback = true;
		}
	}

	if (!args.noChangelog && changelogTargets.length > 0 && !usedFallback) {
		if (!commitState.changelogProposal) {
			writeStderr("Commit agent did not provide changelog entries.");
			return;
		}
		writeStdout("● Applying changelog entries...");
		const updated = await applyChangelogProposals({
			git,
			cwd,
			proposals: commitState.changelogProposal.entries,
			dryRun: args.dryRun,
			onProgress: (message) => {
				writeStdout(`  ├─ ${message}`);
			},
		});
		if (updated.length > 0) {
			for (const path of updated) {
				writeStdout(`  └─ ${path}`);
			}
		} else {
			writeStdout("  └─ (no changes)");
		}
	}

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
	const plannedFiles = new Set(plan.commits.flatMap((commit) => commit.changes.map((change) => change.path)));
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
			const changeSummary = commit.changes
				.map((change) => formatFileChangeSummary(change.path, change.hunks))
				.join(", ");
			writeStdout(`Changes: ${changeSummary}\n`);
		}
		return;
	}

	if (!(await confirmSplitCommitPlan(plan))) {
		writeStdout("Split commit aborted by user.");
		return;
	}

	const order = computeDependencyOrder(plan.commits);
	if ("error" in order) {
		throw new Error(order.error);
	}

	await ctx.git.resetStaging();
	for (const commitIndex of order) {
		const commit = plan.commits[commitIndex];
		await ctx.git.stageHunks(commit.changes);
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

function formatFileChangeSummary(path: string, hunks: HunkSelector): string {
	if (hunks.type === "all") {
		return `${path} (all)`;
	}
	if (hunks.type === "indices") {
		return `${path} (hunks ${hunks.indices.join(", ")})`;
	}
	return `${path} (lines ${hunks.start}-${hunks.end})`;
}
