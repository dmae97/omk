/**
 * Subagent nesting guard. Every child omk process inherits the parent's
 * environment, and a child that loads this extension would otherwise get the
 * `subagent` tool again, so a lane could spawn lanes without bound. The parent
 * passes its depth + 1 to each child; a process at or past the max depth does
 * not register the tool. Default max depth is 1: the top-level session can fan
 * out, its children cannot. `OMK_SUBAGENT_MAX_DEPTH` raises or lowers it.
 */

export const SUBAGENT_DEPTH_ENV = "OMK_SUBAGENT_DEPTH";
export const SUBAGENT_MAX_DEPTH_ENV = "OMK_SUBAGENT_MAX_DEPTH";
export const DEFAULT_SUBAGENT_MAX_DEPTH = 1;

type Env = Readonly<Record<string, string | undefined>>;

function nonNegativeInt(value: string | undefined): number | undefined {
	if (value === undefined || !/^\s*\d+\s*$/.test(value)) return undefined;
	return Number.parseInt(value, 10);
}

export function currentSubagentDepth(env: Env): number {
	return nonNegativeInt(env[SUBAGENT_DEPTH_ENV]) ?? 0;
}

export function maxSubagentDepth(env: Env): number {
	return nonNegativeInt(env[SUBAGENT_MAX_DEPTH_ENV]) ?? DEFAULT_SUBAGENT_MAX_DEPTH;
}

export function canSpawnSubagents(env: Env): boolean {
	return currentSubagentDepth(env) < maxSubagentDepth(env);
}

export function childSubagentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return { ...env, [SUBAGENT_DEPTH_ENV]: String(currentSubagentDepth(env) + 1) };
}
