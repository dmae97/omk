import { relative } from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import typesDescriptionPrompt from "$c/commit/prompts/types-description.md" with { type: "text" };
import { parseModelPattern, parseModelString, SMOL_MODEL_PRIORITY } from "$c/config/model-resolver";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { SettingsManager } from "$c/config/settings-manager";
import { discoverAuthStorage, discoverModels } from "$c/sdk";
import { loadProjectContextFiles } from "$c/system-prompt";
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
import type { CommitCommandArgs, ConventionalAnalysis } from "./types";

const SUMMARY_MAX_CHARS = 72;
const RECENT_COMMITS_COUNT = 8;
const TYPES_DESCRIPTION = renderPromptTemplate(typesDescriptionPrompt);

/**
 * Execute the omp commit pipeline for staged changes.
 */
export async function runCommitCommand(args: CommitCommandArgs): Promise<void> {
	const cwd = process.cwd();
	const settingsManager = await SettingsManager.create(cwd);
	const authStorage = await discoverAuthStorage();
	const modelRegistry = await discoverModels(authStorage);

	const { model: primaryModel, apiKey: primaryApiKey } = await resolvePrimaryModel(
		args.model,
		settingsManager,
		modelRegistry,
	);
	const { model: smolModel, apiKey: smolApiKey } = await resolveSmolModel(
		settingsManager,
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
		});
	}

	const diff = await git.getDiff(true);
	const stat = await git.getStat(true);
	const numstat = await git.getNumstat(true);
	const scopeCandidates = extractScopeCandidates(numstat).scopeCandidates;
	const recentCommits = await git.getRecentCommits(RECENT_COMMITS_COUNT);
	const contextFiles = await loadProjectContextFiles({ cwd });
	const formattedContextFiles = contextFiles.map((file) => ({
		path: relative(cwd, file.path),
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
}): Promise<ConventionalAnalysis> {
	if (shouldUseMapReduce(input.diff)) {
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
			details: input.analysis.details.map((detail) => detail.text),
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
	const parts = [base, `Previous summary failed validation: ${errors.join("; ")}`].filter(Boolean);
	return parts.join("\n");
}

function formatCommitMessage(analysis: ConventionalAnalysis, summary: string): string {
	const scopePart = analysis.scope ? `(${analysis.scope})` : "";
	const header = `${analysis.type}${scopePart}: ${summary}`;
	const bodyLines = analysis.details.map((detail) => `- ${detail.text.trim()}`);
	if (bodyLines.length === 0) {
		return header;
	}
	return `${header}\n\n${bodyLines.join("\n")}`;
}

async function resolvePrimaryModel(
	override: string | undefined,
	settingsManager: SettingsManager,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const model = override
		? resolveModelFromString(override, available)
		: resolveModelFromSettings(settingsManager, available);
	if (!model) {
		throw new Error("No model available for commit generation");
	}
	const apiKey = await modelRegistry.getApiKey(model);
	if (!apiKey) {
		throw new Error(`No API key available for model ${model.provider}/${model.id}`);
	}
	return { model, apiKey };
}

async function resolveSmolModel(
	settingsManager: SettingsManager,
	modelRegistry: {
		getAvailable: () => Model<Api>[];
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	},
	fallbackModel: Model<Api>,
	fallbackApiKey: string,
): Promise<{ model: Model<Api>; apiKey: string }> {
	const available = modelRegistry.getAvailable();
	const role = settingsManager.getModelRole("smol");
	const roleModel = role ? resolveModelFromString(role, available) : undefined;
	if (roleModel) {
		const apiKey = await modelRegistry.getApiKey(roleModel);
		if (apiKey) return { model: roleModel, apiKey };
	}

	for (const pattern of SMOL_MODEL_PRIORITY) {
		const candidate = parseModelPattern(pattern, available).model;
		if (!candidate) continue;
		const apiKey = await modelRegistry.getApiKey(candidate);
		if (apiKey) return { model: candidate, apiKey };
	}

	return { model: fallbackModel, apiKey: fallbackApiKey };
}

function resolveModelFromSettings(settingsManager: SettingsManager, available: Model<Api>[]): Model<Api> | undefined {
	const configured = settingsManager.getModelRole("default");
	if (!configured) return available[0];
	return resolveModelFromString(configured, available) ?? available[0];
}

function resolveModelFromString(value: string, available: Model<Api>[]): Model<Api> | undefined {
	const parsed = parseModelString(value);
	if (parsed) {
		return available.find((model) => model.provider === parsed.provider && model.id === parsed.id);
	}
	return parseModelPattern(value, available).model;
}

function writeStdout(message: string): void {
	process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}
