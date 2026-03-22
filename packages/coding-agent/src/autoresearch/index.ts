import * as fs from "node:fs";
import * as path from "node:path";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { ExtensionContext, ExtensionFactory } from "../extensibility/extensions";
import commandInitializeTemplate from "./command-initialize.md" with { type: "text" };
import commandResumeTemplate from "./command-resume.md" with { type: "text" };
import { createDashboardController } from "./dashboard";
import { readMaxExperiments, resolveWorkDir, validateWorkDir } from "./helpers";
import promptTemplate from "./prompt.md" with { type: "text" };
import resumeMessageTemplate from "./resume-message.md" with { type: "text" };
import {
	cloneExperimentState,
	createExperimentState,
	createRuntimeStore,
	reconstructControlState,
	reconstructStateFromJsonl,
} from "./state";
import { createInitExperimentTool } from "./tools/init-experiment";
import { createLogExperimentTool } from "./tools/log-experiment";
import { createRunExperimentTool } from "./tools/run-experiment";
import type { AutoresearchRuntime } from "./types";

const AUTORESUME_INTERVAL_MS = 5 * 60 * 1000;
const MAX_AUTORESUME_TURNS = 20;
const EXPERIMENT_TOOL_NAMES = ["init_experiment", "run_experiment", "log_experiment"];

export const createAutoresearchExtension: ExtensionFactory = api => {
	const runtimeStore = createRuntimeStore();
	const dashboard = createDashboardController();

	const getSessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();
	const getRuntime = (ctx: ExtensionContext): AutoresearchRuntime => runtimeStore.ensure(getSessionKey(ctx));

	const rehydrate = async (ctx: ExtensionContext): Promise<void> => {
		const runtime = getRuntime(ctx);
		const workDir = resolveWorkDir(ctx.cwd);
		const reconstructed = reconstructStateFromJsonl(workDir);
		const control = reconstructControlState(ctx.sessionManager.getEntries());
		runtime.state = cloneExperimentState(reconstructed.state);
		runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
		runtime.goal = control.goal;
		runtime.autoresearchMode = control.autoresearchMode;
		runtime.lastAutoResumeTime = 0;
		runtime.experimentsThisSession = 0;
		runtime.autoResumeTurns = 0;
		runtime.lastRunChecks = null;
		runtime.lastRunDuration = null;
		runtime.lastRunAsi = null;
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
		runtime.goal = goal;
		api.appendEntry("autoresearch-control", goal ? { mode, goal } : { mode });
	};

	api.registerTool(createInitExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createRunExperimentTool({ dashboard, getRuntime, pi: api }));
	api.registerTool(createLogExperimentTool({ dashboard, getRuntime, pi: api }));

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
				runtime.experimentsThisSession = 0;
				runtime.autoResumeTurns = 0;
				dashboard.updateWidget(ctx, runtime);
				const experimentTools = new Set(EXPERIMENT_TOOL_NAMES);
				await api.setActiveTools(api.getActiveTools().filter(name => !experimentTools.has(name)));
				ctx.ui.notify("Autoresearch mode disabled", "info");
				return;
			}
			if (trimmed === "clear") {
				const workDir = resolveWorkDir(ctx.cwd);
				const jsonlPath = path.join(workDir, "autoresearch.jsonl");
				if (fs.existsSync(jsonlPath)) {
					fs.rmSync(jsonlPath);
				}
				runtime.state = createExperimentState();
				runtime.state.maxExperiments = readMaxExperiments(ctx.cwd);
				runtime.goal = null;
				setMode(ctx, false, null, "clear");
				dashboard.updateWidget(ctx, runtime);
				const experimentTools = new Set(EXPERIMENT_TOOL_NAMES);
				await api.setActiveTools(api.getActiveTools().filter(name => !experimentTools.has(name)));
				ctx.ui.notify("Autoresearch log cleared", "info");
				return;
			}

			const workDir = resolveWorkDir(ctx.cwd);
			const autoresearchMdPath = path.join(workDir, "autoresearch.md");
			const hasAutoresearchMd = fs.existsSync(autoresearchMdPath);

			if (hasAutoresearchMd) {
				setMode(ctx, true, runtime.goal, "on");
				runtime.experimentsThisSession = 0;
				runtime.autoResumeTurns = 0;
				dashboard.updateWidget(ctx, runtime);
				await api.setActiveTools([...new Set([...api.getActiveTools(), ...EXPERIMENT_TOOL_NAMES])]);
				api.sendUserMessage(
					renderPromptTemplate(commandResumeTemplate, {
						autoresearch_md_path: autoresearchMdPath,
					}),
				);
				return;
			}

			const intentInput = await ctx.ui.input(
				"Autoresearch Intent",
				trimmed || runtime.goal || "what should autoresearch improve?",
			);
			if (intentInput === undefined) return;

			const intent = intentInput.trim();
			if (intent.length === 0) {
				ctx.ui.notify("Autoresearch intent is required", "info");
				return;
			}

			setMode(ctx, true, intent, "on");
			runtime.experimentsThisSession = 0;
			runtime.autoResumeTurns = 0;
			dashboard.updateWidget(ctx, runtime);
			await api.setActiveTools([...new Set([...api.getActiveTools(), ...EXPERIMENT_TOOL_NAMES])]);
			api.sendUserMessage(renderPromptTemplate(commandInitializeTemplate, { intent }));
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

	api.on("agent_start", (_event, ctx) => {
		getRuntime(ctx).experimentsThisSession = 0;
	});

	api.on("agent_end", (_event, ctx) => {
		const runtime = getRuntime(ctx);
		runtime.runningExperiment = null;
		dashboard.updateWidget(ctx, runtime);
		dashboard.requestRender();
		if (!runtime.autoresearchMode) return;
		if (runtime.experimentsThisSession === 0) return;
		if (runtime.autoResumeTurns >= MAX_AUTORESUME_TURNS) return;
		const now = Date.now();
		if (now - runtime.lastAutoResumeTime < AUTORESUME_INTERVAL_MS) return;
		runtime.lastAutoResumeTime = now;
		runtime.autoResumeTurns += 1;
		const workDir = resolveWorkDir(ctx.cwd);
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		api.sendUserMessage(
			renderPromptTemplate(resumeMessageTemplate, {
				has_ideas: fs.existsSync(ideasPath),
			}),
			{ deliverAs: "followUp" },
		);
	});

	api.on("before_agent_start", (event, ctx) => {
		const runtime = getRuntime(ctx);
		if (!runtime.autoresearchMode) return;
		const workDir = resolveWorkDir(ctx.cwd);
		const autoresearchMdPath = path.join(workDir, "autoresearch.md");
		const checksPath = path.join(workDir, "autoresearch.checks.sh");
		const ideasPath = path.join(workDir, "autoresearch.ideas.md");
		return {
			systemPrompt: renderPromptTemplate(promptTemplate, {
				base_system_prompt: event.systemPrompt,
				goal: runtime.goal ?? event.prompt,
				working_dir: workDir,
				default_metric_name: runtime.state.metricName,
				has_autoresearch_md: fs.existsSync(autoresearchMdPath),
				autoresearch_md_path: autoresearchMdPath,
				has_checks: fs.existsSync(checksPath),
				checks_path: checksPath,
				has_ideas: fs.existsSync(ideasPath),
				ideas_path: ideasPath,
			}),
		};
	});
};
