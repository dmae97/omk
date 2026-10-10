/**
 * Runtime MCP server configuration loader.
 *
 * `mcp-inventory.ts` deliberately strips env *values* so its output is safe to
 * render; a client that has to spawn the server needs those values, so loading
 * is split rather than weakening the inventory's redaction guarantee. The
 * objects returned here are runtime-only — never log or render them directly.
 *
 * Source precedence matches the inventory exactly (later wins):
 *   1. ~/.kimi/mcp.json
 *   2. ~/.omk/mcp.json
 *   3. <cwd>/.omk/mcp.json
 *
 * The project file (3) arrives with whatever repository the user cloned, so it
 * is untrusted input. Its servers are skipped until the user trusts that exact
 * file content (see `trustProjectMcpConfig`); trust is pinned to a SHA-256 of
 * the file, so any later edit (a pull, a branch switch) requires trust again.
 * Even trusted project servers never inherit the parent environment: they get
 * a small allowlist plus the literal `env` they declare, and `$VAR` references
 * in their command/args/cwd are not expanded from the parent environment.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServerConfig } from "./manager.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		// A missing or malformed config file yields no servers, never a crash.
		return undefined;
	}
}

function extractServers(raw: unknown): Record<string, unknown> {
	if (!isRecord(raw)) return {};
	const candidate = raw.mcpServers ?? raw.servers ?? raw.mcp_servers;
	return isRecord(candidate) ? candidate : {};
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") out[key] = item;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Expand `~` and `${VAR}`/`$VAR` in a config string so mcp.json stays portable
 * across machines and home directories. Unknown variables are left untouched
 * (the spawn will fail loudly rather than silently hitting a wrong path).
 */
function expandConfigPath(value: string, expandEnv = true): string {
	if (value === "~" || value.startsWith("~/")) {
		value = path.join(os.homedir(), value.slice(2));
	}
	if (!expandEnv) return value;
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
		const key = braced ?? bare;
		return process.env[key] ?? match;
	});
}

export type McpConfigSource = "user" | "project";

/**
 * Parent environment keys a project-scoped server may see. Everything else,
 * including provider API keys and tokens, is withheld.
 */
export const PROJECT_MCP_ENV_ALLOWLIST: readonly string[] = Object.freeze([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"TMP",
	"TEMP",
	"SHELL",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"PATHEXT",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
]);

/** Build the full spawn environment for a project-scoped server. */
export function projectMcpEnv(
	declared: Readonly<Record<string, string>> | undefined,
	parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of PROJECT_MCP_ENV_ALLOWLIST) {
		const value = parent[key];
		if (typeof value === "string") env[key] = value;
	}
	return { ...env, ...(declared ?? {}) };
}

function toServerConfig(name: string, raw: unknown, source: McpConfigSource = "user"): McpServerConfig | undefined {
	if (!isRecord(raw)) return undefined;
	const command = raw.command;
	// Only stdio servers are supported; an entry with a `url` is a different transport.
	if (typeof command !== "string" || command.length === 0) return undefined;
	const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : undefined;
	const startupTimeoutSec = typeof raw.startup_timeout_sec === "number" ? raw.startup_timeout_sec : undefined;
	const toolTimeoutMs = secondsToTimeoutMs(raw.tool_timeout_sec) ?? defaultToolTimeoutMs();
	const isProject = source === "project";
	const expandEnv = !isProject;
	const declaredEnv = toStringRecord(raw.env);
	return {
		name,
		command: expandConfigPath(command, expandEnv),
		args: args?.map((arg) => expandConfigPath(arg, expandEnv)),
		env: isProject ? projectMcpEnv(declaredEnv) : declaredEnv,
		...(isProject ? { inheritEnv: false } : {}),
		cwd: typeof raw.cwd === "string" ? expandConfigPath(raw.cwd, expandEnv) : undefined,
		disabled: raw.disabled === true || raw.enabled === false,
		handshakeTimeoutMs: startupTimeoutSec !== undefined ? Math.max(1, startupTimeoutSec) * 1000 : undefined,
		...(toolTimeoutMs !== undefined ? { requestTimeoutMs: toolTimeoutMs } : {}),
	};
}

/** Global fallback for servers without `tool_timeout_sec`; read from the user's own environment. */
export const MCP_TOOL_TIMEOUT_ENV = "OMK_MCP_TOOL_TIMEOUT_SEC";

/** Upper bound for a configured per-request deadline (24h); larger values are clamped. */
const MAX_CONFIGURED_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function secondsToTimeoutMs(value: unknown): number | undefined {
	const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.min(MAX_CONFIGURED_TIMEOUT_MS, Math.max(1000, Math.round(seconds * 1000)));
}

function defaultToolTimeoutMs(): number | undefined {
	return secondsToTimeoutMs(process.env[MCP_TOOL_TIMEOUT_ENV]);
}

// ---------------------------------------------------------------------------
// Project config trust
// ---------------------------------------------------------------------------

/** Escape hatch for CI and scripted use; only the user's own environment can set it. */
export const TRUST_PROJECT_MCP_ENV = "OMK_TRUST_PROJECT_MCP";

export type ProjectMcpTrustState = "absent" | "untrusted" | "changed" | "trusted";

export interface ProjectMcpTrustStatus {
	readonly state: ProjectMcpTrustState;
	/** Absolute path of `<cwd>/.omk/mcp.json`. */
	readonly configPath: string;
	/** Canonical project directory used as the trust key. */
	readonly projectKey: string;
	/** SHA-256 of the current file content; absent when the file is absent. */
	readonly sha256?: string;
	/** Server names declared by the project file (names only, never env). */
	readonly serverNames: readonly string[];
}

interface TrustStoreFile {
	version: 1;
	projects: Record<string, { sha256: string; trustedAt: string }>;
}

export function mcpTrustStorePath(home: string = os.homedir()): string {
	return path.join(home, ".omk", "mcp-trust.json");
}

function canonicalDir(dir: string): string {
	try {
		return fs.realpathSync(dir);
	} catch {
		return path.resolve(dir);
	}
}

function readTrustStore(home: string): TrustStoreFile {
	const raw = readJson(mcpTrustStorePath(home));
	if (isRecord(raw) && raw.version === 1 && isRecord(raw.projects)) {
		const projects: TrustStoreFile["projects"] = {};
		for (const [key, entry] of Object.entries(raw.projects)) {
			if (isRecord(entry) && typeof entry.sha256 === "string" && typeof entry.trustedAt === "string") {
				projects[key] = { sha256: entry.sha256, trustedAt: entry.trustedAt };
			}
		}
		return { version: 1, projects };
	}
	return { version: 1, projects: {} };
}

function writeTrustStore(home: string, store: TrustStoreFile): void {
	const file = mcpTrustStorePath(home);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(store, null, "\t")}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

function readProjectFile(configPath: string): Buffer | undefined {
	try {
		return fs.readFileSync(configPath);
	} catch {
		return undefined;
	}
}

interface ProjectInspection {
	readonly status: ProjectMcpTrustStatus;
	/** Parsed content of exactly the bytes that were hashed (avoids a re-read race). */
	readonly parsed: unknown;
}

function inspectProject(cwd: string, home: string): ProjectInspection {
	const projectKey = canonicalDir(cwd);
	const configPath = path.join(projectKey, ".omk", "mcp.json");
	const bytes = readProjectFile(configPath);
	if (bytes === undefined)
		return { status: { state: "absent", configPath, projectKey, serverNames: [] }, parsed: undefined };
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		parsed = undefined;
	}
	const serverNames = Object.keys(extractServers(parsed)).sort();
	let state: ProjectMcpTrustState;
	if (canonicalDir(home) === projectKey || process.env[TRUST_PROJECT_MCP_ENV] === "1") {
		// The user's own home config is never subject to project trust.
		state = "trusted";
	} else {
		const entry = readTrustStore(home).projects[projectKey];
		state = !entry ? "untrusted" : entry.sha256 === sha256 ? "trusted" : "changed";
	}
	return { status: { state, configPath, projectKey, sha256, serverNames }, parsed };
}

/** Inspect whether `<cwd>/.omk/mcp.json` may be loaded. Never spawns anything. */
export function projectMcpTrustStatus(cwd: string = process.cwd(), home: string = os.homedir()): ProjectMcpTrustStatus {
	return inspectProject(cwd, home).status;
}

/**
 * Record trust for the project file's CURRENT content. Pass the `sha256` the
 * user actually reviewed; if the file changed since, nothing is trusted.
 */
export function trustProjectMcpConfig(
	cwd: string = process.cwd(),
	home: string = os.homedir(),
	expectedSha256?: string,
): ProjectMcpTrustStatus {
	const status = projectMcpTrustStatus(cwd, home);
	if (status.state === "absent" || status.sha256 === undefined) return status;
	if (expectedSha256 !== undefined && expectedSha256 !== status.sha256) {
		throw new Error("Project MCP config changed after review; review it again before trusting.");
	}
	const store = readTrustStore(home);
	store.projects[status.projectKey] = { sha256: status.sha256, trustedAt: new Date().toISOString() };
	writeTrustStore(home, store);
	return { ...status, state: "trusted" };
}

/** Remove any recorded trust for this project. */
export function revokeProjectMcpTrust(cwd: string = process.cwd(), home: string = os.homedir()): void {
	const store = readTrustStore(home);
	const key = canonicalDir(cwd);
	if (!(key in store.projects)) return;
	delete store.projects[key];
	writeTrustStore(home, store);
}

/** Config file paths consulted, in precedence order. */
export function mcpConfigPaths(cwd: string = process.cwd(), home: string = os.homedir()): string[] {
	return [
		path.join(home, ".kimi", "mcp.json"),
		path.join(home, ".omk", "mcp.json"),
		path.join(cwd, ".omk", "mcp.json"),
	];
}

/**
 * Load spawnable stdio server configs. Entries without a `command` (HTTP/SSE
 * servers) are skipped rather than failing the load, so an unsupported
 * transport in the config cannot disable every other server.
 */
export function loadMcpServerConfigs(cwd: string = process.cwd(), home: string = os.homedir()): McpServerConfig[] {
	return loadMcpServerConfigsWithReport(cwd, home).servers;
}

export interface McpConfigLoadReport {
	readonly servers: McpServerConfig[];
	readonly project: ProjectMcpTrustStatus;
	/** Project server names withheld because the project file is not trusted. */
	readonly skippedProjectServers: readonly string[];
}

/** Same as `loadMcpServerConfigs`, plus why project servers were withheld. */
export function loadMcpServerConfigsWithReport(
	cwd: string = process.cwd(),
	home: string = os.homedir(),
): McpConfigLoadReport {
	const inspection = inspectProject(cwd, home);
	const project = inspection.status;
	const [kimiPath, homePath, projectPath] = mcpConfigPaths(cwd, home);
	const sources: Array<[unknown, McpConfigSource]> = [
		[readJson(kimiPath), "user"],
		[readJson(homePath), "user"],
	];
	const projectIsHome = path.resolve(projectPath) === path.resolve(homePath);
	// Load the very bytes that were hashed for the trust decision, never a re-read.
	if (!projectIsHome && project.state === "trusted") sources.push([inspection.parsed, "project"]);
	const merged = new Map<string, McpServerConfig>();
	for (const [content, source] of sources) {
		const servers = extractServers(content);
		for (const name of Object.keys(servers).sort()) {
			const config = toServerConfig(name, servers[name], source);
			if (config) merged.set(name, config);
		}
	}
	const skippedProjectServers = !projectIsHome && project.state !== "trusted" ? project.serverNames : [];
	return {
		servers: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)),
		project,
		skippedProjectServers,
	};
}
