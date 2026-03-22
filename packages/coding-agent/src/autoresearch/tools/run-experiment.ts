import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Text } from "@oh-my-pi/pi-tui";
import { formatBytes } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "../../session/streaming-output";
import {
	createTempFileAllocator,
	EXPERIMENT_MAX_BYTES,
	EXPERIMENT_MAX_LINES,
	formatElapsed,
	formatNum,
	isAutoresearchShCommand,
	killTree,
	parseAsiLines,
	parseMetricLines,
	resolveWorkDir,
	validateWorkDir,
} from "../helpers";
import type { AutoresearchToolFactoryOptions, RunDetails, RunExperimentProgressDetails } from "../types";

const runExperimentSchema = Type.Object({
	command: Type.String({
		description: "Shell command to run for this experiment.",
	}),
	timeout_seconds: Type.Optional(
		Type.Number({
			description: "Timeout in seconds. Defaults to 600.",
		}),
	),
	checks_timeout_seconds: Type.Optional(
		Type.Number({
			description: "Timeout in seconds for autoresearch.checks.sh. Defaults to 300.",
		}),
	),
});

interface ProcessExecutionResult {
	actualTotalBytes: number;
	exitCode: number | null;
	killed: boolean;
	output: string;
	tempFilePath?: string;
}

interface ChecksExecutionResult {
	code: number | null;
	killed: boolean;
	output: string;
}

export function createRunExperimentTool(
	options: AutoresearchToolFactoryOptions,
): ToolDefinition<typeof runExperimentSchema, RunDetails | RunExperimentProgressDetails> {
	return {
		name: "run_experiment",
		label: "Run Experiment",
		description:
			"Run an experiment command with timing, tail capture, structured metric parsing, and optional autoresearch.checks.sh validation.",
		parameters: runExperimentSchema,
		defaultInactive: true,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const workDirError = validateWorkDir(ctx.cwd);
			if (workDirError) {
				return {
					content: [{ type: "text", text: `Error: ${workDirError}` }],
				};
			}

			const runtime = options.getRuntime(ctx);
			const state = runtime.state;
			const workDir = resolveWorkDir(ctx.cwd);
			const checksPath = path.join(workDir, "autoresearch.checks.sh");
			const autoresearchScriptPath = path.join(workDir, "autoresearch.sh");

			if (fs.existsSync(autoresearchScriptPath) && !isAutoresearchShCommand(params.command)) {
				return {
					content: [
						{
							type: "text",
							text:
								`Error: autoresearch.sh exists. Run it directly instead of using a different command.\n` +
								`Expected something like: bash autoresearch.sh\n` +
								`Received: ${params.command}`,
						},
					],
				};
			}

			if (state.maxExperiments !== null) {
				const segmentRuns = state.results.filter(result => result.segment === state.currentSegment).length;
				if (segmentRuns >= state.maxExperiments) {
					return {
						content: [
							{
								type: "text",
								text: `Maximum experiments reached (${state.maxExperiments}). Re-initialize to start a new segment.`,
							},
						],
					};
				}
			}

			runtime.runningExperiment = {
				startedAt: Date.now(),
				command: params.command,
			};
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			const timeoutMs = Math.max(0, Math.floor((params.timeout_seconds ?? 600) * 1000));
			const startedAt = Date.now();
			let execution: ProcessExecutionResult;
			try {
				execution = await executeProcess({
					command: params.command,
					cwd: workDir,
					timeoutMs,
					signal,
					onProgress: details => {
						onUpdate?.({
							content: [{ type: "text", text: details.tailOutput }],
							details: {
								phase: "running",
								elapsed: details.elapsed,
								truncation: details.truncation,
								fullOutputPath: details.fullOutputPath,
							},
						});
					},
				});
			} finally {
				runtime.runningExperiment = null;
				options.dashboard.updateWidget(ctx, runtime);
				options.dashboard.requestRender();
			}

			const durationSeconds = (Date.now() - startedAt) / 1000;
			runtime.lastRunDuration = durationSeconds;

			const benchmarkPassed = execution.exitCode === 0 && !execution.killed;
			let checksPass: boolean | null = null;
			let checksTimedOut = false;
			let checksOutput = "";
			let checksDuration = 0;

			if (benchmarkPassed && fs.existsSync(checksPath)) {
				const checksStartedAt = Date.now();
				const checksResult = runChecks({
					cwd: workDir,
					pathToChecks: checksPath,
					timeoutMs: Math.max(0, Math.floor((params.checks_timeout_seconds ?? 300) * 1000)),
					signal,
				});
				checksDuration = (Date.now() - checksStartedAt) / 1000;
				checksTimedOut = checksResult.killed;
				checksPass = checksResult.code === 0 && !checksResult.killed;
				checksOutput = checksResult.output;
			}

			runtime.lastRunChecks =
				checksPass === null
					? null
					: {
							pass: checksPass,
							output: checksOutput,
							duration: checksDuration,
						};

			const llmTruncation = truncateTail(execution.output, {
				maxBytes: EXPERIMENT_MAX_BYTES,
				maxLines: EXPERIMENT_MAX_LINES,
			});
			const displayTruncation = truncateTail(execution.output, {
				maxBytes: DEFAULT_MAX_BYTES,
				maxLines: DEFAULT_MAX_LINES,
			});

			let fullOutputPath = execution.tempFilePath;
			if (!fullOutputPath && llmTruncation.truncated) {
				fullOutputPath = createTempFileAllocator()();
				fs.writeFileSync(fullOutputPath, execution.output);
			}

			const parsedMetricsMap = parseMetricLines(execution.output);
			const parsedMetrics = parsedMetricsMap.size > 0 ? Object.fromEntries(parsedMetricsMap.entries()) : null;
			const parsedPrimary = parsedMetricsMap.get(state.metricName) ?? null;
			const parsedAsi = parseAsiLines(execution.output);
			runtime.lastRunAsi = parsedAsi;

			const resultDetails: RunDetails = {
				command: params.command,
				exitCode: execution.exitCode,
				durationSeconds,
				passed: benchmarkPassed && (checksPass === null || checksPass),
				crashed: execution.exitCode !== 0 || execution.killed || checksPass === false,
				timedOut: execution.killed,
				tailOutput: displayTruncation.content,
				checksPass,
				checksTimedOut,
				checksOutput: checksOutput.split("\n").slice(-80).join("\n"),
				checksDuration,
				parsedMetrics,
				parsedPrimary,
				parsedAsi,
				metricName: state.metricName,
				metricUnit: state.metricUnit,
				truncation: llmTruncation.truncated ? llmTruncation : undefined,
				fullOutputPath,
			};

			return {
				content: [{ type: "text", text: buildRunText(resultDetails, llmTruncation.content, state.bestMetric) }],
				details: resultDetails,
			};
		},
		renderCall(args, _options, theme): Text {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("run_experiment"))} ${theme.fg("muted", args.command)}`,
				0,
				0,
			);
		},
		renderResult(result, options, theme): Text {
			if (isProgressDetails(result.details)) {
				const header = theme.fg("warning", `Running ${result.details.elapsed}...`);
				const preview = result.content.find(part => part.type === "text")?.text ?? "";
				return new Text(preview ? `${header}\n${theme.fg("dim", preview)}` : header, 0, 0);
			}

			const details = result.details;
			if (!details || !isRunDetails(details)) {
				return new Text(result.content.find(part => part.type === "text")?.text ?? "", 0, 0);
			}

			const statusText = renderStatus(details, theme);
			if (!options.expanded && details.tailOutput.trim().length === 0) {
				return new Text(statusText, 0, 0);
			}

			const preview = options.expanded ? details.tailOutput : details.tailOutput.split("\n").slice(-5).join("\n");
			const suffix =
				options.expanded && details.truncation && details.fullOutputPath
					? `\n${theme.fg("warning", `Full output: ${details.fullOutputPath}`)}`
					: "";
			return new Text(preview ? `${statusText}\n${theme.fg("dim", preview)}${suffix}` : statusText, 0, 0);
		},
	};
}

interface ProgressSnapshot {
	elapsed: string;
	fullOutputPath?: string;
	tailOutput: string;
	truncation?: RunExperimentProgressDetails["truncation"];
}

async function executeProcess(options: {
	command: string;
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal;
	onProgress(details: ProgressSnapshot): void;
}): Promise<ProcessExecutionResult> {
	const { promise, resolve, reject } = Promise.withResolvers<ProcessExecutionResult>();
	const child = childProcess.spawn("bash", ["-lc", options.command], {
		cwd: options.cwd,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const getTempFile = createTempFileAllocator();
	const chunks: Buffer[] = [];
	let chunksBytes = 0;
	let totalBytes = 0;
	let killedByTimeout = false;
	let resolved = false;
	let fullOutputPath: string | undefined;
	let writeStream: fs.WriteStream | undefined;

	const cleanup = (): void => {
		if (progressTimer) clearInterval(progressTimer);
		if (timeoutHandle) clearTimeout(timeoutHandle);
		options.signal?.removeEventListener("abort", abortHandler);
		if (writeStream) {
			writeStream.end();
			writeStream = undefined;
		}
	};

	const finish = (callback: () => void): void => {
		if (resolved) return;
		resolved = true;
		cleanup();
		callback();
	};

	const appendChunk = (data: Buffer): void => {
		totalBytes += data.length;
		if (!fullOutputPath && totalBytes > DEFAULT_MAX_BYTES) {
			fullOutputPath = getTempFile();
			writeStream = fs.createWriteStream(fullOutputPath);
			for (const chunk of chunks) {
				writeStream.write(chunk);
			}
		}
		writeStream?.write(data);
		chunks.push(data);
		chunksBytes += data.length;
		while (chunksBytes > DEFAULT_MAX_BYTES * 2 && chunks.length > 1) {
			const removed = chunks.shift();
			if (removed) chunksBytes -= removed.length;
		}
	};

	const snapshot = (): ProgressSnapshot => {
		const tail = truncateTail(Buffer.concat(chunks).toString("utf8"), {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		return {
			elapsed: formatElapsed(Date.now() - startedAt),
			fullOutputPath,
			tailOutput: tail.content,
			truncation: tail.truncated ? tail : undefined,
		};
	};

	const startedAt = Date.now();
	const progressTimer = setInterval(() => {
		options.onProgress(snapshot());
	}, 1000);
	const timeoutHandle =
		options.timeoutMs > 0
			? setTimeout(() => {
					killedByTimeout = true;
					if (child.pid) killTree(child.pid);
				}, options.timeoutMs)
			: undefined;

	const abortHandler = (): void => {
		if (child.pid) killTree(child.pid);
	};
	if (options.signal?.aborted) {
		abortHandler();
	} else {
		options.signal?.addEventListener("abort", abortHandler, { once: true });
	}

	child.stdout?.on("data", data => {
		appendChunk(data);
	});
	child.stderr?.on("data", data => {
		appendChunk(data);
	});
	child.on("error", error => {
		finish(() => reject(error));
	});
	child.on("close", code => {
		if (options.signal?.aborted) {
			finish(() => reject(new Error("aborted")));
			return;
		}
		const output = Buffer.concat(chunks).toString("utf8");
		finish(() =>
			resolve({
				actualTotalBytes: totalBytes,
				exitCode: code,
				killed: killedByTimeout,
				output,
				tempFilePath: fullOutputPath,
			}),
		);
	});

	return promise;
}

function runChecks(options: {
	cwd: string;
	pathToChecks: string;
	timeoutMs: number;
	signal?: AbortSignal;
	// signal currently unused because spawnSync does not support AbortSignal directly.
}): ChecksExecutionResult {
	const result = childProcess.spawnSync("bash", [options.pathToChecks], {
		cwd: options.cwd,
		timeout: options.timeoutMs,
		encoding: "utf8",
		maxBuffer: DEFAULT_MAX_BYTES,
	});
	return {
		code: result.status,
		killed: result.signal === "SIGTERM" || result.signal === "SIGKILL" || Boolean(result.error),
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
	};
}

function buildRunText(details: RunDetails, outputPreview: string, bestMetric: number | null): string {
	const lines: string[] = [];
	if (details.timedOut) {
		lines.push(`TIMEOUT after ${details.durationSeconds.toFixed(1)}s`);
	} else if (details.exitCode !== 0) {
		lines.push(`FAILED with exit code ${details.exitCode} in ${details.durationSeconds.toFixed(1)}s`);
	} else {
		lines.push(`PASSED in ${details.durationSeconds.toFixed(1)}s`);
	}
	if (details.checksTimedOut) {
		lines.push(`Checks timed out after ${details.checksDuration.toFixed(1)}s`);
	} else if (details.checksPass === false) {
		lines.push(`Checks failed in ${details.checksDuration.toFixed(1)}s`);
	} else if (details.checksPass === true) {
		lines.push(`Checks passed in ${details.checksDuration.toFixed(1)}s`);
	}
	if (bestMetric !== null) {
		lines.push(`Current baseline ${details.metricName}: ${formatNum(bestMetric, details.metricUnit)}`);
	}
	if (details.parsedPrimary !== null) {
		lines.push(`Parsed ${details.metricName}: ${details.parsedPrimary}`);
	}
	if (details.parsedMetrics) {
		const secondary = Object.entries(details.parsedMetrics)
			.filter(([name]) => name !== details.metricName)
			.map(([name, value]) => `${name}=${value}`);
		if (secondary.length > 0) {
			lines.push(`Parsed metrics: ${secondary.join(", ")}`);
		}
	}
	if (details.parsedAsi) {
		lines.push(`Parsed ASI keys: ${Object.keys(details.parsedAsi).join(", ")}`);
	}
	lines.push("");
	lines.push(outputPreview);
	if (details.truncation && details.fullOutputPath) {
		lines.push("");
		lines.push(
			`Output truncated (${formatBytes(EXPERIMENT_MAX_BYTES)} limit). Full output: ${details.fullOutputPath}`,
		);
	}
	if (details.checksPass === false && details.checksOutput.length > 0) {
		lines.push("");
		lines.push("Checks output:");
		lines.push(details.checksOutput);
	}
	return lines.join("\n").trimEnd();
}

function renderStatus(details: RunDetails, theme: Theme): string {
	if (details.timedOut) {
		return theme.fg("error", `TIMEOUT ${details.durationSeconds.toFixed(1)}s`);
	}
	if (details.checksTimedOut) {
		return theme.fg("warning", `Checks timeout ${details.checksDuration.toFixed(1)}s`);
	}
	if (details.checksPass === false) {
		return theme.fg("error", `Checks failed ${details.checksDuration.toFixed(1)}s`);
	}
	if (details.exitCode !== 0) {
		return theme.fg("error", `FAIL exit=${details.exitCode} ${details.durationSeconds.toFixed(1)}s`);
	}
	const metric =
		details.parsedPrimary !== null
			? ` ${details.metricName}=${formatNum(details.parsedPrimary, details.metricUnit)}`
			: "";
	return theme.fg("success", `PASS ${details.durationSeconds.toFixed(1)}s${metric}`);
}

function isRunDetails(value: unknown): value is RunDetails {
	if (typeof value !== "object" || value === null) return false;
	return "command" in value && "durationSeconds" in value;
}

function isProgressDetails(value: unknown): value is RunExperimentProgressDetails {
	if (typeof value !== "object" || value === null) return false;
	return "phase" in value && value.phase === "running";
}
