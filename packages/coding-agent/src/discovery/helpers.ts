import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { FileType, glob } from "@oh-my-pi/pi-natives";
import { CONFIG_DIR_NAME, tryParseJson } from "@oh-my-pi/pi-utils";
import { readFile } from "../capability/fs";
import { parseRuleConditionAndScope, type Rule, type RuleFrontmatter } from "../capability/rule";
import type { Skill, SkillFrontmatter } from "../capability/skill";
import type { LoadContext, LoadResult, SourceMeta } from "../capability/types";
import { parseFrontmatter } from "../utils/frontmatter";
import type { IgnoreMatcher } from "../utils/ignore-files";

const VALID_THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Standard paths for each config source.
 */
export const SOURCE_PATHS = {
	native: {
		userBase: CONFIG_DIR_NAME,
		userAgent: `${CONFIG_DIR_NAME}/agent`,
		projectDir: CONFIG_DIR_NAME,
	},
	claude: {
		userBase: ".claude",
		userAgent: ".claude",
		projectDir: ".claude",
	},
	codex: {
		userBase: ".codex",
		userAgent: ".codex",
		projectDir: ".codex",
	},
	gemini: {
		userBase: ".gemini",
		userAgent: ".gemini",
		projectDir: ".gemini",
	},
	opencode: {
		userBase: ".config/opencode",
		userAgent: ".config/opencode",
		projectDir: ".opencode",
	},
	cursor: {
		userBase: ".cursor",
		userAgent: ".cursor",
		projectDir: ".cursor",
	},
	windsurf: {
		userBase: ".codeium/windsurf",
		userAgent: ".codeium/windsurf",
		projectDir: ".windsurf",
	},
	cline: {
		userBase: ".cline",
		userAgent: ".cline",
		projectDir: null, // Cline uses root-level .clinerules
	},
	github: {
		userBase: null,
		userAgent: null,
		projectDir: ".github",
	},
	vscode: {
		userBase: ".vscode",
		userAgent: ".vscode",
		projectDir: ".vscode",
	},
} as const;

export type SourceId = keyof typeof SOURCE_PATHS;

/**
 * Get user-level path for a source.
 */
export function getUserPath(ctx: LoadContext, source: SourceId, subpath: string): string | null {
	const paths = SOURCE_PATHS[source];
	if (!paths.userAgent) return null;
	return path.join(ctx.home, paths.userAgent, subpath);
}

/**
 * Get project-level path for a source (cwd only).
 */
export function getProjectPath(ctx: LoadContext, source: SourceId, subpath: string): string | null {
	const paths = SOURCE_PATHS[source];
	if (!paths.projectDir) return null;

	return path.join(ctx.cwd, paths.projectDir, subpath);
}

/**
 * Create source metadata for an item.
 */
export function createSourceMeta(provider: string, filePath: string, level: "user" | "project"): SourceMeta {
	return {
		provider,
		providerName: "", // Filled in by registry
		path: path.resolve(filePath),
		level,
	};
}

/**
 * Parse thinking level from frontmatter.
 * Supports keys: thinkingLevel, thinking-level, thinking
 */
export function parseThinkingLevel(frontmatter: Record<string, unknown>): ThinkingLevel | undefined {
	const raw = frontmatter.thinkingLevel ?? frontmatter["thinking-level"] ?? frontmatter.thinking;
	if (typeof raw === "string" && VALID_THINKING_LEVELS.includes(raw)) {
		return raw as ThinkingLevel;
	}
	return undefined;
}

export function parseBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	return undefined;
}

/**
 * Parse a comma-separated string into an array of trimmed, non-empty strings.
 */
export function parseCSV(value: string): string[] {
	return value
		.split(",")
		.map(s => s.trim())
		.filter(Boolean);
}

/**
 * Parse a value that may be an array of strings or a comma-separated string.
 * Returns undefined if the result would be empty.
 */
export function parseArrayOrCSV(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const filtered = value.filter((item): item is string => typeof item === "string");
		return filtered.length > 0 ? filtered : undefined;
	}
	if (typeof value === "string") {
		const parsed = parseCSV(value);
		return parsed.length > 0 ? parsed : undefined;
	}
	return undefined;
}

/**
 * Build a canonical rule item from a markdown/markdown-frontmatter document.
 */
export function buildRuleFromMarkdown(
	name: string,
	content: string,
	filePath: string,
	source: SourceMeta,
	options?: {
		ruleName?: string;
		stripNamePattern?: RegExp;
	},
): Rule {
	const { frontmatter, body } = parseFrontmatter(content, { source: filePath });
	const { condition, scope } = parseRuleConditionAndScope(frontmatter as RuleFrontmatter);

	let globs: string[] | undefined;
	if (Array.isArray(frontmatter.globs)) {
		globs = frontmatter.globs.filter((item): item is string => typeof item === "string");
	} else if (typeof frontmatter.globs === "string") {
		globs = [frontmatter.globs];
	}

	const resolvedName = options?.ruleName ?? name.replace(options?.stripNamePattern ?? /\.(md|mdc)$/, "");
	return {
		name: resolvedName,
		path: filePath,
		content: body,
		globs,
		alwaysApply: frontmatter.alwaysApply === true,
		description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
		condition,
		scope,
		_source: source,
	};
}

/**
 * Parse model field into a prioritized list.
 */
export function parseModelList(value: unknown): string[] | undefined {
	const parsed = parseArrayOrCSV(value);
	if (!parsed) return undefined;
	const normalized = parsed.map(entry => entry.trim()).filter(Boolean);
	return normalized.length > 0 ? normalized : undefined;
}

/** Parsed agent fields from frontmatter (excludes source/filePath/systemPrompt) */
export interface ParsedAgentFields {
	name: string;
	description: string;
	tools?: string[];
	spawns?: string[] | "*";
	model?: string[];
	output?: unknown;
	thinkingLevel?: ThinkingLevel;
	blocking?: boolean;
}

/**
 * Parse agent fields from frontmatter.
 * Returns null if required fields (name, description) are missing.
 */
export function parseAgentFields(frontmatter: Record<string, unknown>): ParsedAgentFields | null {
	const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
	const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;

	if (!name || !description) {
		return null;
	}

	let tools = parseArrayOrCSV(frontmatter.tools);

	// Subagents with explicit tool lists always need submit_result
	if (tools && !tools.includes("submit_result")) {
		tools = [...tools, "submit_result"];
	}

	// Parse spawns field (array, "*", or CSV)
	let spawns: string[] | "*" | undefined;
	if (frontmatter.spawns === "*") {
		spawns = "*";
	} else if (typeof frontmatter.spawns === "string") {
		const trimmed = frontmatter.spawns.trim();
		if (trimmed === "*") {
			spawns = "*";
		} else {
			spawns = parseArrayOrCSV(trimmed);
		}
	} else {
		spawns = parseArrayOrCSV(frontmatter.spawns);
	}

	// Backward compat: infer spawns: "*" when tools includes "task"
	if (spawns === undefined && tools?.includes("task")) {
		spawns = "*";
	}

	const output = frontmatter.output !== undefined ? frontmatter.output : undefined;
	const model = parseModelList(frontmatter.model);
	const thinkingLevel = parseThinkingLevel(frontmatter);
	const blocking = parseBoolean(frontmatter.blocking);

	return { name, description, tools, spawns, model, output, thinkingLevel, blocking };
}

async function globIf(
	dir: string,
	pattern: string,
	fileType: FileType,
	recursive: boolean = true,
): Promise<Array<{ path: string }>> {
	try {
		const result = await glob({ pattern, path: dir, gitignore: true, hidden: false, fileType, recursive });
		return result.matches;
	} catch {
		return [];
	}
}

export interface ScanSkillsFromDirOptions {
	dir: string;
	providerId: string;
	level: "user" | "project";
	requireDescription?: boolean;
}

export async function scanSkillsFromDir(
	_ctx: LoadContext,
	options: ScanSkillsFromDirOptions,
): Promise<LoadResult<Skill>> {
	const items: Skill[] = [];
	const warnings: string[] = [];
	const { dir, level, providerId, requireDescription = false } = options;

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			warnings.push(`Failed to read skills directory: ${dir} (${String(error)})`);
		}
		return { items, warnings };
	}
	const loadSkill = async (skillPath: string) => {
		try {
			const content = await readFile(skillPath);
			if (!content) return;
			const { frontmatter, body } = parseFrontmatter(content, { source: skillPath });
			if (requireDescription && !frontmatter.description) {
				return;
			}
			const skillDirName = path.basename(path.dirname(skillPath));
			items.push({
				name: (frontmatter.name as string) || skillDirName,
				path: skillPath,
				content: body,
				frontmatter: frontmatter as SkillFrontmatter,
				level,
				_source: createSourceMeta(providerId, skillPath, level),
			});
		} catch {
			warnings.push(`Failed to read skill file: ${skillPath}`);
		}
	};

	const work = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const skillPath = path.join(dir, entry.name, "SKILL.md");
		if (fs.existsSync(skillPath)) {
			work.push(loadSkill(skillPath));
		}
	}
	await Promise.all(work);

	return { items, warnings };
}

/**
 * Expand environment variables in a string.
 * Supports ${VAR} and ${VAR:-default} syntax.
 */
function expandEnvVars(value: string, extraEnv?: Record<string, string>): string {
	return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_, varName: string, defaultValue?: string) => {
		const envValue = extraEnv?.[varName] ?? Bun.env[varName];
		if (envValue !== undefined) return envValue;
		if (defaultValue !== undefined) return defaultValue;
		return `\${${varName}}`;
	});
}

/**
 * Recursively expand environment variables in an object.
 */
export function expandEnvVarsDeep<T>(obj: T, extraEnv?: Record<string, string>): T {
	if (typeof obj === "string") {
		return expandEnvVars(obj, extraEnv) as T;
	}
	if (Array.isArray(obj)) {
		return obj.map(item => expandEnvVarsDeep(item, extraEnv)) as T;
	}
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = expandEnvVarsDeep(value, extraEnv);
		}
		return result as T;
	}
	return obj;
}

/**
 * Load files from a directory matching extensions.
 * Uses native glob for fast filesystem scanning with gitignore support.
 */
export async function loadFilesFromDir<T>(
	_ctx: LoadContext,
	dir: string,
	provider: string,
	level: "user" | "project",
	options: {
		/** File extensions to match (without dot) */
		extensions?: string[];
		/** Transform file to item (return null to skip) */
		transform: (name: string, content: string, path: string, source: SourceMeta) => T | null;
		/** Whether to recurse into subdirectories (default: false) */
		recursive?: boolean;
		/** Root directory for ignore file handling (unused, kept for API compat) */
		rootDir?: string;
		/** Ignore matcher (unused, kept for API compat) */
		ignoreMatcher?: IgnoreMatcher;
	},
): Promise<LoadResult<T>> {
	const items: T[] = [];
	const warnings: string[] = [];
	// Build glob pattern based on extensions and recursion
	const { extensions, recursive = false } = options;

	let pattern: string;
	if (extensions && extensions.length > 0) {
		const extPattern = extensions.length === 1 ? extensions[0] : `{${extensions.join(",")}}`;
		pattern = recursive ? `**/*.${extPattern}` : `*.${extPattern}`;
	} else {
		pattern = recursive ? "**/*" : "*";
	}

	// Use native glob for fast scanning with gitignore support
	let matches: Array<{ path: string }>;
	try {
		const result = await glob({
			pattern,
			path: dir,
			gitignore: true,
			hidden: false,
			fileType: FileType.File,
		});
		matches = result.matches;
	} catch {
		// Directory doesn't exist or isn't readable
		return { items, warnings };
	}

	// Read all matching files in parallel
	const fileResults = await Promise.all(
		matches.map(async match => {
			const filePath = path.join(dir, match.path);
			const content = await readFile(filePath);
			return { filePath, content };
		}),
	);

	for (const { filePath, content } of fileResults) {
		if (content === null) {
			warnings.push(`Failed to read file: ${filePath}`);
			continue;
		}

		const name = path.basename(filePath);
		const source = createSourceMeta(provider, filePath, level);

		try {
			const item = options.transform(name, content, filePath, source);
			if (item !== null) {
				items.push(item);
			}
		} catch (err) {
			warnings.push(`Failed to parse ${filePath}: ${err}`);
		}
	}
	return { items, warnings };
}

/**
 * Calculate depth of target directory relative to current working directory.
 * Depth is the number of directory levels from cwd to target.
 * - Positive depth: target is above cwd (parent/ancestor)
 * - Zero depth: target is cwd
 * - This uses path splitting to count directory levels
 */
export function calculateDepth(cwd: string, targetDir: string, separator: string): number {
	return cwd.split(separator).length - targetDir.split(separator).length;
}

interface ExtensionModuleManifest {
	extensions?: string[];
}

async function readExtensionModuleManifest(
	_ctx: LoadContext,
	packageJsonPath: string,
): Promise<ExtensionModuleManifest | null> {
	const content = await readFile(packageJsonPath);
	if (!content) return null;

	const pkg = tryParseJson<{ omp?: ExtensionModuleManifest; pi?: ExtensionModuleManifest }>(content);
	const manifest = pkg?.omp ?? pkg?.pi;
	if (manifest && typeof manifest === "object") {
		return manifest;
	}
	return null;
}

/**
 * Discover extension module entry points in a directory.
 *
 * Discovery rules:
 * 1. Direct files: `extensions/*.ts` or `*.js` → load
 * 2. Subdirectory with index: `extensions/<ext>/index.ts` or `index.js` → load
 * 3. Subdirectory with package.json: `extensions/<ext>/package.json` with "omp"/"pi" field → load declared paths
 *
 * No recursion beyond one level. Complex packages must use package.json manifest.
 * Uses native glob for fast filesystem scanning with gitignore support.
 */
export async function discoverExtensionModulePaths(_ctx: LoadContext, dir: string): Promise<string[]> {
	const discovered = new Set<string>();
	// Find all candidate files in parallel using glob
	const [directFiles, indexFiles, packageJsonFiles] = await Promise.all([
		// 1. Direct *.ts or *.js files
		globIf(dir, "*.{ts,js}", FileType.File, false),
		// 2. Subdirectory index files
		globIf(dir, "*/index.{ts,js}", FileType.File, false),
		// 3. Subdirectory package.json files
		globIf(dir, "*/package.json", FileType.File, false),
	]);

	// Process direct files
	for (const match of directFiles) {
		if (match.path.includes("/")) continue;
		discovered.add(path.join(dir, match.path));
	}
	// Track which subdirectories have package.json manifests with declared extensions
	const subdirsWithDeclaredExtensions = new Set<string>();
	for (const match of packageJsonFiles) {
		const subdir = path.dirname(match.path); // e.g., "my-extension"
		const packageJsonPath = path.join(dir, match.path);
		const manifest = await readExtensionModuleManifest(_ctx, packageJsonPath);
		const declaredExtensions =
			manifest?.extensions?.filter((extPath): extPath is string => typeof extPath === "string") ?? [];
		if (declaredExtensions.length === 0) continue;
		subdirsWithDeclaredExtensions.add(subdir);
		const subdirPath = path.join(dir, subdir);
		for (const extPath of declaredExtensions) {
			const resolvedExtPath = path.resolve(subdirPath, extPath);
			const content = await readFile(resolvedExtPath);
			if (content !== null) {
				discovered.add(resolvedExtPath);
			}
		}
	}
	const preferredIndexBySubdir = new Map<string, string>();
	for (const match of indexFiles) {
		if (match.path.split("/").length !== 2) continue;
		const subdir = path.dirname(match.path);
		if (subdirsWithDeclaredExtensions.has(subdir)) continue;
		const existing = preferredIndexBySubdir.get(subdir);
		if (!existing || (existing.endsWith("index.js") && match.path.endsWith("index.ts"))) {
			preferredIndexBySubdir.set(subdir, match.path);
		}
	}
	for (const preferredPath of preferredIndexBySubdir.values()) {
		discovered.add(path.join(dir, preferredPath));
	}
	return [...discovered];
}

/**
 * Derive a stable extension name from a path.
 */
export function getExtensionNameFromPath(extensionPath: string): string {
	const base = extensionPath.replace(/\\/g, "/").split("/").pop() ?? extensionPath;

	if (base === "index.ts" || base === "index.js") {
		const parts = extensionPath.replace(/\\/g, "/").split("/");
		const parent = parts[parts.length - 2];
		return parent ?? base;
	}

	const dot = base.lastIndexOf(".");
	if (dot > 0) {
		return base.slice(0, dot);
	}

	return base;
}

// =============================================================================
// Claude Code Plugin Cache Helpers
// =============================================================================

/**
 * Entry for an installed Claude Code plugin.
 */
export interface ClaudePluginEntry {
	scope: "user" | "project";
	installPath: string;
	version: string;
	installedAt: string;
	lastUpdated: string;
	gitCommitSha?: string;
}

/**
 * Claude Code installed_plugins.json registry format.
 */
export interface ClaudePluginsRegistry {
	version: number;
	plugins: Record<string, ClaudePluginEntry[]>;
}

/**
 * Resolved plugin root for loading.
 */
export interface ClaudePluginRoot {
	/** Plugin ID (e.g., "simpleclaude-core@simpleclaude") */
	id: string;
	/** Marketplace name */
	marketplace: string;
	/** Plugin name */
	plugin: string;
	/** Version string */
	version: string;
	/** Absolute path to plugin root */
	path: string;
	/** Whether this is a user or project scope plugin */
	scope: "user" | "project";
}

/**
 * Parse Claude Code installed_plugins.json content.
 */
export function parseClaudePluginsRegistry(content: string): ClaudePluginsRegistry | null {
	const data = tryParseJson<ClaudePluginsRegistry>(content);
	if (!data || typeof data !== "object") return null;
	if (
		typeof data.version !== "number" ||
		!data.plugins ||
		typeof data.plugins !== "object" ||
		Array.isArray(data.plugins)
	)
		return null;
	return data;
}

/**
 * List all installed Claude Code plugin roots from the plugin cache.
 * Reads ~/.claude/plugins/installed_plugins.json and resolves plugin paths.
 *
 * Results are cached per home directory to avoid repeated parsing.
 */
const pluginRootsCache = new Map<string, { roots: ClaudePluginRoot[]; warnings: string[] }>();

export async function listClaudePluginRoots(home: string): Promise<{ roots: ClaudePluginRoot[]; warnings: string[] }> {
	const cached = pluginRootsCache.get(home);
	if (cached) return cached;

	const roots: ClaudePluginRoot[] = [];
	const warnings: string[] = [];

	const registryPath = path.join(home, ".claude", "plugins", "installed_plugins.json");
	const content = await readFile(registryPath);

	if (!content) {
		// No registry file - not an error, just no plugins
		const result = { roots, warnings };
		pluginRootsCache.set(home, result);
		return result;
	}

	const registry = parseClaudePluginsRegistry(content);
	if (!registry) {
		warnings.push(`Failed to parse Claude Code plugin registry: ${registryPath}`);
		const result = { roots, warnings };
		pluginRootsCache.set(home, result);
		return result;
	}

	for (const [pluginId, entries] of Object.entries(registry.plugins)) {
		if (!Array.isArray(entries) || entries.length === 0) continue;

		// Parse plugin ID format: "plugin-name@marketplace"
		const atIndex = pluginId.lastIndexOf("@");
		if (atIndex === -1) {
			warnings.push(`Invalid plugin ID format (missing @marketplace): ${pluginId}`);
			continue;
		}

		const pluginName = pluginId.slice(0, atIndex);
		const marketplace = pluginId.slice(atIndex + 1);

		// Process all valid entries, not just the first one.
		// This handles plugins with multiple installs (different scopes/versions).
		for (const entry of entries) {
			if (!entry.installPath || typeof entry.installPath !== "string") {
				warnings.push(`Plugin ${pluginId} entry has no installPath`);
				continue;
			}

			roots.push({
				id: pluginId,
				marketplace,
				plugin: pluginName,
				version: entry.version || "unknown",
				path: entry.installPath,
				scope: entry.scope || "user",
			});
		}
	}

	const result = { roots, warnings };
	pluginRootsCache.set(home, result);
	return result;
}

/**
 * Clear the plugin roots cache (useful for testing or when plugins change).
 */
export function clearClaudePluginRootsCache(): void {
	pluginRootsCache.clear();
}
