/**
 * Centralized path helpers for omp config directories.
 *
 * Uses PI_CONFIG_DIR (default ".omp") for the config root and
 * PI_CODING_AGENT_DIR to override the agent directory.
 */
import * as os from "node:os";
import * as path from "node:path";
import packageJson from "../../coding-agent/package.json" with { type: "json" };
import { $env } from "./env";

/** App name (e.g. "omp") */
export const APP_NAME: string = packageJson.ompConfig?.name || "omp";

/** Config directory name (e.g. ".omp") */
export const CONFIG_DIR_NAME: string = packageJson.ompConfig?.configDir || ".omp";

/** Version (e.g. "1.0.0") */
export const VERSION: string = packageJson.version;

/**
 * Get the config root directory (~/.omp).
 */
export function getConfigRootDir(): string {
	return path.join(os.homedir(), $env.PI_CONFIG_DIR || CONFIG_DIR_NAME);
}

/**
 * Get the path to the agent directory.
 */
export function getAgentDir(): string {
	return $env.PI_CODING_AGENT_DIR || path.join(getConfigRootDir(), "agent");
}

/**
 * Get the path to the project-local agent directory.
 */
export function getProjectAgentDir(cwd: string = process.cwd()): string {
	return path.join(cwd, CONFIG_DIR_NAME);
}

/**
 * Get the reports directory (~/.omp/reports).
 */
export function getReportsDir(): string {
	return path.join(getConfigRootDir(), "reports");
}

/**
 * Get the logs directory (~/.omp/logs).
 */
export function getLogsDir(): string {
	return path.join(getConfigRootDir(), "logs");
}

/**
 * Get the path to today's log file.
 */
export function getLogPath(date?: string): string {
	const today = date ?? new Date().toISOString().slice(0, 10);
	return path.join(getLogsDir(), `omp.${today}.log`);
}

/**
 * Get the user-level Python modules directory (~/.omp/agent/modules).
 */
export function getAgentModulesDir(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, "modules");
}

/**
 * Get the project-level Python modules directory (.omp/modules).
 */
export function getProjectModulesDir(cwd: string = process.cwd()): string {
	return path.join(getProjectAgentDir(cwd), "modules");
}

/**
 * Get the project-level prompts directory (.omp/prompts).
 */
export function getProjectPromptsDir(cwd: string = process.cwd()): string {
	return path.join(getProjectAgentDir(cwd), "prompts");
}

/**
 * Get the plugins directory (~/.omp/plugins).
 */
export function getPluginsDir(): string {
	return path.join(getConfigRootDir(), "plugins");
}

/** Where npm installs packages: ~/.omp/plugins/node_modules */
export function getPluginsNodeModules(): string {
	return path.join(getPluginsDir(), "node_modules");
}

/** Plugin manifest: ~/.omp/plugins/package.json */
export function getPluginsPackageJson(): string {
	return path.join(getPluginsDir(), "package.json");
}

/** Plugin lock file: ~/.omp/plugins/omp-plugins.lock.json */
export function getPluginsLockfile(): string {
	return path.join(getPluginsDir(), "omp-plugins.lock.json");
}

/**
 * Get the remote mount directory (~/.omp/remote).
 */
export function getRemoteDir(): string {
	return path.join(getConfigRootDir(), "remote");
}

/**
 * Get the SSH control socket directory (~/.omp/ssh-control).
 */
export function getSshControlDir(): string {
	return path.join(getConfigRootDir(), "ssh-control");
}

/**
 * Get the remote host info directory (~/.omp/remote-host).
 */
export function getRemoteHostDir(): string {
	return path.join(getConfigRootDir(), "remote-host");
}

/**
 * Get the managed Python venv directory (~/.omp/python-env).
 */
export function getPythonEnvDir(): string {
	return path.join(getConfigRootDir(), "python-env");
}

/**
 * Get the project-level plugin overrides path (.omp/plugin-overrides.json).
 */
export function getProjectPluginOverridesPath(cwd: string = process.cwd()): string {
	return path.join(getProjectAgentDir(cwd), "plugin-overrides.json");
}

/**
 * Get the MCP config file path.
 * @param scope - "user" for ~/.omp/mcp.json or "project" for .omp/mcp.json
 */
export function getMCPConfigPaths(scope: "user" | "project", cwd: string = process.cwd()): string[] {
	if (scope === "user") {
		return [path.join(getAgentDir(), "mcp.json"), path.join(getAgentDir(), ".mcp.json")];
	}
	return [path.join(getProjectAgentDir(cwd), "mcp.json"), path.join(getProjectAgentDir(cwd), ".mcp.json")];
}

/**
 * Get the primary MCP config file path (first candidate).
 * @param scope - "user" for ~/.omp/agent/mcp.json or "project" for .omp/mcp.json
 */
export function getMCPConfigPath(scope: "user" | "project", cwd: string = process.cwd()): string {
	return getMCPConfigPaths(scope, cwd)[0];
}

/**
 * Get the worktree base directory (~/.omp/wt).
 */
export function getWorktreeBaseDir(): string {
	return path.join(getConfigRootDir(), "wt");
}

/**
 * Get the path to a worktree directory.
 */
export function getWorktreeDir(encodedProject: string, id: string): string {
	return path.join(getWorktreeBaseDir(), encodedProject, id);
}

/**
 * Get the GPU cache path (~/.omp/gpu_cache.json).
 */
export function getGpuCachePath(): string {
	return path.join(getConfigRootDir(), "gpu_cache.json");
}

/**
 * Get the test auth database path (~/.omp/agent/testauth.db).
 */
export function getTestAuthPath(): string {
	return path.join(getAgentDir(), "testauth.db");
}

/**
 * Get the sessions directory (~/.omp/agent/sessions).
 */
export function getSessionsDir(): string {
	return path.join(getAgentDir(), "sessions");
}

/**
 * Get the natives directory (~/.omp/natives).
 */
export function getNativesDir(): string {
	return path.join(getConfigRootDir(), "natives");
}

/**
 * Get the stats database path (~/.omp/stats.db).
 */
export function getStatsDbPath(): string {
	return path.join(getConfigRootDir(), "stats.db");
}

/**
 * Get the crash log path (~/.omp/agent/omp-crash.log).
 */
export function getCrashLogPath(): string {
	return path.join(getAgentDir(), "omp-crash.log");
}

/** Gets the path to agent.db (SQLite database for settings and auth storage) */
export function getAgentDbPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, "agent.db");
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return path.join(getAgentDir(), "themes");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return path.join(getAgentDir(), "tools");
}

/** Get path to slash commands directory */
export function getCommandsDir(): string {
	return path.join(getAgentDir(), "commands");
}

/** Get path to prompts directory */
export function getPromptsDir(): string {
	return path.join(getAgentDir(), "prompts");
}

/** Get path to content-addressed blob store directory */
export function getBlobsDir(): string {
	return path.join(getAgentDir(), "blobs");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return path.join(getAgentDir(), `${APP_NAME}-debug.log`);
}
