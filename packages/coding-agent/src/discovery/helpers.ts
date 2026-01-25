/**
 * Shared helpers for discovery providers.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { readDirEntries, readFile } from "../capability/fs";
import type { Skill, SkillFrontmatter } from "../capability/skill";
import type { LoadContext, LoadResult, SourceMeta } from "../capability/types";
import { parseFrontmatter } from "../utils/frontmatter";

const VALID_THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Normalize unicode spaces to regular spaces.
 */
export function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

/**
 * Expand ~ to home directory and normalize unicode spaces.
 */
export function expandPath(p: string): string {
	const normalized = normalizeUnicodeSpaces(p);
	if (normalized.startsWith("~/")) {
		return path.join(os.homedir(), normalized.slice(2));
	}
	if (normalized.startsWith("~")) {
		return path.join(os.homedir(), normalized.slice(1));
	}
	return normalized;
}

/**
 * Standard paths for each config source.
 */
export const SOURCE_PATHS = {
	native: {
		userBase: ".omp",
		userAgent: ".omp/agent",
		projectDir: ".omp",
		aliases: [".pi"], // .pi is an alias for backwards compat
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

	const tools = parseArrayOrCSV(frontmatter.tools);

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

	return { name, description, tools, spawns, model, output, thinkingLevel };
}

export async function loadSkillsFromDir(
	_ctx: LoadContext,
	options: {
		dir: string;
		providerId: string;
		level: "user" | "project";
		requireDescription?: boolean;
	},
): Promise<LoadResult<Skill>> {
	const items: Skill[] = [];
	const warnings: string[] = [];
	const { dir, level, providerId, requireDescription = false } = options;

	const entries = await readDirEntries(dir);
	const skillDirs = entries.filter(
		entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
	);

	const results = await Promise.all(
		skillDirs.map(async entry => {
			const skillFile = path.join(dir, entry.name, "SKILL.md");
			const content = await readFile(skillFile);
			if (!content) {
				return { item: null as Skill | null, warning: null as string | null };
			}

			const { frontmatter, body } = parseFrontmatter(content, { source: skillFile });
			if (requireDescription && !frontmatter.description) {
				return { item: null as Skill | null, warning: null as string | null };
			}

			return {
				item: {
					name: (frontmatter.name as string) || entry.name,
					path: skillFile,
					content: body,
					frontmatter: frontmatter as SkillFrontmatter,
					level,
					_source: createSourceMeta(providerId, skillFile, level),
				},
				warning: null as string | null,
			};
		}),
	);

	for (const result of results) {
		if (result.warning) warnings.push(result.warning);
		if (result.item) items.push(result.item);
	}

	return { items, warnings };
}

/**
 * Expand environment variables in a string.
 * Supports ${VAR} and ${VAR:-default} syntax.
 */
export function expandEnvVars(value: string, extraEnv?: Record<string, string>): string {
	return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_, varName: string, defaultValue?: string) => {
		const envValue = extraEnv?.[varName] ?? process.env[varName];
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
 * Load files from a directory matching a pattern.
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
		/** Whether to recurse into subdirectories */
		recursive?: boolean;
	},
): Promise<LoadResult<T>> {
	const entries = await readDirEntries(dir);

	const visibleEntries = entries.filter(entry => !entry.name.startsWith("."));

	const directories = options.recursive ? visibleEntries.filter(entry => entry.isDirectory()) : [];

	const files = visibleEntries
		.filter(entry => entry.isFile())
		.filter(entry => {
			if (!options.extensions) return true;
			return options.extensions.some(ext => entry.name.endsWith(`.${ext}`));
		});

	const [subResults, fileResults] = await Promise.all([
		Promise.all(
			directories.map(entry => loadFilesFromDir(_ctx, path.join(dir, entry.name), provider, level, options)),
		),
		Promise.all(
			files.map(async entry => {
				const filePath = path.join(dir, entry.name);
				const content = await readFile(filePath);
				return { entry, path: filePath, content };
			}),
		),
	]);

	const items: T[] = [];
	const warnings: string[] = [];

	for (const subResult of subResults) {
		items.push(...subResult.items);
		if (subResult.warnings) warnings.push(...subResult.warnings);
	}

	for (const { entry, path, content } of fileResults) {
		if (content === null) {
			warnings.push(`Failed to read file: ${path}`);
			continue;
		}

		const source = createSourceMeta(provider, path, level);

		try {
			const item = options.transform(entry.name, content, path, source);
			if (item !== null) {
				items.push(item);
			}
		} catch (err) {
			warnings.push(`Failed to parse ${path}: ${err}`);
		}
	}

	return { items, warnings };
}

/**
 * Parse JSON safely.
 */
export function parseJSON<T>(content: string): T | null {
	try {
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
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

	const pkg = parseJSON<{ omp?: ExtensionModuleManifest; pi?: ExtensionModuleManifest }>(content);
	const manifest = pkg?.omp ?? pkg?.pi;
	if (manifest && typeof manifest === "object") {
		return manifest;
	}
	return null;
}

function isExtensionModuleFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
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
 */
export async function discoverExtensionModulePaths(ctx: LoadContext, dir: string): Promise<string[]> {
	const discovered: string[] = [];
	const entries = await readDirEntries(dir);

	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

		const entryPath = path.join(dir, entry.name);

		// 1. Direct files: *.ts or *.js
		if (entry.isFile() && isExtensionModuleFile(entry.name)) {
			discovered.push(entryPath);
			continue;
		}

		// 2 & 3. Subdirectories
		if (entry.isDirectory()) {
			const subEntries = await readDirEntries(entryPath);
			const subFileNames = new Set(subEntries.filter(e => e.isFile()).map(e => e.name));

			// Check for package.json with "omp"/"pi" field first
			if (subFileNames.has("package.json")) {
				const packageJsonPath = path.join(entryPath, "package.json");
				const manifest = await readExtensionModuleManifest(ctx, packageJsonPath);
				if (manifest?.extensions && Array.isArray(manifest.extensions)) {
					for (const extPath of manifest.extensions) {
						const resolvedExtPath = path.resolve(entryPath, extPath);
						const content = await readFile(resolvedExtPath);
						if (content !== null) {
							discovered.push(resolvedExtPath);
						}
					}
					continue;
				}
			}

			// Check for index.ts or index.js
			if (subFileNames.has("index.ts")) {
				discovered.push(path.join(entryPath, "index.ts"));
			} else if (subFileNames.has("index.js")) {
				discovered.push(path.join(entryPath, "index.js"));
			}
		}
	}

	return discovered;
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
