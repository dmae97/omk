import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import type { PromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import type { Skill } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { logger } from "@oh-my-pi/pi-utils";
import type { BashInterceptorRule } from "../config/settings-manager";
import type { InternalUrlRouter } from "../internal-urls";
import { getPreludeDocs, warmPythonEnvironment } from "../ipy/executor";
import { checkPythonKernelAvailability } from "../ipy/kernel";
import { LspTool } from "../lsp";
import { EditTool } from "../patch";
import type { PlanModeState } from "../plan-mode/state";
import type { ArtifactManager } from "../session/artifacts";
import { TaskTool } from "../task";
import type { AgentOutputManager } from "../task/output-manager";
import type { EventBus } from "../utils/event-bus";
import { time } from "../utils/timings";
import { WebSearchTool } from "../web/search";
import { AskTool } from "./ask";
import { BashTool } from "./bash";
import { CalculatorTool } from "./calculator";
import { CompleteTool } from "./complete";
import { EnterPlanModeTool } from "./enter-plan-mode";
import { ExitPlanModeTool } from "./exit-plan-mode";
import { FetchTool } from "./fetch";
import { FindTool } from "./find";
import { GrepTool } from "./grep";
import { LsTool } from "./ls";
import { NotebookTool } from "./notebook";
import { wrapToolsWithMetaNotice } from "./output-meta";
import { PythonTool } from "./python";
import { ReadTool } from "./read";
import { reportFindingTool } from "./review";
import { loadSshTool } from "./ssh";
import { TodoWriteTool } from "./todo-write";
import { WriteTool } from "./write";

// Exa MCP tools (22 tools)

export { exaTools } from "../exa";
export type { ExaRenderDetails, ExaSearchResponse, ExaSearchResult } from "../exa/types";
export {
	type FileDiagnosticsResult,
	type FileFormatResult,
	getLspStatus,
	type LspServerStatus,
	LspTool,
	type LspToolDetails,
	type LspWarmupOptions,
	type LspWarmupResult,
	warmupLspServers,
} from "../lsp";
export { EditTool, type EditToolDetails } from "../patch";
export { BUNDLED_AGENTS, TaskTool } from "../task";
export {
	companyWebSearchTools,
	exaWebSearchTools,
	getWebSearchTools,
	hasExaWebSearch,
	linkedinWebSearchTools,
	setPreferredWebSearchProvider,
	type WebSearchProvider,
	type WebSearchResponse,
	WebSearchTool,
	type WebSearchToolsOptions,
	webSearchCodeContextTool,
	webSearchCompanyTool,
	webSearchCrawlTool,
	webSearchCustomTool,
	webSearchDeepTool,
	webSearchLinkedinTool,
} from "../web/search";
export { AskTool, type AskToolDetails } from "./ask";
export { BashTool, type BashToolDetails, type BashToolOptions } from "./bash";
export { CalculatorTool, type CalculatorToolDetails } from "./calculator";
export { CompleteTool } from "./complete";
export { type EnterPlanModeDetails, EnterPlanModeTool } from "./enter-plan-mode";
export { type ExitPlanModeDetails, ExitPlanModeTool } from "./exit-plan-mode";
export { FetchTool, type FetchToolDetails } from "./fetch";
export { type FindOperations, FindTool, type FindToolDetails, type FindToolOptions } from "./find";
export { setPreferredImageProvider } from "./gemini-image";
export { type GrepOperations, GrepTool, type GrepToolDetails, type GrepToolOptions } from "./grep";
export { type LsOperations, LsTool, type LsToolDetails, type LsToolOptions } from "./ls";
export { NotebookTool, type NotebookToolDetails } from "./notebook";
export { PythonTool, type PythonToolDetails, type PythonToolOptions } from "./python";
export { ReadTool, type ReadToolDetails } from "./read";
export { reportFindingTool, type SubmitReviewDetails } from "./review";
export { loadSshTool, type SSHToolDetails, SshTool } from "./ssh";
export { type TodoItem, TodoWriteTool, type TodoWriteToolDetails } from "./todo-write";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate";
export { WriteTool, type WriteToolDetails } from "./write";

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any, any, any>;

export type ContextFileEntry = {
	path: string;
	content: string;
	depth?: number;
};

/** Session context for tool factories */
export interface ToolSession {
	/** Current working directory */
	cwd: string;
	/** Whether UI is available */
	hasUI: boolean;
	/** Skip Python kernel availability check and warmup */
	skipPythonPreflight?: boolean;
	/** Pre-loaded context files (AGENTS.md, etc) */
	contextFiles?: ContextFileEntry[];
	/** Pre-loaded skills */
	skills?: Skill[];
	/** Pre-loaded prompt templates */
	promptTemplates?: PromptTemplate[];
	/** Whether LSP integrations are enabled */
	enableLsp?: boolean;
	/** Event bus for tool/extension communication */
	eventBus?: EventBus;
	/** Output schema for structured completion (subagents) */
	outputSchema?: unknown;
	/** Whether to include the complete tool by default */
	requireCompleteTool?: boolean;
	/** Get session file */
	getSessionFile: () => string | null;
	/** Get session ID */
	getSessionId?: () => string | null;
	/** Cached artifact manager (allocated per ToolSession) */
	artifactManager?: ArtifactManager;
	/** Get artifacts directory for artifact:// URLs and $ARTIFACTS env var */
	getArtifactsDir?: () => string | null;
	/** Get session spawns */
	getSessionSpawns: () => string | null;
	/** Get resolved model string if explicitly set for this session */
	getModelString?: () => string | undefined;
	/** Get the current session model string, regardless of how it was chosen */
	getActiveModelString?: () => string | undefined;
	/** Auth storage for passing to subagents (avoids re-discovery) */
	authStorage?: import("@oh-my-pi/pi-coding-agent/session/auth-storage").AuthStorage;
	/** Model registry for passing to subagents (avoids re-discovery) */
	modelRegistry?: import("@oh-my-pi/pi-coding-agent/config/model-registry").ModelRegistry;
	/** MCP manager for proxying MCP calls through parent */
	mcpManager?: import("../mcp/manager").MCPManager;
	/** Internal URL router for agent:// and skill:// URLs */
	internalRouter?: InternalUrlRouter;
	/** Agent output manager for unique agent:// IDs across task invocations */
	agentOutputManager?: AgentOutputManager;
	/** Settings manager for passing to subagents (avoids SQLite access in workers) */
	settingsManager?: {
		serialize: () => import("@oh-my-pi/pi-coding-agent/config/settings-manager").Settings;
		getPlansDirectory: (cwd?: string) => string;
	};
	/** Settings manager (optional) */
	settings?: {
		getImageAutoResize(): boolean;
		getReadLineNumbers?(): boolean;
		getLspFormatOnWrite(): boolean;
		getLspDiagnosticsOnWrite(): boolean;
		getLspDiagnosticsOnEdit(): boolean;
		getEditFuzzyMatch(): boolean;
		getEditFuzzyThreshold?(): number;
		getEditPatchMode?(): boolean;
		getBashInterceptorEnabled(): boolean;
		getBashInterceptorSimpleLsEnabled(): boolean;
		getBashInterceptorRules(): BashInterceptorRule[];
		getPythonToolMode?(): "ipy-only" | "bash-only" | "both";
		getPythonKernelMode?(): "session" | "per-call";
		getPythonSharedGateway?(): boolean;
	};
	/** Plan mode state (if active) */
	getPlanModeState?: () => PlanModeState | undefined;
}

type ToolFactory = (session: ToolSession) => Tool | null | Promise<Tool | null>;

export const BUILTIN_TOOLS: Record<string, ToolFactory> = {
	ask: AskTool.createIf,
	bash: s => new BashTool(s),
	python: s => new PythonTool(s),
	calc: s => new CalculatorTool(s),
	ssh: loadSshTool,
	edit: s => new EditTool(s),
	find: s => new FindTool(s),
	grep: s => new GrepTool(s),
	ls: s => new LsTool(s),
	lsp: LspTool.createIf,
	notebook: s => new NotebookTool(s),
	read: s => new ReadTool(s),
	task: TaskTool.create,
	todo_write: s => new TodoWriteTool(s),
	fetch: s => new FetchTool(s),
	web_search: s => new WebSearchTool(s),
	write: s => new WriteTool(s),
	enter_plan_mode: s => new EnterPlanModeTool(s),
};

export const HIDDEN_TOOLS: Record<string, ToolFactory> = {
	complete: s => new CompleteTool(s),
	report_finding: () => reportFindingTool,
	exit_plan_mode: s => new ExitPlanModeTool(s),
};

export type ToolName = keyof typeof BUILTIN_TOOLS;

export type PythonToolMode = "ipy-only" | "bash-only" | "both";

/**
 * Parse OMP_PY environment variable to determine Python tool mode.
 * Returns null if not set or invalid.
 *
 * Values:
 * - "0" or "bash" → bash-only
 * - "1" or "py" → ipy-only
 * - "mix" or "both" → both
 */
function getPythonModeFromEnv(): PythonToolMode | null {
	const value = process.env.OMP_PY?.toLowerCase();
	if (!value) return null;

	switch (value) {
		case "0":
		case "bash":
			return "bash-only";
		case "1":
		case "py":
			return "ipy-only";
		case "mix":
		case "both":
			return "both";
		default:
			return null;
	}
}

/**
 * Create tools from BUILTIN_TOOLS registry.
 */
export async function createTools(session: ToolSession, toolNames?: string[]): Promise<Tool[]> {
	time("createTools:start");
	const includeComplete = session.requireCompleteTool === true;
	const enableLsp = session.enableLsp ?? true;
	const requestedTools = toolNames && toolNames.length > 0 ? [...new Set(toolNames)] : undefined;
	if (requestedTools && !requestedTools.includes("exit_plan_mode")) {
		requestedTools.push("exit_plan_mode");
	}
	const pythonMode = getPythonModeFromEnv() ?? session.settings?.getPythonToolMode?.() ?? "ipy-only";
	const skipPythonPreflight = session.skipPythonPreflight === true;
	let pythonAvailable = true;
	const shouldCheckPython =
		!skipPythonPreflight &&
		pythonMode !== "bash-only" &&
		(requestedTools === undefined || requestedTools.includes("python"));
	const isTestEnv = process.env.BUN_ENV === "test" || process.env.NODE_ENV === "test";
	const skipPythonWarm = isTestEnv || process.env.OMP_PYTHON_SKIP_CHECK === "1";
	if (shouldCheckPython) {
		const availability = await checkPythonKernelAvailability(session.cwd);
		time("createTools:pythonCheck");
		pythonAvailable = availability.ok;
		if (!availability.ok) {
			logger.warn("Python kernel unavailable, falling back to bash", {
				reason: availability.reason,
			});
		} else if (!skipPythonWarm && getPreludeDocs().length === 0) {
			const sessionFile = session.getSessionFile?.() ?? undefined;
			const warmSessionId = sessionFile ? `session:${sessionFile}:cwd:${session.cwd}` : `cwd:${session.cwd}`;
			try {
				await warmPythonEnvironment(session.cwd, warmSessionId, session.settings?.getPythonSharedGateway?.());
				time("createTools:warmPython");
			} catch (err) {
				logger.warn("Failed to warm Python environment", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	const effectiveMode = pythonAvailable ? pythonMode : "bash-only";
	const allowBash = effectiveMode !== "ipy-only";
	const allowPython = effectiveMode !== "bash-only";
	if (
		requestedTools &&
		allowBash &&
		!allowPython &&
		requestedTools.includes("python") &&
		!requestedTools.includes("bash")
	) {
		requestedTools.push("bash");
	}
	const allTools: Record<string, ToolFactory> = { ...BUILTIN_TOOLS, ...HIDDEN_TOOLS };
	const isToolAllowed = (name: string) => {
		if (name === "lsp") return enableLsp;
		if (name === "bash") return allowBash;
		if (name === "python") return allowPython;
		return true;
	};
	if (includeComplete && requestedTools && !requestedTools.includes("complete")) {
		requestedTools.push("complete");
	}

	const filteredRequestedTools = requestedTools?.filter(name => name in allTools && isToolAllowed(name));

	const entries =
		filteredRequestedTools !== undefined
			? filteredRequestedTools.map(name => [name, allTools[name]] as const)
			: [
					...Object.entries(BUILTIN_TOOLS).filter(([name]) => isToolAllowed(name)),
					...(includeComplete ? ([["complete", HIDDEN_TOOLS.complete]] as const) : []),
					...([["exit_plan_mode", HIDDEN_TOOLS.exit_plan_mode]] as const),
				];
	time("createTools:beforeFactories");
	const slowTools: Array<{ name: string; ms: number }> = [];
	const results = await Promise.all(
		entries.map(async ([name, factory]) => {
			const start = performance.now();
			const tool = await factory(session);
			const elapsed = performance.now() - start;
			if (elapsed > 5) {
				slowTools.push({ name, ms: Math.round(elapsed) });
			}
			return { name, tool };
		}),
	);
	time("createTools:afterFactories");
	if (slowTools.length > 0 && process.env.OMP_TIMING === "1") {
		logger.debug("Tool factory timings", { slowTools });
	}
	const tools = results.filter(r => r.tool !== null).map(r => r.tool as Tool);
	const wrappedTools = wrapToolsWithMetaNotice(tools);

	if (filteredRequestedTools !== undefined) {
		const allowed = new Set(filteredRequestedTools);
		return wrappedTools.filter(tool => allowed.has(tool.name));
	}

	return wrappedTools;
}
