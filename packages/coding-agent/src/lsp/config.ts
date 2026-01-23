import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { globSync } from "glob";
import { getConfigDirPaths } from "$c/config";
import { BiomeClient } from "./clients/biome-client";
import DEFAULTS from "./defaults.json" with { type: "json" };
import type { ServerConfig } from "./types";

export interface LspConfig {
	servers: Record<string, ServerConfig>;
	/** Idle timeout in milliseconds. If set, LSP clients will be shutdown after this period of inactivity. Disabled by default. */
	idleTimeoutMs?: number;
}

// =============================================================================
// Default Server Configuration Loading
// =============================================================================

const PID_TOKEN = "$PID";

interface NormalizedConfig {
	servers: Record<string, Partial<ServerConfig>>;
	idleTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigContent(content: string, filePath: string): unknown {
	const extension = extname(filePath).toLowerCase();
	if (extension === ".yaml" || extension === ".yml") {
		return YAML.parse(content) as unknown;
	}
	return JSON.parse(content) as unknown;
}

function normalizeConfig(value: unknown): NormalizedConfig | null {
	if (!isRecord(value)) return null;

	const idleTimeoutMs = typeof value.idleTimeoutMs === "number" ? value.idleTimeoutMs : undefined;
	const rawServers = value.servers;

	if (isRecord(rawServers)) {
		return { servers: rawServers as Record<string, Partial<ServerConfig>>, idleTimeoutMs };
	}

	const servers = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "idleTimeoutMs")) as Record<
		string,
		Partial<ServerConfig>
	>;

	return { servers, idleTimeoutMs };
}

function normalizeStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const items = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	return items.length > 0 ? items : null;
}

function normalizeServerConfig(name: string, config: Partial<ServerConfig>): ServerConfig | null {
	const command = typeof config.command === "string" && config.command.length > 0 ? config.command : null;
	const fileTypes = normalizeStringArray(config.fileTypes);
	const rootMarkers = normalizeStringArray(config.rootMarkers);

	if (!command || !fileTypes || !rootMarkers) {
		logger.warn("Ignoring invalid LSP server config (missing required fields).", { name });
		return null;
	}

	const args = Array.isArray(config.args)
		? config.args.filter((entry): entry is string => typeof entry === "string")
		: undefined;

	return {
		...config,
		command,
		args,
		fileTypes,
		rootMarkers,
	};
}

async function readConfigFile(filePath: string): Promise<NormalizedConfig | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return null;
		}
		const content = await file.text();
		const parsed = parseConfigContent(content, filePath);
		return normalizeConfig(parsed);
	} catch {
		return null;
	}
}

function coerceServerConfigs(servers: Record<string, Partial<ServerConfig>>): Record<string, ServerConfig> {
	const result: Record<string, ServerConfig> = {};
	for (const [name, config] of Object.entries(servers)) {
		const normalized = normalizeServerConfig(name, config);
		if (normalized) {
			result[name] = normalized;
		}
	}
	return result;
}

function mergeServers(
	base: Record<string, ServerConfig>,
	overrides: Record<string, Partial<ServerConfig>>,
): Record<string, ServerConfig> {
	const merged: Record<string, ServerConfig> = { ...base };
	for (const [name, config] of Object.entries(overrides)) {
		if (merged[name]) {
			const candidate = { ...merged[name], ...config };
			const normalized = normalizeServerConfig(name, candidate);
			if (normalized) {
				merged[name] = normalized;
			} else {
				logger.warn("Ignoring invalid LSP overrides (keeping previous config).", { name });
			}
		} else {
			const normalized = normalizeServerConfig(name, config);
			if (normalized) {
				merged[name] = normalized;
			}
		}
	}
	return merged;
}

function applyRuntimeDefaults(servers: Record<string, ServerConfig>): Record<string, ServerConfig> {
	const updated: Record<string, ServerConfig> = { ...servers };

	if (updated.biome) {
		updated.biome = { ...updated.biome, createClient: BiomeClient.create };
	}

	if (updated.omnisharp?.args) {
		const args = updated.omnisharp.args.map((arg) => (arg === PID_TOKEN ? String(process.pid) : arg));
		updated.omnisharp = { ...updated.omnisharp, args };
	}

	return updated;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Check if any root marker file exists in the directory
 */
export async function hasRootMarkers(cwd: string, markers: string[]): Promise<boolean> {
	for (const marker of markers) {
		// Handle glob-like patterns (e.g., "*.cabal")
		if (marker.includes("*")) {
			try {
				const matches = globSync(join(cwd, marker));
				if (matches.length > 0) {
					return true;
				}
			} catch {
				logger.warn("Failed to resolve glob root marker.", { marker, cwd });
			}
			continue;
		}
		const filePath = join(cwd, marker);
		if (await Bun.file(filePath).exists()) {
			return true;
		}
	}
	return false;
}

// =============================================================================
// Local Binary Resolution
// =============================================================================

/**
 * Local bin directories to check before $PATH, ordered by priority.
 * Each entry maps a root marker to the bin directory to check.
 */
const LOCAL_BIN_PATHS: Array<{ markers: string[]; binDir: string }> = [
	// Node.js - check node_modules/.bin/
	{ markers: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"], binDir: "node_modules/.bin" },
	// Python - check virtual environment bin directories
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".venv/bin" },
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: "venv/bin" },
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".env/bin" },
	// Ruby - check vendor bundle and binstubs
	{ markers: ["Gemfile", "Gemfile.lock"], binDir: "vendor/bundle/bin" },
	{ markers: ["Gemfile", "Gemfile.lock"], binDir: "bin" },
	// Go - check project-local bin
	{ markers: ["go.mod", "go.sum"], binDir: "bin" },
];

/**
 * Resolve a command to an executable path.
 * Checks project-local bin directories first, then falls back to $PATH.
 *
 * @param command - The command name (e.g., "typescript-language-server")
 * @param cwd - Working directory to search from
 * @returns Absolute path to the executable, or null if not found
 */
export async function resolveCommand(command: string, cwd: string): Promise<string | null> {
	// Check local bin directories based on project markers
	for (const { markers, binDir } of LOCAL_BIN_PATHS) {
		if (await hasRootMarkers(cwd, markers)) {
			const localPath = join(cwd, binDir, command);
			if (await Bun.file(localPath).exists()) {
				return localPath;
			}
		}
	}

	// Fall back to $PATH
	return Bun.which(command);
}

/**
 * Configuration file search paths (in priority order).
 * Supports both visible and hidden variants at each config location.
 */
function getConfigPaths(cwd: string): string[] {
	const filenames = ["lsp.json", ".lsp.json", "lsp.yaml", ".lsp.yaml", "lsp.yml", ".lsp.yml"];
	const paths: string[] = [];

	// Project root files (highest priority)
	for (const filename of filenames) {
		paths.push(join(cwd, filename));
	}

	// Project config directories (.omp/, .pi/, .claude/)
	const projectDirs = getConfigDirPaths("", { user: false, project: true, cwd });
	for (const dir of projectDirs) {
		for (const filename of filenames) {
			paths.push(join(dir, filename));
		}
	}

	// User config directories (~/.omp/agent/, ~/.pi/agent/, ~/.claude/)
	const userDirs = getConfigDirPaths("", { user: true, project: false });
	for (const dir of userDirs) {
		for (const filename of filenames) {
			paths.push(join(dir, filename));
		}
	}

	// User home root files (lowest priority fallback)
	for (const filename of filenames) {
		paths.push(join(homedir(), filename));
	}

	return paths;
}

/**
 * Load LSP configuration.
 *
 * Priority (highest to lowest):
 * 1. Project root: lsp.json/.lsp.json/lsp.yml/.lsp.yml/lsp.yaml/.lsp.yaml
 * 2. Project config dirs: .omp/lsp.*, .pi/lsp.*, .claude/lsp.* (+ hidden variants)
 * 3. User config dirs: ~/.omp/agent/lsp.*, ~/.pi/agent/lsp.*, ~/.claude/lsp.* (+ hidden variants)
 * 4. User home root: ~/lsp.*, ~/.lsp.*
 * 5. Auto-detect from project markers + available binaries
 *
 * Config files are merged from lowest to highest priority; later files override earlier settings.
 *
 * Config file format (JSON or YAML):
 * ```json
 * {
 *   "servers": {
 *     "typescript-language-server": {
 *       "command": "typescript-language-server",
 *       "args": ["--stdio", "--log-level", "4"],
 *       "disabled": false
 *     },
 *     "my-custom-server": {
 *       "command": "/path/to/server",
 *       "args": ["--stdio"],
 *       "fileTypes": [".xyz"],
 *       "rootMarkers": [".xyz-project"]
 *     }
 *   }
 * }
 * ```
 */
export async function loadConfig(cwd: string): Promise<LspConfig> {
	let mergedServers = coerceServerConfigs(DEFAULTS);

	const configPaths = getConfigPaths(cwd).reverse();
	let hasOverrides = false;

	let idleTimeoutMs: number | undefined;
	for (const configPath of configPaths) {
		const parsed = await readConfigFile(configPath);
		if (!parsed) continue;
		const hasServerOverrides = Object.keys(parsed.servers).length > 0;
		if (hasServerOverrides) {
			hasOverrides = true;
			mergedServers = mergeServers(mergedServers, parsed.servers);
		}
		if (parsed.idleTimeoutMs !== undefined) {
			idleTimeoutMs = parsed.idleTimeoutMs;
		}
	}

	if (!hasOverrides) {
		// Auto-detect: find servers based on project markers AND available binaries
		const detected: Record<string, ServerConfig> = {};
		const defaultsWithRuntime = applyRuntimeDefaults(mergedServers);

		for (const [name, config] of Object.entries(defaultsWithRuntime)) {
			// Check if project has root markers for this language
			if (!(await hasRootMarkers(cwd, config.rootMarkers))) continue;

			// Check if the language server binary is available (local or $PATH)
			const resolved = await resolveCommand(config.command, cwd);
			if (!resolved) continue;

			detected[name] = { ...config, resolvedCommand: resolved };
		}

		return { servers: detected, idleTimeoutMs };
	}

	// Merge overrides with defaults and filter to available servers
	const mergedWithRuntime = applyRuntimeDefaults(mergedServers);
	const available: Record<string, ServerConfig> = {};

	for (const [name, config] of Object.entries(mergedWithRuntime)) {
		if (config.disabled) continue;
		const resolved = await resolveCommand(config.command, cwd);
		if (!resolved) continue;
		available[name] = { ...config, resolvedCommand: resolved };
	}

	return { servers: available, idleTimeoutMs };
}

// =============================================================================
// Server Selection
// =============================================================================

/**
 * Find all servers that can handle a file based on extension.
 * Returns servers sorted with primary (non-linter) servers first.
 */
export function getServersForFile(config: LspConfig, filePath: string): Array<[string, ServerConfig]> {
	const ext = extname(filePath).toLowerCase();
	const fileName = basename(filePath).toLowerCase();
	const matches: Array<[string, ServerConfig]> = [];

	for (const [name, serverConfig] of Object.entries(config.servers)) {
		const supportsFile = serverConfig.fileTypes.some((fileType) => {
			const normalized = fileType.toLowerCase();
			return normalized === ext || normalized === fileName;
		});

		if (supportsFile) {
			matches.push([name, serverConfig]);
		}
	}

	// Sort: primary servers (non-linters) first, then linters
	return matches.sort((a, b) => {
		const aIsLinter = a[1].isLinter ? 1 : 0;
		const bIsLinter = b[1].isLinter ? 1 : 0;
		return aIsLinter - bIsLinter;
	});
}

/**
 * Find the primary server for a file (prefers type-checkers over linters).
 * Used for operations like definition, hover, references that need type intelligence.
 */
export function getServerForFile(config: LspConfig, filePath: string): [string, ServerConfig] | null {
	const servers = getServersForFile(config, filePath);
	return servers.length > 0 ? servers[0] : null;
}

/**
 * Check if a server has a specific capability
 */
export function hasCapability(
	config: ServerConfig,
	capability: keyof NonNullable<ServerConfig["capabilities"]>,
): boolean {
	return config.capabilities?.[capability] === true;
}
