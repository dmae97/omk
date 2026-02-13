/**
 * Centralized path helpers for omp config directories.
 *
 * Uses PI_CONFIG_DIR (default ".omp") for the config root and
 * PI_CODING_AGENT_DIR to override the agent directory.
 */

import { realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { version } from "../package.json" with { type: "json" };
import { $env } from "./env";

/** App name (e.g. "omp") */
export const APP_NAME: string = "omp";

/** Config directory name (e.g. ".omp") */
export const CONFIG_DIR_NAME: string = ".omp";

/** Version (e.g. "1.0.0") */
export const VERSION: string = version;

// =============================================================================
// Root directories
// =============================================================================

let projectDir = process.cwd();
if ($env.PWD) {
	if (realpathSync($env.PWD) === projectDir) {
		projectDir = $env.PWD;
	}
}

/** Get the project directory. */
export function getProjectDir(): string {
	return projectDir;
}

/** Set the project directory. */
export function setProjectDir(dir: string): void {
	projectDir = path.resolve(dir);
	process.chdir(projectDir);
}

/** Get the config root directory (~/.omp). */
export function getConfigRootDir(): string {
	return path.join(os.homedir(), $env.PI_CONFIG_DIR || CONFIG_DIR_NAME);
}

let agentDir = $env.PI_CODING_AGENT_DIR || path.join(getConfigRootDir(), "agent");

/** Set the coding agent directory. */
export function setAgentDir(dir: string): void {
	agentDir = dir;
	agentCache.clear();
	$env.PI_CODING_AGENT_DIR = dir;
}

/** Get the agent config directory (~/.omp/agent). */
export function getAgentDir(): string {
	return agentDir;
}

/** Get the project-local config directory (.omp). */
export function getProjectAgentDir(cwd: string = getProjectDir()): string {
	return path.join(cwd, CONFIG_DIR_NAME);
}

// =============================================================================
// Caching utilities
// =============================================================================

const rootCache = new Map<string, any>();

function getRootSubdir(subdir: string): string {
	if (rootCache.has(subdir)) {
		return rootCache.get(subdir);
	}
	const result = path.join(getConfigRootDir(), subdir);
	rootCache.set(subdir, result);
	return result;
}

const agentCache = new Map<string, any>();

function getAgentSubdir(userAgentDir: string | undefined, subdir: string): string {
	if (!userAgentDir || userAgentDir === agentDir) {
		if (agentCache.has(subdir)) {
			return agentCache.get(subdir);
		} else {
			const result = path.join(agentDir, subdir);
			agentCache.set(subdir, result);
			return result;
		}
	} else {
		return path.join(userAgentDir, subdir);
	}
}

// =============================================================================
// Config-root subdirectories (~/.omp/*)
// =============================================================================

/** Get the reports directory (~/.omp/reports). */
export function getReportsDir(): string {
	return getRootSubdir("reports");
}

/** Get the logs directory (~/.omp/logs). */
export function getLogsDir(): string {
	return getRootSubdir("logs");
}

/** Get the path to a dated log file (~/.omp/logs/omp.YYYY-MM-DD.log). */
export function getLogPath(date = new Date()): string {
	return path.join(getLogsDir(), `${APP_NAME}.${date.toISOString().slice(0, 10)}.log`);
}

/** Get the plugins directory (~/.omp/plugins). */
export function getPluginsDir(): string {
	return getRootSubdir("plugins");
}

/** Where npm installs packages (~/.omp/plugins/node_modules). */
export function getPluginsNodeModules(): string {
	return getRootSubdir("plugins/node_modules");
}

/** Plugin manifest (~/.omp/plugins/package.json). */
export function getPluginsPackageJson(): string {
	return getRootSubdir("plugins/package.json");
}

/** Plugin lock file (~/.omp/plugins/omp-plugins.lock.json). */
export function getPluginsLockfile(): string {
	return getRootSubdir("plugins/omp-plugins.lock.json");
}

/** Get the remote mount directory (~/.omp/remote). */
export function getRemoteDir(): string {
	return getRootSubdir("remote");
}

/** Get the SSH control socket directory (~/.omp/ssh-control). */
export function getSshControlDir(): string {
	return getRootSubdir("ssh-control");
}

/** Get the remote host info directory (~/.omp/remote-host). */
export function getRemoteHostDir(): string {
	return getRootSubdir("remote-host");
}

/** Get the managed Python venv directory (~/.omp/python-env). */
export function getPythonEnvDir(): string {
	return getRootSubdir("python-env");
}

/** Get the worktree base directory (~/.omp/wt). */
export function getWorktreeBaseDir(): string {
	return getRootSubdir("wt");
}

/** Get the path to a worktree directory (~/.omp/wt/<project>/<id>). */
export function getWorktreeDir(encodedProject: string, id: string): string {
	return path.join(getWorktreeBaseDir(), encodedProject, id);
}

/** Get the GPU cache path (~/.omp/gpu_cache.json). */
export function getGpuCachePath(): string {
	return getRootSubdir("gpu_cache.json");
}

/** Get the natives directory (~/.omp/natives). */
export function getNativesDir(): string {
	return getRootSubdir("natives");
}

/** Get the stats database path (~/.omp/stats.db). */
export function getStatsDbPath(): string {
	return getRootSubdir("stats.db");
}

// =============================================================================
// Agent subdirectories (~/.omp/agent/*)
// =============================================================================

/** Get the path to agent.db (SQLite database for settings and auth storage). */
export function getAgentDbPath(agentDir?: string): string {
	return getAgentSubdir(agentDir, "agent.db");
}

/** Get the sessions directory (~/.omp/agent/sessions). */
export function getSessionsDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "sessions");
}

/** Get the content-addressed blob store directory (~/.omp/agent/blobs). */
export function getBlobsDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "blobs");
}

/** Get the custom themes directory (~/.omp/agent/themes). */
export function getCustomThemesDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "themes");
}

/** Get the tools directory (~/.omp/agent/tools). */
export function getToolsDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "tools");
}

/** Get the slash commands directory (~/.omp/agent/commands). */
export function getCommandsDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "commands");
}

/** Get the prompts directory (~/.omp/agent/prompts). */
export function getPromptsDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "prompts");
}

/** Get the user-level Python modules directory (~/.omp/agent/modules). */
export function getAgentModulesDir(agentDir?: string): string {
	return getAgentSubdir(agentDir, "modules");
}

/** Get the test auth database path (~/.omp/agent/testauth.db). */
export function getTestAuthPath(agentDir?: string): string {
	return getAgentSubdir(agentDir, "testauth.db");
}

/** Get the crash log path (~/.omp/agent/omp-crash.log). */
export function getCrashLogPath(agentDir?: string): string {
	return getAgentSubdir(agentDir, "omp-crash.log");
}

/** Get the debug log path (~/.omp/agent/omp-debug.log). */
export function getDebugLogPath(agentDir?: string): string {
	return getAgentSubdir(agentDir, `${APP_NAME}-debug.log`);
}

// =============================================================================
// Project subdirectories (.omp/*)
// =============================================================================

/** Get the project-level Python modules directory (.omp/modules). */
export function getProjectModulesDir(cwd: string = getProjectDir()): string {
	return path.join(getProjectAgentDir(cwd), "modules");
}

/** Get the project-level prompts directory (.omp/prompts). */
export function getProjectPromptsDir(cwd: string = getProjectDir()): string {
	return path.join(getProjectAgentDir(cwd), "prompts");
}

/** Get the project-level plugin overrides path (.omp/plugin-overrides.json). */
export function getProjectPluginOverridesPath(cwd: string = getProjectDir()): string {
	return path.join(getProjectAgentDir(cwd), "plugin-overrides.json");
}

// =============================================================================
// MCP config paths
// =============================================================================

/** Get the primary MCP config file path (first candidate). */
export function getMCPConfigPath(scope: "user" | "project", cwd: string = getProjectDir()): string {
	if (scope === "user") {
		return path.join(getAgentDir(), "mcp.json");
	}
	return path.join(getProjectAgentDir(cwd), "mcp.json");
}
