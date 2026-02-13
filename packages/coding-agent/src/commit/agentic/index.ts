import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { $env } from "@oh-my-pi/pi-utils";
import { applyChangelogProposals } from "../../commit/changelog";
import { detectChangelogBoundaries } from "../../commit/changelog/detect";
import { parseUnreleasedSection } from "../../commit/changelog/parse";
import { ControlledGit } from "../../commit/git";
import { formatCommitMessage } from "../../commit/message";
import { resolvePrimaryModel, resolveSmolModel } from "../../commit/model-selection";
import type { CommitCommandArgs, ConventionalAnalysis } from "../../commit/types";
import { ModelRegistry } from "../../config/model-registry";
import { renderPromptTemplate } from "../../config/prompt-templates";
import { Settings } from "../../config/settings";
import { discoverAuthStorage, discoverContextFiles } from "../../sdk";
import { type ExistingChangelogEntries, runCommitAgentSession } from "./agent";
import { generateFallbackProposal } from "./fallback";
import splitConfirmPrompt from "./prompts/split-confirm.md" with { type: "text" };
import type { CommitAgentState, CommitProposal, HunkSelector, SplitCommitPlan } from "./state";
import { computeDependencyOrder } from "./topo-sort";
import { detectTrivialChange } from "./trivial";

interface CommitExecutionContext {
	git: ControlledGit;
	dryRun: boolean;
	push: boolean;
}

export async function runAgenticCommit(args: CommitCommandArgs): Promise<void> {
	const cwd = process.cwd();
	const git = new ControlledGit(cwd);
	const [settings, authStorage] = await Promise.all([Settings.init({ cwd }), discoverAuthStorage()]);

	writeStdout("● Resolving model...");
	const modelRegistry = new ModelRegistry(authStorage);
	await modelRegistry.refresh();
	const stagedFilesPromise = (async () => {
		let stagedFiles = await git.getStagedFiles();
		if (stagedFiles.length === 0) {
			writeStdout("No staged changes detected, staging all changes...");
			await git.stageAll();
			stagedFiles = await git.getStagedFiles();
		}
		return stagedFiles;
	})();

	const primaryModelPromise = resolvePrimaryModel(args.model, settings, modelRegistry);
	const [primaryModelResult, stagedFiles] = await Promise.all([primaryModelPromise, stagedFilesPromise]);
	const { model: primaryModel, apiKey: primaryApiKey } = primaryModelResult;
	writeStdout(`  └─ ${primaryModel.name}`);

	const { model: agentModel } = await resolveSmolModel(settings, modelRegistry, primaryModel, primaryApiKey);

	if (stagedFiles.length === 0) {
		writeStderr("No changes to commit.");
		return;
	}

	if (!args.noChangelog) {
		writeStdout("● Detecting changelog targets...");
	}
	const [changelogBoundaries, contextFiles, numstat, diff] = await Promise.all([
		args.noChangelog ? [] : detectChangelogBoundaries(cwd, stagedFiles),
		discoverContextFiles(cwd),
		git.getNumstat(true),
		git.getDiff(true),
	]);
	const changelogTargets = changelogBoundaries.map(boundary => boundary.changelogPath);
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
	const agentsMdFiles = contextFiles.filter(file => file.path.endsWith("AGENTS.md"));
	if (agentsMdFiles.length > 0) {
		for (const file of agentsMdFiles) {
			writeStdout(`  └─ ${file.path}`);
		}
	} else {
		writeStdout("  └─ (none found)");
	}
	const forceFallback = $env.PI_COMMIT_TEST_FALLBACK?.toLowerCase() === "true";
	if (forceFallback) {
		writeStdout("● Forcing fallback commit generation...");
		const fallbackProposal = generateFallbackProposal(numstat);
		await runSingleCommit(fallbackProposal, { git, dryRun: args.dryRun, push: args.push });
		return;
	}

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

	let existingChangelogEntries: ExistingChangelogEntries[] | undefined;
	if (!args.noChangelog && changelogTargets.length > 0) {
		existingChangelogEntries = await loadExistingChangelogEntries(changelogTargets);
		if (existingChangelogEntries.length === 0) {
			existingChangelogEntries = undefined;
		}
	}

	writeStdout("● Starting commit agent...");
	let commitState: CommitAgentState;
	let usedFallback = false;

	try {
		commitState = await runCommitAgentSession({
			cwd,
			git,
			model: agentModel,
			settings,
			modelRegistry,
			authStorage,
			userContext: args.context,
			contextFiles,
			changelogTargets,
			requireChangelog: !args.noChangelog && changelogTargets.length > 0,
			diffText: diff,
			existingChangelogEntries,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		writeStderr(`Agent error: ${errorMessage}`);
		if (error instanceof Error && error.stack && $env.DEBUG) {
			writeStderr(error.stack);
		}
		writeStdout("● Using fallback commit generation...");
		commitState = { proposal: generateFallbackProposal(numstat) };
		usedFallback = true;
	}

	if (!usedFallback && !commitState.proposal && !commitState.splitProposal) {
		if ($env.PI_COMMIT_NO_FALLBACK?.toLowerCase() !== "true") {
			writeStdout("● Agent did not provide proposal, using fallback...");
			commitState.proposal = generateFallbackProposal(numstat);
			usedFallback = true;
		}
	}

	let updatedChangelogFiles: string[] = [];
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
			onProgress: message => {
				writeStdout(`  ├─ ${message}`);
			},
		});
		updatedChangelogFiles = updated.map(filePath => path.relative(cwd, filePath));
		if (updated.length > 0) {
			for (const filePath of updated) {
				writeStdout(`  └─ ${filePath}`);
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
		await runSplitCommit(commitState.splitProposal, {
			git,
			dryRun: args.dryRun,
			push: args.push,
			additionalFiles: updatedChangelogFiles,
		});
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

async function runSplitCommit(
	plan: SplitCommitPlan,
	ctx: CommitExecutionContext & { additionalFiles?: string[] },
): Promise<void> {
	if (plan.warnings.length > 0) {
		writeStdout(formatWarnings(plan.warnings));
	}
	if (ctx.additionalFiles && ctx.additionalFiles.length > 0) {
		appendFilesToLastCommit(plan, ctx.additionalFiles);
	}
	const stagedFiles = await ctx.git.getStagedFiles();
	const plannedFiles = new Set(plan.commits.flatMap(commit => commit.changes.map(change => change.path)));
	const missingFiles = stagedFiles.filter(file => !plannedFiles.has(file));
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
				.map(change => formatFileChangeSummary(change.path, change.hunks))
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

function appendFilesToLastCommit(plan: SplitCommitPlan, files: string[]): void {
	if (plan.commits.length === 0) return;
	const planned = new Set(plan.commits.flatMap(commit => commit.changes.map(change => change.path)));
	const targetCommit = plan.commits[plan.commits.length - 1];
	for (const file of files) {
		if (planned.has(file)) continue;
		targetCommit.changes.push({ path: file, hunks: { type: "all" } });
		planned.add(file);
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
	return `Warnings:\n${warnings.map(warning => `- ${warning}`).join("\n")}`;
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

async function loadExistingChangelogEntries(paths: string[]): Promise<ExistingChangelogEntries[]> {
	const entries = await Promise.all(
		paths.map(async path => {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				return null;
			}
			const content = await file.text();
			try {
				const unreleased = parseUnreleasedSection(content);
				const sections = Object.entries(unreleased.entries)
					.filter(([, items]) => items.length > 0)
					.map(([name, items]) => ({ name, items }));
				if (sections.length > 0) {
					return { path, sections };
				}
			} catch {
				return null;
			}
			return null;
		}),
	);
	return entries.filter((entry): entry is ExistingChangelogEntries => entry !== null);
}
