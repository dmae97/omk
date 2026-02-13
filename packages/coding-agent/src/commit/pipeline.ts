import * as path from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../config/model-registry";
import { renderPromptTemplate } from "../config/prompt-templates";
import { Settings } from "../config/settings";
import { discoverAuthStorage } from "../sdk";
import { loadProjectContextFiles } from "../system-prompt";
import { runAgenticCommit } from "./agentic";
import {
	extractScopeCandidates,
	generateConventionalAnalysis,
	generateSummary,
	validateAnalysis,
	validateSummary,
} from "./analysis";
import { runChangelogFlow } from "./changelog";
import { ControlledGit } from "./git";
import { runMapReduceAnalysis, shouldUseMapReduce } from "./map-reduce";
import { formatCommitMessage } from "./message";
import { resolvePrimaryModel, resolveSmolModel } from "./model-selection";
import summaryRetryPrompt from "./prompts/summary-retry.md" with { type: "text" };
import typesDescriptionPrompt from "./prompts/types-description.md" with { type: "text" };
import type { CommitCommandArgs, ConventionalAnalysis } from "./types";

const SUMMARY_MAX_CHARS = 72;
const RECENT_COMMITS_COUNT = 8;
const TYPES_DESCRIPTION = renderPromptTemplate(typesDescriptionPrompt);

/**
 * Execute the omp commit pipeline for staged changes.
 */
export async function runCommitCommand(args: CommitCommandArgs): Promise<void> {
	if (args.legacy) {
		return runLegacyCommitCommand(args);
	}
	return runAgenticCommit(args);
}

async function runLegacyCommitCommand(args: CommitCommandArgs): Promise<void> {
	const cwd = process.cwd();
	const settings = await Settings.init();
	const commitSettings = settings.getGroup("commit");
	const authStorage = await discoverAuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	await modelRegistry.refresh();

	const { model: primaryModel, apiKey: primaryApiKey } = await resolvePrimaryModel(
		args.model,
		settings,
		modelRegistry,
	);
	const { model: smolModel, apiKey: smolApiKey } = await resolveSmolModel(
		settings,
		modelRegistry,
		primaryModel,
		primaryApiKey,
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

	const diff = await git.getDiff(true);
	const stat = await git.getStat(true);
	const numstat = await git.getNumstat(true);
	const scopeCandidates = extractScopeCandidates(numstat).scopeCandidates;
	const recentCommits = await git.getRecentCommits(RECENT_COMMITS_COUNT);
	const contextFiles = await loadProjectContextFiles({ cwd });
	const formattedContextFiles = contextFiles.map(file => ({
		path: path.relative(cwd, file.path),
		content: file.content,
	}));

	const analysis = await generateAnalysis({
		diff,
		stat,
		scopeCandidates,
		recentCommits,
		contextFiles: formattedContextFiles,
		userContext: args.context,
		primaryModel,
		primaryApiKey,
		smolModel,
		smolApiKey,
		commitSettings,
	});

	const analysisValidation = validateAnalysis(analysis);
	if (!analysisValidation.valid) {
		logger.warn("commit analysis validation failed", { errors: analysisValidation.errors });
	}

	const summary = await generateSummaryWithRetry({
		analysis,
		stat,
		model: primaryModel,
		apiKey: primaryApiKey,
		userContext: args.context,
	});

	const commitMessage = formatCommitMessage(analysis, summary.summary);

	if (args.dryRun) {
		writeStdout("\nGenerated commit message:\n");
		writeStdout(commitMessage);
		return;
	}

	await git.commit(commitMessage);
	writeStdout("Commit created.");
	if (args.push) {
		await git.push();
		writeStdout("Pushed to remote.");
	}
}

async function generateAnalysis(input: {
	diff: string;
	stat: string;
	scopeCandidates: string;
	recentCommits: string[];
	contextFiles: Array<{ path: string; content: string }>;
	userContext?: string;
	primaryModel: Model<Api>;
	primaryApiKey: string;
	smolModel: Model<Api>;
	smolApiKey: string;
	commitSettings: {
		mapReduceEnabled: boolean;
		mapReduceMinFiles: number;
		mapReduceMaxFileTokens: number;
		mapReduceTimeoutMs: number;
		mapReduceMaxConcurrency: number;
		changelogMaxDiffChars: number;
	};
}): Promise<ConventionalAnalysis> {
	if (
		shouldUseMapReduce(input.diff, {
			enabled: input.commitSettings.mapReduceEnabled,
			minFiles: input.commitSettings.mapReduceMinFiles,
			maxFileTokens: input.commitSettings.mapReduceMaxFileTokens,
		})
	) {
		writeStdout("Large diff detected, using map-reduce analysis...");
		return runMapReduceAnalysis({
			model: input.primaryModel,
			apiKey: input.primaryApiKey,
			smolModel: input.smolModel,
			smolApiKey: input.smolApiKey,
			diff: input.diff,
			stat: input.stat,
			scopeCandidates: input.scopeCandidates,
			typesDescription: TYPES_DESCRIPTION,
			settings: {
				enabled: input.commitSettings.mapReduceEnabled,
				minFiles: input.commitSettings.mapReduceMinFiles,
				maxFileTokens: input.commitSettings.mapReduceMaxFileTokens,
				maxConcurrency: input.commitSettings.mapReduceMaxConcurrency,
				timeoutMs: input.commitSettings.mapReduceTimeoutMs,
			},
		});
	}

	return generateConventionalAnalysis({
		model: input.primaryModel,
		apiKey: input.primaryApiKey,
		contextFiles: input.contextFiles,
		userContext: input.userContext,
		typesDescription: TYPES_DESCRIPTION,
		recentCommits: input.recentCommits,
		scopeCandidates: input.scopeCandidates,
		stat: input.stat,
		diff: input.diff,
	});
}

async function generateSummaryWithRetry(input: {
	analysis: ConventionalAnalysis;
	stat: string;
	model: Model<Api>;
	apiKey: string;
	userContext?: string;
}): Promise<{ summary: string }> {
	let context = input.userContext;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = await generateSummary({
			model: input.model,
			apiKey: input.apiKey,
			commitType: input.analysis.type,
			scope: input.analysis.scope,
			details: input.analysis.details.map(detail => detail.text),
			stat: input.stat,
			maxChars: SUMMARY_MAX_CHARS,
			userContext: context,
		});
		const validation = validateSummary(result.summary, SUMMARY_MAX_CHARS);
		if (validation.valid) {
			return result;
		}
		if (attempt === 2) {
			return result;
		}
		context = buildRetryContext(input.userContext, validation.errors);
	}
	throw new Error("Summary generation failed");
}

function buildRetryContext(base: string | undefined, errors: string[]): string {
	return renderPromptTemplate(summaryRetryPrompt, {
		base_context: base,
		errors: errors.join("; "),
	});
}

function writeStdout(message: string): void {
	process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}
