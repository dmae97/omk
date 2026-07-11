import { joinPathSegments, normalizePathSlashes, pathSegmentsOverlap } from "./path-segments.ts";

/** Tool names that must never run concurrently with other tool calls in a batch. */
export const NEVER_PARALLEL_TOOLS = new Set<string>(["clarify"]);

/** Read-only tools with no shared mutable session state (OMK built-in / harness). */
export const PARALLEL_SAFE_TOOLS = new Set<string>([
	"grep",
	"find",
	"ls",
	"read",
	"search_files",
	"session_search",
	"skill_view",
	"skills_list",
	"vision_analyze",
	"web_extract",
	"web_search",
]);

/** File tools that may run concurrently when they target independent paths. */
export const PATH_SCOPED_TOOLS = new Set<string>(["read", "write", "edit"]);

export type ParallelizableToolCall = {
	name: string;
	arguments: Record<string, unknown>;
};

export type ToolParallelPolicy = "sequential" | "parallel";

export type ShouldParallelizeToolBatchOptions = {
	cwd?: string;
	/** Per-tool executionMode from AgentTool definitions (extension/custom tools). */
	toolPolicies?: ReadonlyMap<string, ToolParallelPolicy>;
	/**
	 * When a tool name is not in built-in parallel/path sets and has no explicit policy,
	 * return true to allow parallel batching (e.g. test harness tools with executionMode=parallel).
	 */
	allowUnknownParallel?: (toolName: string) => boolean;
};

const DESTRUCTIVE_COMMAND =
	/(?:^|\s|&&|\|\||;|`)(?:rm\s|rmdir\s|mv\s|sed\s+-i|truncate\s|dd\s|shred\s|git\s+(?:reset|clean|checkout)\s)/;
const REDIRECT_OVERWRITE = /[^>]>[^>]|^>[^>]/;

export function isDestructiveBashCommand(command: string): boolean {
	if (!command) {
		return false;
	}
	if (DESTRUCTIVE_COMMAND.test(command)) {
		return true;
	}
	if (REDIRECT_OVERWRITE.test(command)) {
		return true;
	}
	return false;
}

export function extractParallelScopePath(
	toolName: string,
	functionArgs: Record<string, unknown>,
	cwd: string = process.cwd(),
): string | null {
	if (!PATH_SCOPED_TOOLS.has(toolName)) {
		return null;
	}
	const rawPath = functionArgs.path;
	if (typeof rawPath !== "string" || !rawPath.trim()) {
		return null;
	}
	const expanded = normalizePathSlashes(
		rawPath.startsWith("~") ? rawPath.replace(/^~/, process.env.HOME ?? "") : rawPath,
	);
	if (expanded.startsWith("/")) {
		return expanded;
	}
	return joinPathSegments(cwd, expanded);
}

/** True when two normalized paths may refer to the same file or subtree. */
export function pathsOverlap(left: string, right: string): boolean {
	return pathSegmentsOverlap(left, right);
}

/**
 * Return true when a tool-call batch is safe to run concurrently (Hermes-style policy, OMK tool names).
 */
export function shouldParallelizeToolBatch(
	toolCalls: ParallelizableToolCall[],
	options: ShouldParallelizeToolBatchOptions = {},
): boolean {
	if (toolCalls.length <= 1) {
		return false;
	}

	const cwd = options.cwd;
	const toolPolicies = options.toolPolicies;
	const allowUnknownParallel = options.allowUnknownParallel;

	const toolNames = toolCalls.map((tc) => tc.name);
	if (toolNames.some((name) => NEVER_PARALLEL_TOOLS.has(name))) {
		return false;
	}

	for (const name of toolNames) {
		if (toolPolicies?.get(name) === "sequential") {
			return false;
		}
	}

	const bashCount = toolNames.filter((name) => name === "bash").length;
	if (bashCount >= 2) {
		return false;
	}

	const reservedPaths: string[] = [];

	for (const toolCall of toolCalls) {
		const toolName = toolCall.name;
		const functionArgs = toolCall.arguments;
		if (!functionArgs || typeof functionArgs !== "object" || Array.isArray(functionArgs)) {
			return false;
		}

		if (toolName === "bash") {
			const command = functionArgs.command;
			if (typeof command !== "string") {
				return false;
			}
			if (isDestructiveBashCommand(command)) {
				return false;
			}
			// bash is not parallel-safe with any other tool in the batch
			if (toolCalls.length > 1) {
				return false;
			}
			continue;
		}

		if (PATH_SCOPED_TOOLS.has(toolName)) {
			const scopedPath = extractParallelScopePath(toolName, functionArgs, cwd);
			if (scopedPath === null) {
				return false;
			}
			if (reservedPaths.some((existing) => pathsOverlap(scopedPath, existing))) {
				return false;
			}
			reservedPaths.push(scopedPath);
			continue;
		}

		if (PARALLEL_SAFE_TOOLS.has(toolName)) {
			continue;
		}

		if (toolPolicies?.get(toolName) === "parallel" || allowUnknownParallel?.(toolName)) {
			continue;
		}

		return false;
	}

	return true;
}
