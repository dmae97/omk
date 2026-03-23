import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Text } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import { getAutoresearchFingerprintMismatchError, pathMatchesContractPath } from "../contract";
import { getCurrentAutoresearchBranch, parseWorkDirDirtyPaths } from "../git";
import {
	AUTORESEARCH_COMMITTABLE_FILES,
	formatNum,
	inferMetricUnitFromName,
	isAutoresearchCommittableFile,
	isAutoresearchLocalStatePath,
	isBetter,
	mergeAsi,
	readPendingRunSummary,
	resolveWorkDir,
	validateWorkDir,
} from "../helpers";
import {
	cloneExperimentState,
	computeConfidence,
	currentResults,
	findBaselineMetric,
	findBaselineSecondary,
	findBestKeptMetric,
} from "../state";
import type {
	ASIData,
	AutoresearchToolFactoryOptions,
	ExperimentResult,
	ExperimentState,
	LogDetails,
	NumericMetricMap,
} from "../types";

const EXPERIMENT_TOOL_NAMES = ["init_experiment", "run_experiment", "log_experiment"];

const logExperimentSchema = Type.Object({
	commit: Type.String({
		description: "Current git commit hash or placeholder.",
	}),
	metric: Type.Number({
		description: "Primary metric value for this run.",
	}),
	status: StringEnum(["keep", "discard", "crash", "checks_failed"], {
		description: "Outcome for this run.",
	}),
	description: Type.String({
		description: "Short description of the experiment.",
	}),
	metrics: Type.Optional(
		Type.Record(Type.String(), Type.Number(), {
			description: "Secondary metrics for this run.",
		}),
	),
	force: Type.Optional(
		Type.Boolean({
			description: "Allow introducing new secondary metrics.",
		}),
	),
	asi: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Actionable side information captured for this run.",
		}),
	),
});

interface PreservedFile {
	content: Buffer;
	path: string;
}

interface KeepCommitResult {
	error?: string;
	note?: string;
}

export function createLogExperimentTool(
	options: AutoresearchToolFactoryOptions,
): ToolDefinition<typeof logExperimentSchema, LogDetails> {
	return {
		name: "log_experiment",
		label: "Log Experiment",
		description:
			"Log the experiment result, update dashboard state, persist JSONL history, and apply git keep or revert behavior.",
		parameters: logExperimentSchema,
		defaultInactive: true,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const workDirError = validateWorkDir(ctx.cwd);
			if (workDirError) {
				return {
					content: [{ type: "text", text: `Error: ${workDirError}` }],
				};
			}

			const runtime = options.getRuntime(ctx);
			const state = runtime.state;
			const workDir = resolveWorkDir(ctx.cwd);
			const fingerprintError = getAutoresearchFingerprintMismatchError(state.segmentFingerprint, workDir);
			if (fingerprintError) {
				return {
					content: [{ type: "text", text: `Error: ${fingerprintError}` }],
				};
			}

			const pendingRun =
				runtime.lastRunSummary ?? (await readPendingRunSummary(workDir, collectLoggedRunNumbers(state.results)));
			if (!pendingRun) {
				return {
					content: [{ type: "text", text: "Error: no unlogged run is available. Run run_experiment first." }],
				};
			}
			runtime.lastRunSummary = pendingRun;
			runtime.lastRunAsi = pendingRun.parsedAsi;
			runtime.lastRunChecks =
				pendingRun.checksPass === null
					? null
					: {
							pass: pendingRun.checksPass,
							output: "",
							duration: pendingRun.checksDurationSeconds ?? 0,
						};
			runtime.lastRunDuration = pendingRun.durationSeconds;

			if (pendingRun.parsedPrimary !== null && params.metric !== pendingRun.parsedPrimary) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: metric does not match the parsed primary metric from the pending run.\n" +
								`Expected: ${pendingRun.parsedPrimary}\nReceived: ${params.metric}`,
						},
					],
				};
			}

			if (params.status === "keep" && !pendingRun.passed) {
				return {
					content: [
						{
							type: "text",
							text: "Error: cannot keep this run because the pending benchmark did not pass. Log it as crash or checks_failed instead.",
						},
					],
				};
			}

			if (params.status === "keep" && runtime.lastRunChecks && !runtime.lastRunChecks.pass) {
				return {
					content: [
						{
							type: "text",
							text: "Error: cannot keep this run because autoresearch.checks.sh failed. Log it as checks_failed instead.",
						},
					],
				};
			}

			const observedStatusError = validateObservedStatus(params.status, pendingRun);
			if (observedStatusError) {
				return {
					content: [{ type: "text", text: `Error: ${observedStatusError}` }],
				};
			}

			const secondaryMetrics = buildSecondaryMetrics(params.metrics, pendingRun.parsedMetrics, state.metricName);
			const validationError = validateSecondaryMetrics(state, secondaryMetrics, params.force ?? false);
			if (validationError) {
				return {
					content: [{ type: "text", text: `Error: ${validationError}` }],
				};
			}

			const mergedAsi = mergeAsi(runtime.lastRunAsi, sanitizeAsi(params.asi));
			const asiValidationError = validateAsiRequirements(mergedAsi, params.status);
			if (asiValidationError) {
				return {
					content: [{ type: "text", text: `Error: ${asiValidationError}` }],
				};
			}

			let keepScopeValidation: { committablePaths: string[] } | undefined;
			if (params.status === "keep") {
				const scopeValidation = await validateKeepPaths(options, workDir, state);
				if (typeof scopeValidation === "string") {
					return {
						content: [{ type: "text", text: `Error: ${scopeValidation}` }],
					};
				}
				const currentBestMetric = findBestKeptMetric(state.results, state.currentSegment, state.bestDirection);
				if (
					currentBestMetric !== null &&
					params.metric !== currentBestMetric &&
					!isBetter(params.metric, currentBestMetric, state.bestDirection)
				) {
					return {
						content: [
							{
								type: "text",
								text:
									"Error: cannot keep this run because the primary metric regressed.\n" +
									`Current best: ${currentBestMetric}\nReceived: ${params.metric}`,
							},
						],
					};
				}
				keepScopeValidation = scopeValidation;
			}

			const experiment: ExperimentResult = {
				runNumber: runtime.lastRunNumber ?? pendingRun.runNumber,
				commit: params.commit.slice(0, 7),
				metric: params.metric,
				metrics: secondaryMetrics,
				status: params.status,
				description: params.description,
				timestamp: Date.now(),
				segment: state.currentSegment,
				confidence: null,
				asi: mergedAsi,
			};

			const activeBranch = await getCurrentAutoresearchBranch(options.pi, workDir);
			if (!activeBranch) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: autoresearch keep/discard actions require an active `autoresearch/...` branch. " +
								"Run `/autoresearch` again to restore the protected branch before logging this run.",
						},
					],
				};
			}

			let gitNote: string | null = null;
			if (params.status === "keep") {
				const commitResult = await commitKeptExperiment(options, workDir, state, experiment, keepScopeValidation);
				if (commitResult.error) {
					return {
						content: [{ type: "text", text: `Error: ${commitResult.error}` }],
					};
				}
				gitNote = commitResult.note ?? null;
			} else {
				const revertResult = await revertFailedExperiment(options, workDir);
				if (revertResult.error) {
					return {
						content: [{ type: "text", text: `Error: ${revertResult.error}` }],
					};
				}
				gitNote = revertResult.note ?? null;
			}

			const previousState = cloneExperimentState(state);
			state.results.push(experiment);
			registerSecondaryMetrics(state, secondaryMetrics);
			state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
			state.confidence = computeConfidence(state.results, state.currentSegment, state.bestDirection);
			experiment.confidence = state.confidence;

			const wallClockSeconds = runtime.lastRunDuration;
			try {
				persistRun(workDir, experiment);
			} catch (error) {
				runtime.state = previousState;
				options.dashboard.updateWidget(ctx, runtime);
				options.dashboard.requestRender();
				throw error;
			}
			try {
				await updateRunMetadata(runtime.lastRunArtifactDir ?? pendingRun.runDirectory, {
					commit: experiment.commit,
					confidence: experiment.confidence,
					description: experiment.description,
					gitNote,
					loggedAt: new Date(experiment.timestamp).toISOString(),
					loggedAsi: experiment.asi,
					loggedMetric: experiment.metric,
					loggedMetrics: experiment.metrics,
					runNumber: runtime.lastRunNumber ?? pendingRun.runNumber,
					status: experiment.status,
					wallClockSeconds,
				});
			} catch (error) {
				logger.warn("Failed to update autoresearch run metadata after persisting JSONL history", {
					error: error instanceof Error ? error.message : String(error),
					runDirectory: runtime.lastRunArtifactDir ?? pendingRun.runDirectory,
					runNumber: runtime.lastRunNumber ?? pendingRun.runNumber,
				});
			}

			runtime.runningExperiment = null;
			runtime.lastRunChecks = null;
			runtime.lastRunDuration = null;
			runtime.lastRunAsi = null;
			runtime.lastRunArtifactDir = null;
			runtime.lastRunNumber = null;
			runtime.lastRunSummary = null;
			runtime.autoResumeArmed = true;
			runtime.lastAutoResumePendingRunNumber = null;

			const currentSegmentRuns = currentResults(state.results, state.currentSegment).length;
			const text = buildLogText(state, experiment, currentSegmentRuns, wallClockSeconds, gitNote);
			if (state.maxExperiments !== null && currentSegmentRuns >= state.maxExperiments) {
				runtime.autoresearchMode = false;
				options.pi.appendEntry(
					"autoresearch-control",
					runtime.goal ? { mode: "off", goal: runtime.goal } : { mode: "off" },
				);
				await options.pi.setActiveTools(
					options.pi.getActiveTools().filter(name => !EXPERIMENT_TOOL_NAMES.includes(name)),
				);
			}
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			return {
				content: [{ type: "text", text }],
				details: {
					experiment: {
						...experiment,
						metrics: { ...experiment.metrics },
						asi: experiment.asi ? structuredClone(experiment.asi) : undefined,
					},
					state: cloneExperimentState(state),
					wallClockSeconds,
				},
			};
		},
		renderCall(args, _options, theme): Text {
			const color = args.status === "keep" ? "success" : args.status === "discard" ? "warning" : "error";
			const description = truncateToWidth(replaceTabs(args.description), 100);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("log_experiment"))} ${theme.fg(color, args.status)} ${theme.fg("muted", description)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme): Text {
			const details = result.details;
			if (!details) {
				return new Text(replaceTabs(result.content.find(part => part.type === "text")?.text ?? ""), 0, 0);
			}
			const summary = renderSummary(details, theme);
			return new Text(summary, 0, 0);
		},
	};
}

function cloneMetrics(value: NumericMetricMap | undefined): NumericMetricMap {
	return value ? { ...value } : {};
}

function buildSecondaryMetrics(
	overrides: NumericMetricMap | undefined,
	parsedMetrics: NumericMetricMap | null,
	primaryMetricName: string,
): NumericMetricMap {
	const merged: NumericMetricMap = {};
	for (const [name, value] of Object.entries(parsedMetrics ?? {})) {
		if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
		if (name === primaryMetricName) continue;
		merged[name] = value;
	}
	for (const [name, value] of Object.entries(cloneMetrics(overrides))) {
		if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
		merged[name] = value;
	}
	return merged;
}

function sanitizeAsi(value: { [key: string]: unknown } | undefined): ASIData | undefined {
	if (!value) return undefined;
	const result: ASIData = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		const sanitized = sanitizeAsiValue(entryValue);
		if (sanitized !== undefined) {
			result[key] = sanitized;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeAsiValue(value: unknown): ASIData[string] | undefined {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		const items = value
			.map(item => sanitizeAsiValue(item))
			.filter((item): item is NonNullable<typeof item> => item !== undefined);
		return items;
	}
	if (typeof value === "object") {
		const objectValue = value as { [key: string]: unknown };
		const result: ASIData = {};
		for (const [key, entryValue] of Object.entries(objectValue)) {
			if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
			const sanitized = sanitizeAsiValue(entryValue);
			if (sanitized !== undefined) {
				result[key] = sanitized;
			}
		}
		return result;
	}
	return undefined;
}

export function validateAsiRequirements(asi: ASIData | undefined, status: ExperimentResult["status"]): string | null {
	if (!asi) {
		return "asi is required. Include at minimum a non-empty hypothesis.";
	}
	if (typeof asi.hypothesis !== "string" || asi.hypothesis.trim().length === 0) {
		return "asi.hypothesis is required and must be a non-empty string.";
	}
	if (status === "keep") return null;
	if (typeof asi.rollback_reason !== "string" || asi.rollback_reason.trim().length === 0) {
		return "asi.rollback_reason is required for discard, crash, and checks_failed results.";
	}
	if (typeof asi.next_action_hint !== "string" || asi.next_action_hint.trim().length === 0) {
		return "asi.next_action_hint is required for discard, crash, and checks_failed results.";
	}
	return null;
}

function validateSecondaryMetrics(state: ExperimentState, metrics: NumericMetricMap, force: boolean): string | null {
	if (state.secondaryMetrics.length === 0) return null;
	const knownNames = new Set(state.secondaryMetrics.map(metric => metric.name));
	const providedNames = new Set(Object.keys(metrics));

	const missing = [...knownNames].filter(name => !providedNames.has(name));
	if (missing.length > 0) {
		return `missing secondary metrics: ${missing.join(", ")}`;
	}

	const newMetrics = [...providedNames].filter(name => !knownNames.has(name));
	if (newMetrics.length > 0 && !force) {
		return `new secondary metrics require force=true: ${newMetrics.join(", ")}`;
	}
	return null;
}

function registerSecondaryMetrics(state: ExperimentState, metrics: NumericMetricMap): void {
	for (const name of Object.keys(metrics)) {
		if (state.secondaryMetrics.some(metric => metric.name === name)) continue;
		state.secondaryMetrics.push({
			name,
			unit: inferMetricUnitFromName(name),
		});
	}
}

function persistRun(workDir: string, experiment: ExperimentResult): void {
	const entry = {
		run: experiment.runNumber,
		...experiment,
	};
	const jsonlPath = path.join(workDir, "autoresearch.jsonl");
	fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`);
}

function collectLoggedRunNumbers(results: ExperimentResult[]): Set<number> {
	const runNumbers = new Set<number>();
	for (const result of results) {
		if (result.runNumber !== null) {
			runNumbers.add(result.runNumber);
		}
	}
	return runNumbers;
}

function validateObservedStatus(
	status: ExperimentResult["status"],
	pendingRun: { checksPass: boolean | null; passed: boolean },
): string | null {
	if (pendingRun.checksPass === false) {
		return status === "checks_failed"
			? null
			: "benchmark checks failed for the pending run. Log it as checks_failed.";
	}
	if (!pendingRun.passed) {
		return status === "crash" ? null : "the pending benchmark failed. Log it as crash.";
	}
	return status === "keep" || status === "discard" ? null : "the pending benchmark passed. Log it as keep or discard.";
}

async function commitKeptExperiment(
	options: AutoresearchToolFactoryOptions,
	workDir: string,
	state: ExperimentState,
	experiment: ExperimentResult,
	scopeValidation: { committablePaths: string[] } | undefined,
): Promise<KeepCommitResult> {
	if (!scopeValidation || scopeValidation.committablePaths.length === 0) {
		return { note: "nothing to commit" };
	}

	const addResult = await options.pi.exec("git", ["add", "--all", "--", ...scopeValidation.committablePaths], {
		cwd: workDir,
		timeout: 10_000,
	});
	if (addResult.code !== 0) {
		return {
			error: `git add failed: ${mergeStdoutStderr(addResult).trim() || `exit ${addResult.code}`}`,
		};
	}

	const diffResult = await options.pi.exec(
		"git",
		["diff", "--cached", "--quiet", "--", ...scopeValidation.committablePaths],
		{
			cwd: workDir,
			timeout: 10_000,
		},
	);
	if (diffResult.code === 0) {
		return { note: "nothing to commit" };
	}

	const payload: { [key: string]: string | number } = {
		status: experiment.status,
		[state.metricName]: experiment.metric,
	};
	for (const [name, value] of Object.entries(experiment.metrics)) {
		payload[name] = value;
	}
	const commitMessage = `${experiment.description}\n\nResult: ${JSON.stringify(payload)}`;
	const commitResult = await options.pi.exec(
		"git",
		["commit", "-m", commitMessage, "--", ...scopeValidation.committablePaths],
		{
			cwd: workDir,
			timeout: 10_000,
		},
	);
	if (commitResult.code !== 0) {
		return {
			error: `git commit failed: ${mergeStdoutStderr(commitResult).trim() || `exit ${commitResult.code}`}`,
		};
	}

	const revParseResult = await options.pi.exec("git", ["rev-parse", "--short=7", "HEAD"], {
		cwd: workDir,
		timeout: 5_000,
	});
	const newCommit = revParseResult.stdout.trim();
	if (newCommit.length >= 7) {
		experiment.commit = newCommit;
	}
	const summaryLine =
		mergeStdoutStderr(commitResult)
			.split("\n")
			.find(line => line.trim().length > 0) ?? "committed";
	return { note: summaryLine.trim() };
}

async function revertFailedExperiment(
	options: AutoresearchToolFactoryOptions,
	workDir: string,
): Promise<KeepCommitResult> {
	const preservedFiles = preserveAutoresearchFiles(workDir);
	const restoreResult = await options.pi.exec(
		"git",
		["restore", "--source=HEAD", "--staged", "--worktree", "--", "."],
		{ cwd: workDir, timeout: 10_000 },
	);
	const cleanResult = await options.pi.exec("git", ["clean", "-fd", "--", "."], { cwd: workDir, timeout: 10_000 });
	const cleanIgnoredResult = await options.pi.exec("git", ["clean", "-fdX", "--", "."], {
		cwd: workDir,
		timeout: 10_000,
	});
	restoreAutoresearchFiles(preservedFiles);
	if (restoreResult.code !== 0) {
		return {
			error: `git restore failed: ${mergeStdoutStderr(restoreResult).trim() || `exit ${restoreResult.code}`}`,
		};
	}
	if (cleanResult.code !== 0) {
		return {
			error: `git clean failed: ${mergeStdoutStderr(cleanResult).trim() || `exit ${cleanResult.code}`}`,
		};
	}
	if (cleanIgnoredResult.code !== 0) {
		return {
			error: `git clean -X failed: ${mergeStdoutStderr(cleanIgnoredResult).trim() || `exit ${cleanIgnoredResult.code}`}`,
		};
	}
	const dirtyCheckResult = await options.pi.exec(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
		{ cwd: workDir, timeout: 10_000 },
	);
	if (dirtyCheckResult.code !== 0) {
		return {
			error: `git status failed after cleanup: ${mergeStdoutStderr(dirtyCheckResult).trim() || `exit ${dirtyCheckResult.code}`}`,
		};
	}
	const workDirPrefix = await readGitWorkDirPrefix(options, workDir);
	const remainingDirtyPaths = parseWorkDirDirtyPaths(dirtyCheckResult.stdout, workDirPrefix).filter(
		relativePath => !isAutoresearchLocalStatePath(relativePath),
	);
	if (remainingDirtyPaths.length > 0) {
		return {
			error:
				"Autoresearch cleanup left the worktree dirty. Resolve these paths before continuing: " +
				remainingDirtyPaths.join(", "),
		};
	}
	return { note: "reverted changes" };
}

function preserveAutoresearchFiles(workDir: string): PreservedFile[] {
	const files: PreservedFile[] = [];
	for (const relativePath of [...AUTORESEARCH_COMMITTABLE_FILES, "autoresearch.jsonl"]) {
		const absolutePath = path.join(workDir, relativePath);
		if (!fs.existsSync(absolutePath)) continue;
		files.push({
			content: fs.readFileSync(absolutePath),
			path: absolutePath,
		});
	}
	const localStateDir = path.join(workDir, ".autoresearch");
	if (fs.existsSync(localStateDir)) {
		collectDirectoryFiles(localStateDir, files);
	}
	return files;
}

function restoreAutoresearchFiles(files: PreservedFile[]): void {
	for (const file of files) {
		fs.mkdirSync(path.dirname(file.path), { recursive: true });
		fs.writeFileSync(file.path, file.content);
	}
}

function mergeStdoutStderr(result: { stderr: string; stdout: string }): string {
	return `${result.stdout}${result.stderr}`;
}

async function validateKeepPaths(
	options: AutoresearchToolFactoryOptions,
	workDir: string,
	state: ExperimentState,
): Promise<{ committablePaths: string[] } | string> {
	if (state.scopePaths.length === 0) {
		return "Files in Scope is empty for the current segment. Re-run init_experiment after fixing autoresearch.md.";
	}

	const statusResult = await options.pi.exec(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
		{
			cwd: workDir,
			timeout: 10_000,
		},
	);
	if (statusResult.code !== 0) {
		return `git status failed: ${mergeStdoutStderr(statusResult).trim() || `exit ${statusResult.code}`}`;
	}

	const workDirPrefix = await readGitWorkDirPrefix(options, workDir);
	const committablePaths: string[] = [];
	for (const normalizedPath of parseWorkDirDirtyPaths(statusResult.stdout, workDirPrefix)) {
		if (isAutoresearchLocalStatePath(normalizedPath)) {
			continue;
		}
		if (isAutoresearchCommittableFile(normalizedPath)) {
			committablePaths.push(normalizedPath);
			continue;
		}
		if (state.offLimits.some(spec => pathMatchesContractPath(normalizedPath, spec))) {
			return `cannot keep this run because ${normalizedPath} is listed under Off Limits in autoresearch.md`;
		}
		if (!state.scopePaths.some(spec => pathMatchesContractPath(normalizedPath, spec))) {
			return `cannot keep this run because ${normalizedPath} is outside Files in Scope`;
		}
		committablePaths.push(normalizedPath);
	}

	return { committablePaths };
}

function collectDirectoryFiles(directory: string, files: PreservedFile[]): void {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			collectDirectoryFiles(absolutePath, files);
			continue;
		}
		files.push({
			content: fs.readFileSync(absolutePath),
			path: absolutePath,
		});
	}
}

async function updateRunMetadata(
	runDirectory: string | null,
	metadata: {
		commit: string;
		confidence: number | null;
		description: string;
		gitNote: string | null;
		loggedAt: string;
		loggedAsi: ASIData | undefined;
		loggedMetric: number;
		loggedMetrics: NumericMetricMap;
		runNumber: number | null;
		status: ExperimentResult["status"];
		wallClockSeconds: number | null;
	},
): Promise<void> {
	if (!runDirectory) return;
	const runJsonPath = path.join(runDirectory, "run.json");
	let existing: Record<string, unknown> = {};
	try {
		existing = (await Bun.file(runJsonPath).json()) as Record<string, unknown>;
	} catch {
		existing = {};
	}
	await Bun.write(
		runJsonPath,
		JSON.stringify(
			{
				...existing,
				loggedRunNumber: metadata.runNumber,
				loggedAt: metadata.loggedAt,
				loggedAsi: metadata.loggedAsi,
				loggedMetric: metadata.loggedMetric,
				loggedMetrics: metadata.loggedMetrics,
				status: metadata.status,
				description: metadata.description,
				commit: metadata.commit,
				gitNote: metadata.gitNote,
				confidence: metadata.confidence,
				wallClockSeconds: metadata.wallClockSeconds,
			},
			null,
			2,
		),
	);
}

function buildLogText(
	state: ExperimentState,
	experiment: ExperimentResult,
	currentSegmentRuns: number,
	wallClockSeconds: number | null,
	gitNote: string | null,
): string {
	const displayRunNumber = experiment.runNumber ?? state.results.length;
	const lines = [`Logged run #${displayRunNumber}: ${experiment.status} - ${experiment.description}`];
	if (wallClockSeconds !== null) {
		lines.push(`Wall clock: ${wallClockSeconds.toFixed(1)}s`);
	}
	if (state.bestMetric !== null) {
		lines.push(`Baseline ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}`);
	}
	if (currentSegmentRuns > 1 && state.bestMetric !== null && experiment.metric !== state.bestMetric) {
		const delta = ((experiment.metric - state.bestMetric) / state.bestMetric) * 100;
		const sign = delta > 0 ? "+" : "";
		lines.push(`This run: ${formatNum(experiment.metric, state.metricUnit)} (${sign}${delta.toFixed(1)}%)`);
	} else {
		lines.push(`This run: ${formatNum(experiment.metric, state.metricUnit)}`);
	}
	if (Object.keys(experiment.metrics).length > 0) {
		const baselineSecondary = findBaselineSecondary(state.results, state.currentSegment, state.secondaryMetrics);
		const parts = Object.entries(experiment.metrics).map(([name, value]) => {
			const unit = state.secondaryMetrics.find(metric => metric.name === name)?.unit ?? "";
			const baseline = baselineSecondary[name];
			if (baseline === undefined || baseline === 0 || currentSegmentRuns === 1) {
				return `${name}: ${formatNum(value, unit)}`;
			}
			const delta = ((value - baseline) / baseline) * 100;
			const sign = delta > 0 ? "+" : "";
			return `${name}: ${formatNum(value, unit)} (${sign}${delta.toFixed(1)}%)`;
		});
		lines.push(`Secondary metrics: ${parts.join("  ")}`);
	}
	if (experiment.asi) {
		const asiSummary = Object.entries(experiment.asi)
			.map(([key, value]) => `${key}: ${truncateAsiValue(value)}`)
			.join(" | ");
		lines.push(`ASI: ${asiSummary}`);
	}
	if (state.confidence !== null) {
		const status = state.confidence >= 2 ? "likely real" : state.confidence >= 1 ? "marginal" : "within noise";
		lines.push(`Confidence: ${state.confidence.toFixed(1)}x noise floor (${status})`);
	}
	if (gitNote) {
		lines.push(`Git: ${gitNote}`);
	}
	if (state.maxExperiments !== null) {
		lines.push(`Progress: ${currentSegmentRuns}/${state.maxExperiments} runs in current segment`);
		if (currentSegmentRuns >= state.maxExperiments) {
			lines.push(`Maximum experiments reached (${state.maxExperiments}). Autoresearch mode is now off.`);
		}
	}
	return lines.join("\n");
}

async function readGitWorkDirPrefix(options: AutoresearchToolFactoryOptions, workDir: string): Promise<string> {
	const prefixResult = await options.pi.exec("git", ["rev-parse", "--show-prefix"], { cwd: workDir, timeout: 5_000 });
	if (prefixResult.code !== 0) return "";
	return prefixResult.stdout.trim();
}

function truncateAsiValue(value: ASIData[string]): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function renderSummary(details: LogDetails, theme: Theme): string {
	const { experiment, state } = details;
	const color = experiment.status === "keep" ? "success" : experiment.status === "discard" ? "warning" : "error";
	let summary = `${theme.fg(color, experiment.status.toUpperCase())} ${theme.fg("muted", truncateToWidth(replaceTabs(experiment.description), 100))}`;
	summary += ` ${theme.fg("accent", `${state.metricName}=${formatNum(experiment.metric, state.metricUnit)}`)}`;
	if (state.bestMetric !== null) {
		summary += ` ${theme.fg("dim", `baseline ${formatNum(state.bestMetric, state.metricUnit)}`)}`;
	}
	if (state.confidence !== null) {
		summary += ` ${theme.fg("dim", `conf ${state.confidence.toFixed(1)}x`)}`;
	}
	return summary;
}
