import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { formatNum, inferMetricUnitFromName, mergeAsi, resolveWorkDir, validateWorkDir } from "../helpers";
import {
	cloneExperimentState,
	computeConfidence,
	currentResults,
	findBaselineMetric,
	findBaselineSecondary,
} from "../state";
import type {
	ASIData,
	AutoresearchToolFactoryOptions,
	ExperimentResult,
	ExperimentState,
	LogDetails,
	NumericMetricMap,
} from "../types";

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

const PROTECTED_AUTORESEARCH_FILES = [
	"autoresearch.jsonl",
	"autoresearch.md",
	"autoresearch.ideas.md",
	"autoresearch.sh",
	"autoresearch.checks.sh",
] as const;

interface PreservedFile {
	content: Buffer;
	path: string;
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
			const secondaryMetrics = cloneMetrics(params.metrics);

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

			const validationError = validateSecondaryMetrics(state, secondaryMetrics, params.force ?? false);
			if (validationError) {
				return {
					content: [{ type: "text", text: `Error: ${validationError}` }],
				};
			}

			const mergedAsi = mergeAsi(runtime.lastRunAsi, sanitizeAsi(params.asi));
			const experiment: ExperimentResult = {
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

			state.results.push(experiment);
			runtime.experimentsThisSession += 1;
			registerSecondaryMetrics(state, secondaryMetrics);
			state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
			state.confidence = computeConfidence(state.results, state.currentSegment, state.bestDirection);
			experiment.confidence = state.confidence;

			persistRun(workDir, state.results.length, experiment);

			let gitNote: string | null = null;
			if (params.status === "keep") {
				gitNote = await commitKeptExperiment(options, workDir, state, experiment);
			} else {
				gitNote = await revertFailedExperiment(options, workDir);
			}

			const wallClockSeconds = runtime.lastRunDuration;
			runtime.runningExperiment = null;
			runtime.lastRunChecks = null;
			runtime.lastRunDuration = null;
			runtime.lastRunAsi = null;

			const currentSegmentRuns = currentResults(state.results, state.currentSegment).length;
			const text = buildLogText(state, experiment, currentSegmentRuns, wallClockSeconds, gitNote);
			if (state.maxExperiments !== null && currentSegmentRuns >= state.maxExperiments) {
				runtime.autoresearchMode = false;
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
			return new Text(
				`${theme.fg("toolTitle", theme.bold("log_experiment"))} ${theme.fg(color, args.status)} ${theme.fg("muted", args.description)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme): Text {
			const details = result.details;
			if (!details) {
				return new Text(result.content.find(part => part.type === "text")?.text ?? "", 0, 0);
			}
			const summary = renderSummary(details, theme);
			return new Text(summary, 0, 0);
		},
	};
}

function cloneMetrics(value: NumericMetricMap | undefined): NumericMetricMap {
	return value ? { ...value } : {};
}

function sanitizeAsi(value: { [key: string]: unknown } | undefined): ASIData | undefined {
	if (!value) return undefined;
	const result: ASIData = {};
	for (const [key, entryValue] of Object.entries(value)) {
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
			const sanitized = sanitizeAsiValue(entryValue);
			if (sanitized !== undefined) {
				result[key] = sanitized;
			}
		}
		return result;
	}
	return undefined;
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

function persistRun(workDir: string, runNumber: number, experiment: ExperimentResult): void {
	const entry = {
		run: runNumber,
		...experiment,
	};
	const jsonlPath = path.join(workDir, "autoresearch.jsonl");
	fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`);
}

async function commitKeptExperiment(
	options: AutoresearchToolFactoryOptions,
	workDir: string,
	state: ExperimentState,
	experiment: ExperimentResult,
): Promise<string> {
	const addResult = await options.pi.exec("git", ["add", "-A"], { cwd: workDir, timeout: 10_000 });
	if (addResult.code !== 0) {
		return `git add failed: ${mergeStdoutStderr(addResult).trim() || `exit ${addResult.code}`}`;
	}

	const diffResult = await options.pi.exec("git", ["diff", "--cached", "--quiet"], { cwd: workDir, timeout: 10_000 });
	if (diffResult.code === 0) {
		return "nothing to commit";
	}

	const payload: { [key: string]: string | number } = {
		status: experiment.status,
		[state.metricName]: experiment.metric,
	};
	for (const [name, value] of Object.entries(experiment.metrics)) {
		payload[name] = value;
	}
	const commitMessage = `${experiment.description}\n\nResult: ${JSON.stringify(payload)}`;
	const commitResult = await options.pi.exec("git", ["commit", "-m", commitMessage], {
		cwd: workDir,
		timeout: 10_000,
	});
	if (commitResult.code !== 0) {
		return `git commit failed: ${mergeStdoutStderr(commitResult).trim() || `exit ${commitResult.code}`}`;
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
	return summaryLine.trim();
}

async function revertFailedExperiment(options: AutoresearchToolFactoryOptions, workDir: string): Promise<string> {
	const preservedFiles = preserveAutoresearchFiles(workDir);
	const resetResult = await options.pi.exec("git", ["reset", "--hard", "HEAD"], { cwd: workDir, timeout: 10_000 });
	const cleanResult = await options.pi.exec("git", ["clean", "-fd"], { cwd: workDir, timeout: 10_000 });
	restoreAutoresearchFiles(preservedFiles);

	const notes: string[] = ["reverted changes"];
	if (resetResult.code !== 0) {
		notes.push(`git reset failed: ${mergeStdoutStderr(resetResult).trim() || `exit ${resetResult.code}`}`);
	}
	if (cleanResult.code !== 0) {
		notes.push(`git clean failed: ${mergeStdoutStderr(cleanResult).trim() || `exit ${cleanResult.code}`}`);
	}
	return notes.join("; ");
}

function preserveAutoresearchFiles(workDir: string): PreservedFile[] {
	const files: PreservedFile[] = [];
	for (const relativePath of PROTECTED_AUTORESEARCH_FILES) {
		const absolutePath = path.join(workDir, relativePath);
		if (!fs.existsSync(absolutePath)) continue;
		files.push({
			content: fs.readFileSync(absolutePath),
			path: absolutePath,
		});
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

function buildLogText(
	state: ExperimentState,
	experiment: ExperimentResult,
	currentSegmentRuns: number,
	wallClockSeconds: number | null,
	gitNote: string | null,
): string {
	const lines = [`Logged run #${state.results.length}: ${experiment.status} - ${experiment.description}`];
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

function truncateAsiValue(value: ASIData[string]): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function renderSummary(details: LogDetails, theme: Theme): string {
	const { experiment, state } = details;
	const color = experiment.status === "keep" ? "success" : experiment.status === "discard" ? "warning" : "error";
	let summary = `${theme.fg(color, experiment.status.toUpperCase())} ${theme.fg("muted", experiment.description)}`;
	summary += ` ${theme.fg("accent", `${state.metricName}=${formatNum(experiment.metric, state.metricUnit)}`)}`;
	if (state.bestMetric !== null) {
		summary += ` ${theme.fg("dim", `baseline ${formatNum(state.bestMetric, state.metricUnit)}`)}`;
	}
	if (state.confidence !== null) {
		summary += ` ${theme.fg("dim", `conf ${state.confidence.toFixed(1)}x`)}`;
	}
	return summary;
}
