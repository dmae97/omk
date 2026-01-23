// Exa MCP tools (22 tools)
export { exaTools } from "$c/exa/index";
export type { ExaRenderDetails, ExaSearchResponse, ExaSearchResult } from "$c/exa/types";
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
} from "$c/lsp/index";
export { EditTool, type EditToolDetails } from "$c/patch";
export { BUNDLED_AGENTS, TaskTool } from "$c/task/index";
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
} from "$c/web/search/index";
export { AskTool, type AskToolDetails } from "./ask";
export { BashTool, type BashToolDetails, type BashToolOptions } from "./bash";
export { CalculatorTool, type CalculatorToolDetails } from "./calculator";
export { CompleteTool } from "./complete";
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

import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { logger } from "@oh-my-pi/pi-utils";
import type { BashInterceptorRule } from "$c/config/settings-manager";
import type { InternalUrlRouter } from "$c/internal-urls";
import { getPreludeDocs, warmPythonEnvironment } from "$c/ipy/executor";
import { checkPythonKernelAvailability } from "$c/ipy/kernel";
import { LspTool } from "$c/lsp/index";
import { EditTool } from "$c/patch";
import type { ArtifactManager } from "$c/session/artifacts";
import { TaskTool } from "$c/task/index";
import type { EventBus } from "$c/utils/event-bus";
import { WebSearchTool } from "$c/web/search/index";
import { AskTool } from "./ask";
import { BashTool } from "./bash";
import { CalculatorTool } from "./calculator";
import { CompleteTool } from "./complete";
import { FetchTool } from "./fetch";
import { FindTool } from "./find";
import { GrepTool } from "./grep";
import { LsTool } from "./ls";
import { NotebookTool } from "./notebook";
import { PythonTool } from "./python";
import { ReadTool } from "./read";
import { reportFindingTool } from "./review";
import { loadSshTool } from "./ssh";
import { TodoWriteTool } from "./todo-write";
import { WriteTool } from "./write";

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any, any, any>;

/** Session context for tool factories */
export interface ToolSession {
	/** Current working directory */
	cwd: string;
	/** Whether UI is available */
	hasUI: boolean;
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
	authStorage?: import("$c/session/auth-storage").AuthStorage;
	/** Model registry for passing to subagents (avoids re-discovery) */
	modelRegistry?: import("$c/config/model-registry").ModelRegistry;
	/** MCP manager for proxying MCP calls through parent */
	mcpManager?: import("../mcp/manager").MCPManager;
	/** Internal URL router for agent:// and skill:// URLs */
	internalRouter?: InternalUrlRouter;
	/** Settings manager for passing to subagents (avoids SQLite access in workers) */
	settingsManager?: { serialize: () => import("$c/config/settings-manager").Settings };
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
}

type ToolFactory = (session: ToolSession) => Tool | null | Promise<Tool | null>;

export const BUILTIN_TOOLS: Record<string, ToolFactory> = {
	ask: AskTool.createIf,
	bash: (s) => new BashTool(s),
	python: (s) => new PythonTool(s),
	calc: (s) => new CalculatorTool(s),
	ssh: loadSshTool,
	edit: (s) => new EditTool(s),
	find: (s) => new FindTool(s),
	grep: (s) => new GrepTool(s),
	ls: (s) => new LsTool(s),
	lsp: LspTool.createIf,
	notebook: (s) => new NotebookTool(s),
	read: (s) => new ReadTool(s),
	task: TaskTool.create,
	todo_write: (s) => new TodoWriteTool(s),
	fetch: (s) => new FetchTool(s),
	web_search: (s) => new WebSearchTool(s),
	write: (s) => new WriteTool(s),
};

export const HIDDEN_TOOLS: Record<string, ToolFactory> = {
	complete: (s) => new CompleteTool(s),
	report_finding: () => reportFindingTool,
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
	const includeComplete = session.requireCompleteTool === true;
	const enableLsp = session.enableLsp ?? true;
	const requestedTools = toolNames && toolNames.length > 0 ? [...new Set(toolNames)] : undefined;
	const pythonMode = getPythonModeFromEnv() ?? session.settings?.getPythonToolMode?.() ?? "ipy-only";
	let pythonAvailable = true;
	const shouldCheckPython =
		pythonMode !== "bash-only" &&
		(requestedTools === undefined || requestedTools.includes("python") || pythonMode === "ipy-only");
	const isTestEnv = process.env.BUN_ENV === "test" || process.env.NODE_ENV === "test";
	if (shouldCheckPython) {
		const availability = await checkPythonKernelAvailability(session.cwd);
		pythonAvailable = availability.ok;
		if (!availability.ok) {
			logger.warn("Python kernel unavailable, falling back to bash", {
				reason: availability.reason,
			});
		} else if (!isTestEnv && getPreludeDocs().length === 0) {
			const sessionFile = session.getSessionFile?.() ?? undefined;
			const warmSessionId = sessionFile ? `session:${sessionFile}:cwd:${session.cwd}` : `cwd:${session.cwd}`;
			try {
				await warmPythonEnvironment(session.cwd, warmSessionId, session.settings?.getPythonSharedGateway?.());
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

	const filteredRequestedTools = requestedTools?.filter((name) => name in allTools && isToolAllowed(name));

	const entries =
		filteredRequestedTools !== undefined
			? filteredRequestedTools.map((name) => [name, allTools[name]] as const)
			: [
					...Object.entries(BUILTIN_TOOLS).filter(([name]) => isToolAllowed(name)),
					...(includeComplete ? ([["complete", HIDDEN_TOOLS.complete]] as const) : []),
				];
	const results = await Promise.all(entries.map(([, factory]) => factory(session)));
	const tools = results.filter((t): t is Tool => t !== null);

	if (filteredRequestedTools !== undefined) {
		const allowed = new Set(filteredRequestedTools);
		return tools.filter((tool) => allowed.has(tool.name));
	}

	return tools;
}
