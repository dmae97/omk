import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import {
	buildAutoresearchSegmentFingerprint,
	contractListsEqual,
	contractPathListsEqual,
	loadAutoresearchScriptSnapshot,
	readAutoresearchContract,
} from "../contract";
import {
	inferMetricUnitFromName,
	isAutoresearchShCommand,
	readMaxExperiments,
	readPendingRunSummary,
	resolveWorkDir,
	validateWorkDir,
} from "../helpers";
import { cloneExperimentState } from "../state";
import type { AutoresearchToolFactoryOptions, ExperimentState } from "../types";

const initExperimentSchema = Type.Object({
	name: Type.String({
		description: "Human-readable experiment name.",
	}),
	metric_name: Type.String({
		description: "Primary metric name shown in the dashboard.",
	}),
	metric_unit: Type.Optional(
		Type.String({
			description: "Unit for the primary metric, for example µs, ms, s, kb, or empty.",
		}),
	),
	direction: Type.Optional(
		StringEnum(["lower", "higher"], {
			description: "Whether lower or higher values are better. Defaults to lower.",
		}),
	),
	benchmark_command: Type.String({
		description: "Benchmark command recorded in autoresearch.md.",
	}),
	scope_paths: Type.Array(Type.String(), {
		description: "Files in Scope from autoresearch.md. Must be non-empty.",
		minItems: 1,
	}),
	off_limits: Type.Optional(
		Type.Array(Type.String(), {
			description: "Off Limits paths from autoresearch.md.",
		}),
	),
	constraints: Type.Optional(
		Type.Array(Type.String(), {
			description: "Constraints from autoresearch.md.",
		}),
	),
});

interface InitExperimentDetails {
	state: ExperimentState;
}

export function createInitExperimentTool(
	options: AutoresearchToolFactoryOptions,
): ToolDefinition<typeof initExperimentSchema, InitExperimentDetails> {
	return {
		name: "init_experiment",
		label: "Init Experiment",
		description:
			"Initialize or reset the autoresearch session for the current optimization target before the first logged run of a segment.",
		parameters: initExperimentSchema,
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
			const isReinitializing = state.results.length > 0;
			const workDir = resolveWorkDir(ctx.cwd);
			const pendingRun = await readPendingRunSummary(workDir, collectLoggedRunNumbers(state.results));
			if (pendingRun) {
				return {
					content: [
						{
							type: "text",
							text:
								`Error: run #${pendingRun.runNumber} has not been logged yet. ` +
								"Call log_experiment before re-initializing the current segment.",
						},
					],
				};
			}
			const contractResult = readAutoresearchContract(workDir);
			const scriptSnapshot = loadAutoresearchScriptSnapshot(workDir);
			const errors = [...contractResult.errors, ...scriptSnapshot.errors];
			if (errors.length > 0) {
				return {
					content: [{ type: "text", text: `Error: ${errors.join(" ")}` }],
				};
			}

			const benchmarkContract = contractResult.contract.benchmark;
			const expectedDirection = benchmarkContract.direction ?? "lower";
			const expectedMetricUnit = benchmarkContract.metricUnit;
			if (benchmarkContract.command && !isAutoresearchShCommand(benchmarkContract.command)) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: Benchmark.command in autoresearch.md must invoke `autoresearch.sh` directly. " +
								"Move the real workload into `autoresearch.sh` and re-run init_experiment.",
						},
					],
				};
			}
			if (benchmarkContract.command !== params.benchmark_command.trim()) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: benchmark_command does not match autoresearch.md. " +
								`Expected: ${benchmarkContract.command ?? "(missing)"}\nReceived: ${params.benchmark_command}`,
						},
					],
				};
			}
			if (benchmarkContract.primaryMetric !== params.metric_name.trim()) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: metric_name does not match autoresearch.md. " +
								`Expected: ${benchmarkContract.primaryMetric ?? "(missing)"}\nReceived: ${params.metric_name}`,
						},
					],
				};
			}
			if ((params.metric_unit ?? "") !== expectedMetricUnit) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: metric_unit does not match autoresearch.md. " +
								`Expected: ${expectedMetricUnit || "(empty)"}\nReceived: ${params.metric_unit ?? "(empty)"}`,
						},
					],
				};
			}
			if ((params.direction ?? "lower") !== expectedDirection) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: direction does not match autoresearch.md. " +
								`Expected: ${expectedDirection}\nReceived: ${params.direction ?? "lower"}`,
						},
					],
				};
			}
			if (!contractPathListsEqual(params.scope_paths, contractResult.contract.scopePaths)) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: scope_paths do not match autoresearch.md. " +
								`Expected: ${contractResult.contract.scopePaths.join(", ")}`,
						},
					],
				};
			}
			if (!contractPathListsEqual(params.off_limits ?? [], contractResult.contract.offLimits)) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: off_limits do not match autoresearch.md. " +
								`Expected: ${contractResult.contract.offLimits.join(", ") || "(empty)"}`,
						},
					],
				};
			}
			if (!contractListsEqual(params.constraints ?? [], contractResult.contract.constraints)) {
				return {
					content: [
						{
							type: "text",
							text:
								"Error: constraints do not match autoresearch.md. " +
								`Expected: ${contractResult.contract.constraints.join(", ") || "(empty)"}`,
						},
					],
				};
			}

			const segmentFingerprint = buildAutoresearchSegmentFingerprint(contractResult.contract, {
				benchmarkScript: scriptSnapshot.benchmarkScript,
				checksScript: scriptSnapshot.checksScript,
			});

			state.name = params.name;
			state.metricName = params.metric_name;
			state.metricUnit = params.metric_unit ?? "";
			state.bestDirection = params.direction ?? "lower";
			state.maxExperiments = readMaxExperiments(ctx.cwd);
			state.bestMetric = null;
			state.confidence = null;
			state.secondaryMetrics = benchmarkContract.secondaryMetrics.map(name => ({
				name,
				unit: inferMetricUnitFromName(name),
			}));
			state.benchmarkCommand = params.benchmark_command.trim();
			state.scopePaths = [...contractResult.contract.scopePaths];
			state.offLimits = [...contractResult.contract.offLimits];
			state.constraints = [...contractResult.contract.constraints];
			state.segmentFingerprint = segmentFingerprint;
			if (isReinitializing) {
				state.currentSegment += 1;
			}

			const jsonlPath = path.join(workDir, "autoresearch.jsonl");
			const configLine = JSON.stringify({
				type: "config",
				name: state.name,
				metricName: state.metricName,
				metricUnit: state.metricUnit,
				bestDirection: state.bestDirection,
				benchmarkCommand: state.benchmarkCommand,
				secondaryMetrics: state.secondaryMetrics.map(metric => metric.name),
				scopePaths: state.scopePaths,
				offLimits: state.offLimits,
				constraints: state.constraints,
				segmentFingerprint,
			});

			if (isReinitializing) {
				fs.appendFileSync(jsonlPath, `${configLine}\n`);
			} else {
				fs.writeFileSync(jsonlPath, `${configLine}\n`);
			}

			runtime.autoresearchMode = true;
			runtime.autoResumeArmed = true;
			runtime.lastAutoResumePendingRunNumber = null;
			runtime.lastRunChecks = null;
			runtime.lastRunDuration = null;
			runtime.lastRunAsi = null;
			runtime.lastRunArtifactDir = null;
			runtime.lastRunNumber = null;
			runtime.lastRunSummary = null;
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			const lines = [
				`Experiment initialized: ${state.name}`,
				`Metric: ${state.metricName} (${state.metricUnit || "unitless"}, ${state.bestDirection} is better)`,
				`Benchmark command: ${state.benchmarkCommand}`,
				`Working directory: ${workDir}`,
				`Files in Scope: ${state.scopePaths.join(", ")}`,
				isReinitializing
					? "Previous results remain in history. This starts a new segment and requires a fresh baseline."
					: "Now run the baseline experiment and log it.",
			];
			if (state.maxExperiments !== null) {
				lines.push(`Max iterations: ${state.maxExperiments}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { state: cloneExperimentState(state) },
			};
		},
		renderCall(args, _options, theme): Text {
			return new Text(renderInitCall(args.name, theme), 0, 0);
		},
		renderResult(result): Text {
			const text = replaceTabs(result.content.find(part => part.type === "text")?.text ?? "");
			return new Text(text, 0, 0);
		},
	};
}

function renderInitCall(name: string, theme: Theme): string {
	return `${theme.fg("toolTitle", theme.bold("init_experiment"))} ${theme.fg("accent", truncateToWidth(replaceTabs(name), 100))}`;
}

function collectLoggedRunNumbers(results: ExperimentState["results"]): Set<number> {
	const runNumbers = new Set<number>();
	for (const result of results) {
		if (result.runNumber !== null) {
			runNumbers.add(result.runNumber);
		}
	}
	return runNumbers;
}
