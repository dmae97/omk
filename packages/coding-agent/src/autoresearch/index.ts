import * as fs from "node:fs";
import * as path from "node:path";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { ExtensionContext, ExtensionFactory } from "../extensibility/extensions";
import commandInitializeTemplate from "./command-initialize.md" with { type: "text" };
import commandResumeTemplate from "./command-resume.md" with { type: "text" };
import { pathMatchesContractPath } from "./contract";
import { createDashboardController } from "./dashboard";
import { ensureAutoresearchBranch } from "./git";
import {
	formatNum,
	isAutoresearchCommittableFile,
	isAutoresearchLocalStatePath,
	isAutoresearchShCommand,
	normalizeAutoresearchPath,
	readMaxExperiments,
	readPendingRunSummary,
	resolveWorkDir,
	validateWorkDir,
} from "./helpers";
import promptTemplate from "./prompt.md" with { type: "text" };
import resumeMessageTemplate from "./resume-message.md" with { type: "text" };
import {
	cloneExperimentState,
	createExperimentState,
	createRuntimeStore,
	currentResults,
	findBaselineMetric,
	reconstructControlState,
	reconstructStateFromJsonl,
} from "./state";
import { createInitExperimentTool } from "./tools/init-experiment";
import { createLogExperimentTool } from "./tools/log-experiment";
import { createRunExperimentTool } from "./tools/run-experiment";
import type { AutoresearchRuntime, ChecksResult, ExperimentResult, PendingRunSummary } from "./types";

const EXPERIMENT_TOOL_NAMES = ["init_experiment", "run_experiment", "log_experiment"];

interface AutoresearchSetupInput {
	intent: string;
	benchmarkCommand: string;
	metricName: string;
	metricUnit: string;
	direction: "lower" | "higher";
	secondaryMetrics: string[];
	scopePaths: string[];
	offLimits: string[];
	constraints: string[];
}

export const createAutoresearchExtension: ExtensionFactory = api => {
	const runtimeStore = createRuntimeStore();
	const dashboard = createDashboardController();

	const getSessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();
	const getRuntime = (ctx: ExtensionContext): AutoresearchRuntime => runtimeStore.ensure(getSessionKey(ctx));

	const rehydrate = async (ctx: ExtensionContext): Promise<void> => {
		const runtime = getRuntime(ctx);
		const workDir = resolveWorkDir(ctx.cwd);
		const reconstructed = reconstructStateFromJsonl(workDir);
		const control = reconstructControlState(ctx.sessionManager.getBranch());
		const loggedRunNumbers = collectLoggedRunNumbers(reconstructed.state.results);
		runtime.state = cloneExperimentState(reconstructed.state);
		runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
		runtime.goal = control.goal;
		runtime.autoresearchMode = control.autoresearchMode;
		runtime.autoResumeArmed = false;
		runtime.lastAutoResumePendingRunNumber = null;
		runtime.lastRunSummary = await readPendingRunSummary(workDir, loggedRunNumbers);
		runtime.lastRunChecks = summaryToChecks(runtime.lastRunSummary);
		runtime.lastRunDuration = runtime.lastRunSummary?.durationSeconds ?? null;
		runtime.lastRunAsi = runtime.lastRunSummary?.parsedAsi ?? null;
		runtime.lastRunArtifactDir = runtime.lastRunSummary?.runDirectory ?? null;
		runtime.lastRunNumber = runtime.lastRunSummary?.runNumber ?? null;
		runtime.runningExperiment = null;
		dashboard.updateWidget(ctx, runtime);
		const activeTools = api.getActiveTools();
		const experimentTools = new Set(EXPERIMENT_TOOL_NAMES);
		const nextActiveTools = runtime.autoresearchMode
			? [...new Set([...activeTools, ...EXPERIMENT_TOOL_NAMES])]
			: activeTools.filter(name => !experimentTools.has(name));
		const toolsChanged =
			nextActiveTools.length !== activeTools.length ||
			nextActiveTools.some((name, index) => name !== activeTools[index]);
		if (toolsChanged) {
			await api.setActiveTools(nextActiveTools);
		}
	};

	const setMode = (
		ctx: ExtensionContext,
		enabled: boolean,
		goal: string | null,
		mode: "on" | "off" | "clear",
	): void => {
		const runtime = getRuntime(ctx);
		runtime.autoresearchMode = enabled;
		runtime.autoResumeArmed = false;
		runtime.goal = goal;
		runtime.lastAutoResumePendingRunNumber = null;
		api.appendEntry("autoresearch-control", goal ? { mode, goal } : { mode });
	};

	api.registerTool(createInitExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createRunExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createLogExperimentTool({ dashboard, getRuntime, pi: api }));
	api.on("tool_call", (event, ctx) => {
		const runtime = getRuntime(ctx);
		if (!runtime.autoresearchMode) return;
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			const validationError = validateAutoresearchBashCommand(command);
			if (validationError) {
				return {
					block: true,
					reason: validationError,
				};
			}
			return;
		}
		if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "ast_edit") return;

		const rawPaths = getGuardedToolPaths(event.toolName, event.input);
		if (rawPaths === null) {
			return {
				block: true,
				reason:
					"Autoresearch requires an explicit target path for this editing tool so it can enforce Files in Scope and Off Limits before changes are made.",
			};
		}

		const workDir = resolveWorkDir(ctx.cwd);
		for (const rawPath of rawPaths) {
			const relativePath = resolveAutoresearchRelativePath(workDir, rawPath);
			if (!relativePath.ok) {
				return {
					block: true,
					reason: relativePath.reason,
				};
			}
			const validationError = validateEditableAutoresearchPath(relativePath.relativePath, runtime);
			if (validationError) {
				return {
					block: true,
					reason: `Autoresearch blocked edits to ${relativePath.relativePath}: ${validationError}`,
				};
			}
		}
	});

	api.registerCommand("autoresearch", {
		description: "Start, stop, or clear builtin autoresearch mode.",
		getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
			if (argumentPrefix.includes(" ")) return null;
			const completions: AutocompleteItem[] = [
				{ label: "off", value: "off", description: "Leave autoresearch mode" },
				{ label: "clear", value: "clear", description: "Delete autoresearch.jsonl and leave autoresearch mode" },
			];
			const normalized = argumentPrefix.trim().toLowerCase();
			const filtered = completions.filter(item => item.label.startsWith(normalized));
			return filtered.length > 0 ? filtered : null;
		},
		async handler(args, ctx): Promise<void> {
			const trimmed = args.trim();
			const runtime = getRuntime(ctx);
			const workDirError = validateWorkDir(ctx.cwd);
			if (workDirError) {
				ctx.ui.notify(workDirError, "error");
				return;
			}

			if (trimmed === "off") {
				setMode(ctx, false, runtime.goal, "off");
				dashboard.updateWidget(ctx, runtime);
				const experimentTools = new Set(EXPERIMENT_TOOL_NAMES);
				await api.setActiveTools(api.getActiveTools().filter(name => !experimentTools.has(name)));
				ctx.ui.notify("Autoresearch mode disabled", "info");
				return;
			}
			if (trimmed === "clear") {
				const workDir = resolveWorkDir(ctx.cwd);
				const jsonlPath = path.join(workDir, "autoresearch.jsonl");
				const localStatePath = path.join(workDir, ".autoresearch");
				if (fs.existsSync(jsonlPath)) {
					fs.rmSync(jsonlPath);
				}
				if (fs.existsSync(localStatePath)) {
					fs.rmSync(localStatePath, { force: true, recursive: true });
				}
				runtime.state = createExperimentState();
				runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
				runtime.goal = null;
				runtime.lastRunChecks = null;
				runtime.lastRunDuration = null;
				runtime.lastRunAsi = null;
				runtime.lastRunArtifactDir = null;
				runtime.lastRunNumber = null;
				runtime.lastRunSummary = null;
				setMode(ctx, false, null, "clear");
				dashboard.updateWidget(ctx, runtime);
				const experimentTools = new Set(EXPERIMENT_TOOL_NAMES);
				await api.setActiveTools(api.getActiveTools().filter(name => !experimentTools.has(name)));
				ctx.ui.notify("Autoresearch local state cleared", "info");
				return;
			}

			const workDir = resolveWorkDir(ctx.cwd);
			const autoresearchMdPath = path.join(workDir, "autoresearch.md");
			const hasAutoresearchMd = fs.existsSync(autoresearchMdPath);
			const controlState = reconstructControlState(ctx.sessionManager.getBranch());
			const shouldResumeExistingNotes =
				hasAutoresearchMd &&
				(hasLocalAutoresearchState(workDir) || (controlState.lastMode !== "clear" && trimmed.length === 0));

			if (shouldResumeExistingNotes) {
				const resumeContext = trimmed;
				const resumeGoal = runtime.goal ?? runtime.state.name ?? null;
				const branchResult = await ensureAutoresearchBranch(api, workDir, resumeGoal);
				if (!branchResult.ok) {
					ctx.ui.notify(branchResult.error, "error");
					return;
				}

				setMode(ctx, true, resumeGoal, "on");
				dashboard.updateWidget(ctx, runtime);
				await api.setActiveTools([...new Set([...api.getActiveTools(), ...EXPERIMENT_TOOL_NAMES])]);
				api.sendUserMessage(
					renderPromptTemplate(commandResumeTemplate, {
						autoresearch_md_path: autoresearchMdPath,
						branch_status_line: branchResult.created
							? `Created and checked out dedicated git branch \`${branchResult.branchName}\` before resuming.`
							: `Using dedicated git branch \`${branchResult.branchName}\`.`,
						has_resume_context: resumeContext.length > 0,
						resume_context: resumeContext,
					}),
				);
				return;
			}

			const setup = await promptForAutoresearchSetup(
				ctx,
				trimmed || runtime.goal || "what should autoresearch improve?",
			);
			if (!setup) return;

			const branchResult = await ensureAutoresearchBranch(api, workDir, setup.intent);
			if (!branchResult.ok) {
				ctx.ui.notify(branchResult.error, "error");
				return;
			}

			setMode(ctx, true, setup.intent, "on");
			runtime.state.name = setup.intent;
			runtime.state.metricName = setup.metricName;
			runtime.state.metricUnit = setup.metricUnit;
			runtime.state.bestDirection = setup.direction;
			runtime.state.secondaryMetrics = setup.secondaryMetrics.map(name => ({ name, unit: "" }));
			runtime.state.benchmarkCommand = setup.benchmarkCommand;
			runtime.state.scopePaths = [...setup.scopePaths];
			runtime.state.offLimits = [...setup.offLimits];
			runtime.state.constraints = [...setup.constraints];
			dashboard.updateWidget(ctx, runtime);
			await api.setActiveTools([...new Set([...api.getActiveTools(), ...EXPERIMENT_TOOL_NAMES])]);
			api.sendUserMessage(
				renderPromptTemplate(commandInitializeTemplate, {
					branch_status_line: branchResult.created
						? `Created and checked out dedicated git branch \`${branchResult.branchName}\`.`
						: `Using dedicated git branch \`${branchResult.branchName}\`.`,
					intent: setup.intent,
					benchmark_command: setup.benchmarkCommand,
					metric_name: setup.metricName,
					metric_unit: setup.metricUnit,
					direction: setup.direction,
					has_secondary_metrics: setup.secondaryMetrics.length > 0,
					secondary_metrics: setup.secondaryMetrics,
					secondary_metrics_block: formatBulletBlock(
						setup.secondaryMetrics,
						value => `  - \`${value}\``,
						"  - `(none)`",
					),
					scope_paths: setup.scopePaths,
					scope_paths_block: formatBulletBlock(setup.scopePaths, value => `  - \`${value}\``),
					has_off_limits: setup.offLimits.length > 0,
					off_limits: setup.offLimits,
					off_limits_block: formatBulletBlock(setup.offLimits, value => `  - \`${value}\``, "  - `(none)`"),
					has_constraints: setup.constraints.length > 0,
					constraints: setup.constraints,
					constraints_block: formatBulletBlock(setup.constraints, value => `  - ${value}`, "  - `(none)`"),
				}),
			);
		},
	});

	api.registerShortcut("ctrl+x", {
		description: "Toggle autoresearch dashboard",
		handler(ctx): void {
			const runtime = getRuntime(ctx);
			if (runtime.state.results.length === 0 && !runtime.runningExperiment) {
				ctx.ui.notify("No autoresearch results yet", "info");
				return;
			}
			runtime.dashboardExpanded = !runtime.dashboardExpanded;
			dashboard.updateWidget(ctx, runtime);
		},
	});

	api.registerShortcut("ctrl+shift+x", {
		description: "Show autoresearch dashboard overlay",
		handler(ctx): Promise<void> {
			return dashboard.showOverlay(ctx, getRuntime(ctx));
		},
	});

	api.on("session_start", (_event, ctx) => rehydrate(ctx));
	api.on("session_switch", (_event, ctx) => rehydrate(ctx));
	api.on("session_branch", (_event, ctx) => rehydrate(ctx));
	api.on("session_tree", (_event, ctx) => rehydrate(ctx));
	api.on("session_shutdown", (_event, ctx) => {
		dashboard.clear(ctx);
		runtimeStore.clear(getSessionKey(ctx));
	});

	api.on("agent_end", async (_event, ctx) => {
		const runtime = getRuntime(ctx);
		runtime.runningExperiment = null;
		dashboard.updateWidget(ctx, runtime);
		dashboard.requestRender();
		if (!runtime.autoresearchMode) return;
		if (ctx.hasPendingMessages()) {
			runtime.autoResumeArmed = false;
			return;
		}
		const workDir = resolveWorkDir(ctx.cwd);
		const pendingRun =
			runtime.lastRunSummary ??
			(await readPendingRunSummary(workDir, collectLoggedRunNumbers(runtime.state.results)));
		runtime.lastRunSummary = pendingRun;
		runtime.lastRunChecks = summaryToChecks(pendingRun);
		runtime.lastRunDuration = pendingRun?.durationSeconds ?? runtime.lastRunDuration;
		runtime.lastRunAsi = pendingRun?.parsedAsi ?? runtime.lastRunAsi;
		const shouldResumePendingRun =
			pendingRun !== null && runtime.lastAutoResumePendingRunNumber !== pendingRun.runNumber;
		if (!shouldResumePendingRun && !runtime.autoResumeArmed) {
			return;
		}
		runtime.autoResumeArmed = false;
		runtime.lastAutoResumePendingRunNumber = pendingRun?.runNumber ?? null;
		const autoresearchMdPath = path.join(workDir, "autoresearch.md");
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		api.sendMessage(
			{
				customType: "autoresearch-resume",
				content: renderPromptTemplate(resumeMessageTemplate, {
					autoresearch_md_path: autoresearchMdPath,
					has_ideas: fs.existsSync(ideasPath),
					has_pending_run: Boolean(pendingRun),
				}),
				display: false,
				attribution: "agent",
			},
			{ deliverAs: "nextTurn", triggerTurn: true },
		);
	});

	api.on("before_agent_start", async (event, ctx) => {
		const runtime = getRuntime(ctx);
		if (!runtime.autoresearchMode) return;
		const workDir = resolveWorkDir(ctx.cwd);
		const autoresearchMdPath = path.join(workDir, "autoresearch.md");
		const checksPath = path.join(workDir, "autoresearch.checks.sh");
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		const programPath = path.join(workDir, "autoresearch.program.md");
		const pendingRun =
			runtime.lastRunSummary ??
			(await readPendingRunSummary(workDir, collectLoggedRunNumbers(runtime.state.results)));
		runtime.lastRunSummary = pendingRun;
		runtime.lastRunChecks = summaryToChecks(pendingRun);
		runtime.lastRunDuration = pendingRun?.durationSeconds ?? runtime.lastRunDuration;
		runtime.lastRunAsi = pendingRun?.parsedAsi ?? runtime.lastRunAsi;
		const currentSegmentResults = currentResults(runtime.state.results, runtime.state.currentSegment);
		const baselineMetric = findBaselineMetric(runtime.state.results, runtime.state.currentSegment);
		const bestResult = findBestResult(runtime);
		const goal = runtime.goal ?? runtime.state.name ?? "";
		const recentResults = currentSegmentResults.slice(-3).map(result => {
			const asiSummary = summarizeExperimentAsi(result);
			return {
				asi_summary: asiSummary,
				description: result.description,
				has_asi_summary: Boolean(asiSummary),
				metric_display: formatNum(result.metric, runtime.state.metricUnit),
				run_number: result.runNumber ?? runtime.state.results.indexOf(result) + 1,
				status: result.status,
			};
		});
		return {
			systemPrompt: renderPromptTemplate(promptTemplate, {
				base_system_prompt: event.systemPrompt,
				has_goal: goal.trim().length > 0,
				goal,
				working_dir: workDir,
				default_metric_name: runtime.state.metricName,
				metric_name: runtime.state.metricName,
				has_autoresearch_md: fs.existsSync(autoresearchMdPath),
				autoresearch_md_path: autoresearchMdPath,
				has_checks: fs.existsSync(checksPath),
				checks_path: checksPath,
				has_ideas: fs.existsSync(ideasPath),
				ideas_path: ideasPath,
				has_program: fs.existsSync(programPath),
				program_path: programPath,
				current_segment: runtime.state.currentSegment + 1,
				current_segment_run_count: currentSegmentResults.length,
				has_baseline_metric: baselineMetric !== null,
				baseline_metric_display: formatNum(baselineMetric, runtime.state.metricUnit),
				has_best_result: Boolean(bestResult),
				best_metric_display: bestResult
					? formatNum(bestResult.metric, runtime.state.metricUnit)
					: formatNum(baselineMetric, runtime.state.metricUnit),
				best_run_number: bestResult
					? (bestResult.runNumber ?? runtime.state.results.indexOf(bestResult) + 1)
					: null,
				has_recent_results: recentResults.length > 0,
				recent_results: recentResults,
				has_pending_run: Boolean(pendingRun),
				pending_run_number: pendingRun?.runNumber,
				pending_run_command: pendingRun?.command,
				pending_run_directory: pendingRun?.runDirectory,
				pending_run_passed: pendingRun?.passed ?? false,
				has_pending_run_metric: pendingRun?.parsedPrimary !== null && pendingRun?.parsedPrimary !== undefined,
				pending_run_metric_display:
					pendingRun?.parsedPrimary !== null && pendingRun?.parsedPrimary !== undefined
						? formatNum(pendingRun.parsedPrimary, runtime.state.metricUnit)
						: null,
			}),
		};
	});
};

async function promptForAutoresearchSetup(
	ctx: ExtensionContext,
	defaultIntent: string,
): Promise<AutoresearchSetupInput | undefined> {
	const intentInput = await ctx.ui.input("Autoresearch Intent", defaultIntent);
	if (intentInput === undefined) return undefined;
	const intent = intentInput.trim();
	if (intent.length === 0) {
		ctx.ui.notify("Autoresearch intent is required", "info");
		return undefined;
	}

	const benchmarkCommandInput = await ctx.ui.input("Benchmark Command", "bash autoresearch.sh");
	if (benchmarkCommandInput === undefined) return undefined;
	const benchmarkCommand = benchmarkCommandInput.trim();
	if (benchmarkCommand.length === 0) {
		ctx.ui.notify("Benchmark command is required", "info");
		return undefined;
	}
	if (!isAutoresearchShCommand(benchmarkCommand)) {
		ctx.ui.notify("Benchmark command must invoke `autoresearch.sh` directly", "info");
		return undefined;
	}

	const metricNameInput = await ctx.ui.input("Primary Metric Name", "runtime_ms");
	if (metricNameInput === undefined) return undefined;
	const metricName = metricNameInput.trim();
	if (metricName.length === 0) {
		ctx.ui.notify("Primary metric name is required", "info");
		return undefined;
	}

	const metricUnitInput = await ctx.ui.input("Metric Unit", "ms");
	if (metricUnitInput === undefined) return undefined;
	const metricUnit = metricUnitInput.trim();

	const directionInput = await ctx.ui.input("Metric Direction", "lower");
	if (directionInput === undefined) return undefined;
	const normalizedDirection = directionInput.trim().toLowerCase();
	if (normalizedDirection !== "lower" && normalizedDirection !== "higher") {
		ctx.ui.notify("Metric direction must be `lower` or `higher`", "info");
		return undefined;
	}

	const secondaryMetricsInput = await ctx.ui.input("Tradeoff Metrics", "");
	if (secondaryMetricsInput === undefined) return undefined;

	const scopePathsInput = await ctx.ui.input("Files in Scope", "packages/coding-agent/src/autoresearch");
	if (scopePathsInput === undefined) return undefined;
	const scopePaths = splitSetupList(scopePathsInput);
	if (scopePaths.length === 0) {
		ctx.ui.notify("Files in Scope must include at least one path", "info");
		return undefined;
	}

	const offLimitsInput = await ctx.ui.input("Off Limits", "");
	if (offLimitsInput === undefined) return undefined;
	const constraintsInput = await ctx.ui.input("Constraints", "");
	if (constraintsInput === undefined) return undefined;

	return {
		intent,
		benchmarkCommand,
		metricName,
		metricUnit,
		direction: normalizedDirection,
		secondaryMetrics: splitSetupList(secondaryMetricsInput),
		scopePaths,
		offLimits: splitSetupList(offLimitsInput),
		constraints: splitSetupList(constraintsInput),
	};
}

function splitSetupList(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map(entry => entry.trim())
		.filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

function formatBulletBlock(values: string[], renderValue: (value: string) => string, emptyValue = ""): string {
	if (values.length === 0) {
		return emptyValue;
	}
	return values.map(renderValue).join("\n");
}

function hasLocalAutoresearchState(workDir: string): boolean {
	return fs.existsSync(path.join(workDir, "autoresearch.jsonl")) || fs.existsSync(path.join(workDir, ".autoresearch"));
}

function summarizeExperimentAsi(result: ExperimentResult): string | null {
	const hypothesis = typeof result.asi?.hypothesis === "string" ? result.asi.hypothesis.trim() : "";
	const rollbackReason = typeof result.asi?.rollback_reason === "string" ? result.asi.rollback_reason.trim() : "";
	const nextActionHint = typeof result.asi?.next_action_hint === "string" ? result.asi.next_action_hint.trim() : "";
	const summary = [hypothesis, rollbackReason, nextActionHint].filter(part => part.length > 0).join(" | ");
	return summary.length > 0 ? summary.slice(0, 220) : null;
}

function getGuardedToolPaths(toolName: string, input: Record<string, unknown>): string[] | null {
	if (toolName === "write") {
		return typeof input.path === "string" ? [input.path] : null;
	}
	if (toolName === "ast_edit") {
		return typeof input.path === "string" ? [input.path] : null;
	}
	if (toolName !== "edit") {
		return [];
	}

	const paths: string[] = [];
	if (typeof input.path === "string") {
		paths.push(input.path);
	}
	if (typeof input.rename === "string") {
		paths.push(input.rename);
	}
	if (typeof input.move === "string") {
		paths.push(input.move);
	}
	return paths;
}

function resolveAutoresearchRelativePath(
	workDir: string,
	rawPath: string,
): { ok: false; reason: string } | { ok: true; relativePath: string } {
	if (looksLikeInternalUrl(rawPath)) {
		return {
			ok: false,
			reason: `Autoresearch cannot validate internal URL paths during scoped editing: ${rawPath}`,
		};
	}
	const resolvedPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(workDir, rawPath);
	const canonicalWorkDir = canonicalizeExistingPath(workDir);
	const canonicalTargetPath = canonicalizeTargetPath(resolvedPath);
	const relativePath = path.relative(canonicalWorkDir, canonicalTargetPath);
	if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
		return {
			ok: false,
			reason: `Autoresearch blocked edits outside the working tree: ${rawPath}`,
		};
	}
	return {
		ok: true,
		relativePath: relativePath.length === 0 ? "." : normalizeAutoresearchPath(relativePath),
	};
}

function validateEditableAutoresearchPath(relativePath: string, runtime: AutoresearchRuntime): string | null {
	if (isAutoresearchLocalStatePath(relativePath)) {
		return "autoresearch local state files are managed by the experiment tools and cannot be edited directly";
	}
	if (runtime.state.offLimits.some(spec => pathMatchesContractPath(relativePath, spec))) {
		return "this path is listed under Off Limits in autoresearch.md";
	}
	if (isAutoresearchCommittableFile(relativePath)) {
		return null;
	}
	if (runtime.state.scopePaths.length === 0) {
		return "Files in Scope is not initialized yet; only autoresearch control files may be edited before init_experiment runs";
	}
	if (!runtime.state.scopePaths.some(spec => pathMatchesContractPath(relativePath, spec))) {
		return "this path is outside Files in Scope in autoresearch.md";
	}
	return null;
}

function findBestResult(runtime: AutoresearchRuntime): ExperimentResult | null {
	let best: ExperimentResult | null = null;
	for (const result of runtime.state.results) {
		if (result.segment !== runtime.state.currentSegment || result.status !== "keep") continue;
		if (!best) {
			best = result;
			continue;
		}
		if (runtime.state.bestDirection === "lower" ? result.metric < best.metric : result.metric > best.metric) {
			best = result;
		}
	}
	return best;
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

function summaryToChecks(summary: PendingRunSummary | null): ChecksResult | null {
	if (!summary || summary.checksPass === null) {
		return null;
	}
	return {
		pass: summary.checksPass,
		output: "",
		duration: summary.checksDurationSeconds ?? 0,
	};
}

function looksLikeInternalUrl(value: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function canonicalizeExistingPath(targetPath: string): string {
	try {
		return fs.realpathSync.native(targetPath);
	} catch {
		return path.resolve(targetPath);
	}
}

function canonicalizeTargetPath(targetPath: string): string {
	const pendingSegments: string[] = [];
	let currentPath = path.resolve(targetPath);
	while (!fs.existsSync(currentPath)) {
		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) {
			return currentPath;
		}
		pendingSegments.unshift(path.basename(currentPath));
		currentPath = parentPath;
	}
	return path.resolve(canonicalizeExistingPath(currentPath), ...pendingSegments);
}

function validateAutoresearchBashCommand(command: string): string | null {
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const mutationPatterns = [
		/(^|[;&|()]\s*)(?:bash|sh)\b/,
		/(^|[;&|()]\s*)(?:python|python3|node|perl|ruby|php)\b/,
		/(^|[;&|()]\s*)(?:mv|cp|rm|mkdir|touch|chmod|chown|ln|install|patch)\b/,
		/(^|[;&|()]\s*)sed\s+-i\b/,
		/(^|[;&|()]\s*)git\s+(?:add|apply|checkout|clean|commit|merge|rebase|reset|restore|revert|stash|switch|worktree)\b/,
		/(^|[^<])>>?/,
		/\|\s*tee\b/,
		/<<<?/,
	];
	if (mutationPatterns.some(pattern => pattern.test(trimmed))) {
		return (
			"Autoresearch only allows read-only shell inspection. " +
			"Use write/edit/ast_edit for file changes and run_experiment for benchmark execution."
		);
	}
	return null;
}
