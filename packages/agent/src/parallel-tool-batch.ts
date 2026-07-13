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

type ToolCallKind = "solo" | "safe" | "path";

/**
 * Classify one tool call for wave scheduling. "solo" calls run alone in their
 * own wave (fail closed): clarify-style tools, sequential-policy tools, bash
 * (never parallel-safe with any other call), invalid argument shapes, and
 * unknown tools without an explicit parallel grant.
 */
function classifyToolCall(toolCall: ParallelizableToolCall, options: ShouldParallelizeToolBatchOptions): ToolCallKind {
	const name = toolCall.name;
	if (NEVER_PARALLEL_TOOLS.has(name)) {
		return "solo";
	}
	if (options.toolPolicies?.get(name) === "sequential") {
		return "solo";
	}
	const functionArgs = toolCall.arguments;
	if (!functionArgs || typeof functionArgs !== "object" || Array.isArray(functionArgs)) {
		return "solo";
	}
	if (name === "bash") {
		return "solo";
	}
	if (PATH_SCOPED_TOOLS.has(name)) {
		return "path";
	}
	if (PARALLEL_SAFE_TOOLS.has(name)) {
		return "safe";
	}
	if (options.toolPolicies?.get(name) === "parallel" || options.allowUnknownParallel?.(name)) {
		return "safe";
	}
	return "solo";
}

/**
 * Partition a tool-call batch into ordered, contiguous waves of original
 * indices. Calls inside one wave may run concurrently; waves run one after
 * another in source order, so cross-wave ordering always matches the model's
 * emission order. Solo-classified calls become single-call waves, and a
 * path-scoped call starts a new wave when its target overlaps a path already
 * reserved in the current wave.
 */
export function partitionToolBatchWaves(
	toolCalls: ParallelizableToolCall[],
	options: ShouldParallelizeToolBatchOptions = {},
): number[][] {
	const waves: number[][] = [];
	let wave: number[] = [];
	let wavePaths: string[] = [];

	const closeWave = (): void => {
		if (wave.length > 0) {
			waves.push(wave);
			wave = [];
			wavePaths = [];
		}
	};

	for (let index = 0; index < toolCalls.length; index++) {
		const toolCall = toolCalls[index];
		const kind = classifyToolCall(toolCall, options);
		if (kind === "solo") {
			closeWave();
			waves.push([index]);
			continue;
		}
		if (kind === "path") {
			const scopedPath = extractParallelScopePath(toolCall.name, toolCall.arguments, options.cwd);
			if (scopedPath === null) {
				closeWave();
				waves.push([index]);
				continue;
			}
			if (wavePaths.some((existing) => pathsOverlap(scopedPath, existing))) {
				closeWave();
			}
			wavePaths.push(scopedPath);
		}
		wave.push(index);
	}
	closeWave();
	return waves;
}

/**
 * Return true when an entire tool-call batch is safe to run concurrently as a
 * single wave (Hermes-style policy, OMK tool names). Wave-based execution in
 * the agent loop uses partitionToolBatchWaves directly for partial parallelism.
 */
export function shouldParallelizeToolBatch(
	toolCalls: ParallelizableToolCall[],
	options: ShouldParallelizeToolBatchOptions = {},
): boolean {
	if (toolCalls.length <= 1) {
		return false;
	}
	return partitionToolBatchWaves(toolCalls, options).length === 1;
}
