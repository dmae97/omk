/**
 * System prompt construction and project context loading
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $env, hasFsCode, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { untilAborted } from "@oh-my-pi/pi-utils/abortable";
import { getGpuCachePath, getProjectDir } from "@oh-my-pi/pi-utils/dirs";
import { $ } from "bun";
import { contextFileCapability } from "./capability/context-file";
import { systemPromptCapability } from "./capability/system-prompt";
import { renderPromptTemplate } from "./config/prompt-templates";
import type { SkillsSettings } from "./config/settings";
import { type ContextFile, loadCapability, type SystemPrompt as SystemPromptFile } from "./discovery";
import { loadSkills, type Skill } from "./extensibility/skills";
import customSystemPromptTemplate from "./prompts/system/custom-system-prompt.md" with { type: "text" };
import systemPromptTemplate from "./prompts/system/system-prompt.md" with { type: "text" };
import type { ToolName } from "./tools";

/** Conditional startup debug prints (stderr) when PI_DEBUG_STARTUP is set */
const debugStartup = $env.PI_DEBUG_STARTUP ? (stage: string) => process.stderr.write(`[startup] ${stage}\n`) : () => {};

interface GitContext {
	isRepo: boolean;
	currentBranch: string;
	mainBranch: string;
	status: string;
	commits: string;
}

type PreloadedSkill = { name: string; content: string };

async function loadPreloadedSkillContents(preloadedSkills: Skill[]): Promise<PreloadedSkill[]> {
	const contents = await Promise.all(
		preloadedSkills.map(async skill => {
			try {
				const content = await Bun.file(skill.filePath).text();
				return { name: skill.name, content };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Failed to load skill "${skill.name}" from ${skill.filePath}: ${message}`);
			}
		}),
	);

	return contents;
}

/**
 * Load git context for the system prompt.
 * Returns structured git data or null if not in a git repo.
 */
export async function loadGitContext(cwd: string): Promise<GitContext | null> {
	const timeout = 3000;
	const abortSignal = AbortSignal.timeout(timeout);

	const git = async (...args: string[]): Promise<string | null> => {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "ignore",
			timeout: timeout,
		});
		return untilAborted(abortSignal, async () => {
			const exitCode = await proc.exited;
			const stdout = await proc.stdout.text();
			return exitCode === 0 ? stdout.trim() : null;
		});
	};

	// Check if inside a git repo
	const isGitRepo = await git("rev-parse", "--is-inside-work-tree");
	if (isGitRepo !== "true") return null;
	const currentBranch = await git("rev-parse", "--abbrev-ref", "HEAD");
	if (!currentBranch) return null;
	let mainBranch = "main";
	const mainExists = await git("rev-parse", "--verify", "main");
	if (mainExists === null) {
		const masterExists = await git("rev-parse", "--verify", "master");
		if (masterExists !== null) mainBranch = "master";
	}

	const [status, commits] = await Promise.all([
		git("status", "--porcelain", "--untracked-files=no"),
		git("log", "--oneline", "-5"),
	]);
	return {
		isRepo: true,
		currentBranch,
		mainBranch,
		status: status === "" ? "(clean)" : (status ?? "(status unavailable)"),
		commits: commits && commits.length > 0 ? commits : "(no commits)",
	};
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

function parseWmicTable(output: string, header: string): string | null {
	const lines = output
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const filtered = lines.filter(line => line.toLowerCase() !== header.toLowerCase());
	return filtered[0] ?? null;
}

const AGENTS_MD_MIN_DEPTH = 1;
const AGENTS_MD_MAX_DEPTH = 4;
const AGENTS_MD_LIMIT = 200;
const SYSTEM_PROMPT_PREP_TIMEOUT_MS = 5000;
const AGENTS_MD_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

interface AgentsMdSearch {
	scopePath: string;
	limit: number;
	pattern: string;
	files: string[];
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function shouldSkipAgentsDir(name: string): boolean {
	if (AGENTS_MD_EXCLUDED_DIRS.has(name)) return true;
	return name.startsWith(".");
}

async function collectAgentsMdFiles(
	root: string,
	dir: string,
	depth: number,
	limit: number,
	discovered: Set<string>,
): Promise<void> {
	if (depth > AGENTS_MD_MAX_DEPTH || discovered.size >= limit) {
		return;
	}

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	if (depth >= AGENTS_MD_MIN_DEPTH) {
		const hasAgentsMd = entries.some(entry => entry.isFile() && entry.name === "AGENTS.md");
		if (hasAgentsMd) {
			const relPath = normalizePath(path.relative(root, path.join(dir, "AGENTS.md")));
			if (relPath.length > 0) {
				discovered.add(relPath);
			}
			if (discovered.size >= limit) {
				return;
			}
		}
	}

	if (depth === AGENTS_MD_MAX_DEPTH) {
		return;
	}

	const childDirs = entries
		.filter(entry => entry.isDirectory() && !shouldSkipAgentsDir(entry.name))
		.map(entry => entry.name)
		.sort();

	await Promise.all(
		childDirs.map(async child => {
			if (discovered.size >= limit) return;
			await collectAgentsMdFiles(root, path.join(dir, child), depth + 1, limit, discovered);
		}),
	);
}

async function listAgentsMdFiles(root: string, limit: number): Promise<string[]> {
	try {
		const discovered = new Set<string>();
		await collectAgentsMdFiles(root, root, 0, limit, discovered);
		return Array.from(discovered).sort().slice(0, limit);
	} catch {
		return [];
	}
}

async function buildAgentsMdSearch(cwd: string): Promise<AgentsMdSearch> {
	const files = await listAgentsMdFiles(cwd, AGENTS_MD_LIMIT);
	return {
		scopePath: ".",
		limit: AGENTS_MD_LIMIT,
		pattern: `AGENTS.md depth ${AGENTS_MD_MIN_DEPTH}-${AGENTS_MD_MAX_DEPTH}`,
		files,
	};
}

async function getGpuModel(): Promise<string | null> {
	switch (process.platform) {
		case "win32": {
			const output = await $`wmic path win32_VideoController get name`
				.quiet()
				.text()
				.catch(() => null);
			return output ? parseWmicTable(output, "Name") : null;
		}
		case "linux": {
			const output = await $`lspci`
				.quiet()
				.text()
				.catch(() => null);
			if (!output) return null;
			const gpus: Array<{ name: string; priority: number }> = [];
			for (const line of output.split("\n")) {
				if (!/(VGA|3D|Display)/i.test(line)) continue;
				const parts = line.split(":");
				const name = parts.length > 1 ? parts.slice(1).join(":").trim() : line.trim();
				const nameLower = name.toLowerCase();
				// Skip BMC/server management adapters
				if (/aspeed|matrox g200|mgag200/i.test(name)) continue;
				// Prioritize discrete GPUs
				let priority = 0;
				if (
					nameLower.includes("nvidia") ||
					nameLower.includes("geforce") ||
					nameLower.includes("quadro") ||
					nameLower.includes("rtx")
				) {
					priority = 3;
				} else if (nameLower.includes("amd") || nameLower.includes("radeon") || nameLower.includes("rx ")) {
					priority = 3;
				} else if (nameLower.includes("intel")) {
					priority = 1;
				} else {
					priority = 2;
				}
				gpus.push({ name, priority });
			}
			if (gpus.length === 0) return null;
			gpus.sort((a, b) => b.priority - a.priority);
			return gpus[0].name;
		}
		default:
			return null;
	}
}

function getTerminalName(): string | undefined {
	const termProgram = Bun.env.TERM_PROGRAM;
	const termProgramVersion = Bun.env.TERM_PROGRAM_VERSION;
	if (termProgram) {
		return termProgramVersion ? `${termProgram} ${termProgramVersion}` : termProgram;
	}

	if (Bun.env.WT_SESSION) return "Windows Terminal";

	const term = firstNonEmpty(Bun.env.TERM, Bun.env.COLORTERM, Bun.env.TERMINAL_EMULATOR);
	return term ?? undefined;
}

function normalizeDesktopValue(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parts = trimmed
		.split(":")
		.map(part => part.trim())
		.filter(Boolean);
	return parts[0] ?? trimmed;
}

function getDesktopEnvironment(): string | undefined {
	if (Bun.env.KDE_FULL_SESSION === "true") return "KDE";
	const raw = firstNonEmpty(
		Bun.env.XDG_CURRENT_DESKTOP,
		Bun.env.DESKTOP_SESSION,
		Bun.env.XDG_SESSION_DESKTOP,
		Bun.env.GDMSESSION,
	);
	return raw ? normalizeDesktopValue(raw) : undefined;
}

function matchKnownWindowManager(value: string): string | null {
	const normalized = value.toLowerCase();
	const candidates = [
		"sway",
		"i3",
		"i3wm",
		"bspwm",
		"openbox",
		"awesome",
		"herbstluftwm",
		"fluxbox",
		"icewm",
		"dwm",
		"hyprland",
		"wayfire",
		"river",
		"labwc",
		"qtile",
	];
	for (const candidate of candidates) {
		if (normalized.includes(candidate)) return candidate;
	}
	return null;
}

function getWindowManager(): string | undefined {
	const explicit = firstNonEmpty(Bun.env.WINDOWMANAGER);
	if (explicit) return explicit;

	const desktop = firstNonEmpty(Bun.env.XDG_CURRENT_DESKTOP, Bun.env.DESKTOP_SESSION);
	if (desktop) {
		const matched = matchKnownWindowManager(desktop);
		if (matched) return matched;
	}

	return undefined;
}

/** Cached system info structure */
interface GpuCache {
	gpu: string;
}

function getSystemInfoCachePath(): string {
	return getGpuCachePath();
}

async function loadGpuCache(): Promise<GpuCache | null> {
	try {
		const cachePath = getSystemInfoCachePath();
		const file = Bun.file(cachePath);
		if (!(await file.exists())) return null;
		const content = await file.json();
		return content as GpuCache;
	} catch {
		return null;
	}
}

async function saveGpuCache(info: GpuCache): Promise<void> {
	try {
		const cachePath = getSystemInfoCachePath();
		await Bun.write(cachePath, JSON.stringify(info, null, "\t"));
	} catch {
		// Silently ignore cache write failures
	}
}

async function getCachedGpu(): Promise<string | undefined> {
	debugStartup("system-prompt:getEnvironmentInfo:getCachedGpu:start");
	const cached = await loadGpuCache();
	if (cached) return cached.gpu;
	debugStartup("system-prompt:getEnvironmentInfo:getGpuModel");
	const gpu = await getGpuModel();
	debugStartup("system-prompt:getEnvironmentInfo:saveGpuCache");
	if (gpu) await saveGpuCache({ gpu });
	return gpu ?? undefined;
}
async function getEnvironmentInfo(): Promise<Array<{ label: string; value: string }>> {
	debugStartup("system-prompt:getEnvironmentInfo:getCachedGpu");
	const gpu = await getCachedGpu();
	debugStartup("system-prompt:getEnvironmentInfo:getCpuInfo");
	const cpus = os.cpus();
	debugStartup("system-prompt:getEnvironmentInfo:buildEntries");
	const entries: Array<{ label: string; value: string | undefined }> = [
		{ label: "OS", value: `${os.platform()} ${os.release()}` },
		{ label: "Distro", value: os.type() },
		{ label: "Kernel", value: os.version() },
		{ label: "Arch", value: os.arch() },
		{ label: "CPU", value: `${cpus.length}x ${cpus[0]?.model}` },
		{ label: "GPU", value: gpu },
		{ label: "Terminal", value: getTerminalName() },
		{ label: "DE", value: getDesktopEnvironment() },
		{ label: "WM", value: getWindowManager() },
	];
	debugStartup("system-prompt:getEnvironmentInfo:done");
	return entries.filter((e): e is { label: string; value: string } => e.value != null && e.value !== "unknown");
}

/** Resolve input as file path or literal string */
export async function resolvePromptInput(input: string | undefined, description: string): Promise<string | undefined> {
	if (!input) {
		return undefined;
	} else if (input.includes("\n")) {
		return input;
	}

	try {
		return await Bun.file(input).text();
	} catch (error) {
		if (!hasFsCode(error, "ENAMETOOLONG") && !isEnoent(error)) {
			logger.warn(`Could not read ${description} file`, { path: input, error: String(error) });
		}
		return input;
	}
}

export interface LoadContextFilesOptions {
	/** Working directory to start walking up from. Default: getProjectDir() */
	cwd?: string;
}

/**
 * Load all project context files using the capability API.
 * Returns {path, content, depth} entries for all discovered context files.
 * Files are sorted by depth (descending) so files closer to cwd appear last/more prominent.
 */
export async function loadProjectContextFiles(
	options: LoadContextFilesOptions = {},
): Promise<Array<{ path: string; content: string; depth?: number }>> {
	const resolvedCwd = options.cwd ?? getProjectDir();

	const result = await loadCapability(contextFileCapability.id, { cwd: resolvedCwd });

	// Convert ContextFile items and preserve depth info
	const files = result.items.map(item => {
		const contextFile = item as ContextFile;
		return {
			path: contextFile.path,
			content: contextFile.content,
			depth: contextFile.depth,
		};
	});

	// Sort by depth (descending): higher depth (farther from cwd) comes first,
	// so files closer to cwd appear later and are more prominent
	files.sort((a, b) => {
		const depthA = a.depth ?? -1;
		const depthB = b.depth ?? -1;
		return depthB - depthA;
	});

	return files;
}

/**
 * Load system prompt customization files (SYSTEM.md).
 * Returns combined content from all discovered SYSTEM.md files.
 */
export async function loadSystemPromptFiles(options: LoadContextFilesOptions = {}): Promise<string | null> {
	const resolvedCwd = options.cwd ?? getProjectDir();

	const result = await loadCapability<SystemPromptFile>(systemPromptCapability.id, { cwd: resolvedCwd });

	if (result.items.length === 0) return null;

	// Combine all SYSTEM.md contents (user-level first, then project-level)
	const userLevel = result.items.filter(item => item.level === "user");
	const projectLevel = result.items.filter(item => item.level === "project");

	const parts: string[] = [];
	for (const item of [...userLevel, ...projectLevel]) {
		parts.push(item.content);
	}

	return parts.join("\n\n");
}

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. */
	tools?: Map<string, { description: string; label: string }>;
	/** Tool names to include in prompt. */
	toolNames?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Repeat full tool descriptions in system prompt. Default: false */
	repeatToolDescriptions?: boolean;
	/** Skills settings for discovery. */
	skillsSettings?: SkillsSettings;
	/** Working directory. Default: getProjectDir() */
	cwd?: string;
	/** Pre-loaded context files (skips discovery if provided). */
	contextFiles?: Array<{ path: string; content: string; depth?: number }>;
	/** Pre-loaded skills (skips discovery if provided). */
	skills?: Skill[];
	/** Skills to inline into the system prompt instead of listing available skills. */
	preloadedSkills?: Skill[];
	/** Pre-loaded rulebook rules (rules with descriptions, excluding TTSR and always-apply). */
	rules?: Array<{ name: string; description?: string; path: string; globs?: string[] }>;
}

/** Build the system prompt with tools, guidelines, and context */
export async function buildSystemPrompt(options: BuildSystemPromptOptions = {}): Promise<string> {
	if ($env.NULL_PROMPT === "true") {
		return "";
	}

	const {
		customPrompt,
		tools,
		appendSystemPrompt,
		repeatToolDescriptions = false,
		skillsSettings,
		toolNames,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		preloadedSkills: providedPreloadedSkills,
		rules,
	} = options;
	const resolvedCwd = cwd ?? getProjectDir();
	const preloadedSkills = providedPreloadedSkills;

	const prepPromise = (async () => {
		const systemPromptCustomizationPromise = (async () => {
			const customization = await loadSystemPromptFiles({ cwd: resolvedCwd });
			debugStartup("system-prompt:loadSystemPromptFiles:done");
			return customization;
		})();
		const contextFilesPromise = providedContextFiles
			? Promise.resolve(providedContextFiles)
			: loadProjectContextFiles({ cwd: resolvedCwd });
		const agentsMdSearchPromise = buildAgentsMdSearch(resolvedCwd);
		const skillsPromise: Promise<Skill[]> =
			providedSkills !== undefined
				? Promise.resolve(providedSkills)
				: skillsSettings?.enabled !== false
					? loadSkills({ ...skillsSettings, cwd: resolvedCwd }).then(result => result.skills)
					: Promise.resolve([]);
		const preloadedSkillContentsPromise = (async () => {
			debugStartup("system-prompt:loadPreloadedSkills:start");
			const loaded = preloadedSkills ? await loadPreloadedSkillContents(preloadedSkills) : [];
			debugStartup("system-prompt:loadPreloadedSkills:done");
			return loaded;
		})();
		const gitPromise = (async () => {
			debugStartup("system-prompt:loadGitContext:start");
			const loaded = await loadGitContext(resolvedCwd);
			debugStartup("system-prompt:loadGitContext:done");
			return loaded;
		})();

		const [
			resolvedCustomPrompt,
			resolvedAppendPrompt,
			systemPromptCustomization,
			contextFiles,
			agentsMdSearch,
			skills,
			preloadedSkillContents,
			git,
		] = await Promise.all([
			resolvePromptInput(customPrompt, "system prompt"),
			resolvePromptInput(appendSystemPrompt, "append system prompt"),
			systemPromptCustomizationPromise,
			contextFilesPromise,
			agentsMdSearchPromise,
			skillsPromise,
			preloadedSkillContentsPromise,
			gitPromise,
		]);

		return {
			resolvedCustomPrompt,
			resolvedAppendPrompt,
			systemPromptCustomization,
			contextFiles,
			agentsMdSearch,
			skills,
			preloadedSkillContents,
			git,
		};
	})();

	const prepResult = await Promise.race([
		prepPromise
			.then(value => ({ type: "ready" as const, value }))
			.catch(error => ({ type: "error" as const, error })),
		Bun.sleep(SYSTEM_PROMPT_PREP_TIMEOUT_MS).then(() => ({ type: "timeout" as const })),
	]);

	let resolvedCustomPrompt: string | undefined;
	let resolvedAppendPrompt: string | undefined;
	let systemPromptCustomization: string | null = null;
	let contextFiles: Array<{ path: string; content: string; depth?: number }> = providedContextFiles ?? [];
	let agentsMdSearch: AgentsMdSearch = {
		scopePath: ".",
		limit: AGENTS_MD_LIMIT,
		pattern: `AGENTS.md depth ${AGENTS_MD_MIN_DEPTH}-${AGENTS_MD_MAX_DEPTH}`,
		files: [],
	};
	let skills: Skill[] = providedSkills ?? [];
	let preloadedSkillContents: PreloadedSkill[] = [];
	let git: GitContext | null = null;

	if (prepResult.type === "timeout") {
		logger.warn("System prompt preparation timed out; using minimal startup context", {
			cwd: resolvedCwd,
			timeoutMs: SYSTEM_PROMPT_PREP_TIMEOUT_MS,
		});
		process.stderr.write(
			`Warning: system prompt preparation timed out after ${SYSTEM_PROMPT_PREP_TIMEOUT_MS}ms; using minimal startup context.\n`,
		);
	} else if (prepResult.type === "error") {
		logger.warn("System prompt preparation failed; using minimal startup context", {
			cwd: resolvedCwd,
			error: String(prepResult.error),
		});
		process.stderr.write("Warning: system prompt preparation failed; using minimal startup context.\n");
	} else {
		resolvedCustomPrompt = prepResult.value.resolvedCustomPrompt;
		resolvedAppendPrompt = prepResult.value.resolvedAppendPrompt;
		systemPromptCustomization = prepResult.value.systemPromptCustomization;
		contextFiles = prepResult.value.contextFiles;
		agentsMdSearch = prepResult.value.agentsMdSearch;
		skills = prepResult.value.skills;
		preloadedSkillContents = prepResult.value.preloadedSkillContents;
		git = prepResult.value.git;
	}

	const now = new Date();
	const date = now.toLocaleDateString("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});

	// Build tool descriptions array
	// Priority: toolNames (explicit list) > tools (Map) > defaults
	// Default includes both bash and python; actual availability determined by settings in createTools
	const defaultToolNames: ToolName[] = ["read", "bash", "python", "edit", "write"];
	let toolNamesArray: string[];
	if (toolNames !== undefined) {
		// Explicit toolNames list provided (could be empty)
		toolNamesArray = toolNames;
	} else if (tools !== undefined) {
		// Tools map provided
		toolNamesArray = Array.from(tools.keys());
	} else {
		// Use defaults
		toolNamesArray = defaultToolNames;
	}

	// Build tool descriptions for system prompt rendering
	const toolDescriptions = toolNamesArray.map(name => ({
		name,
		description: tools?.get(name)?.description ?? "",
	}));

	// Filter skills to only include those with read tool
	const hasRead = tools?.has("read");
	const filteredSkills = preloadedSkills === undefined && hasRead ? skills : [];

	if (resolvedCustomPrompt) {
		return renderPromptTemplate(customSystemPromptTemplate, {
			systemPromptCustomization: systemPromptCustomization ?? "",
			customPrompt: resolvedCustomPrompt,
			appendPrompt: resolvedAppendPrompt ?? "",
			contextFiles,
			agentsMdSearch,
			git,
			skills: filteredSkills,
			preloadedSkills: preloadedSkillContents,
			rules: rules ?? [],
			date,
			dateTime,
			cwd: resolvedCwd,
		});
	}

	debugStartup("system-prompt:getEnvironmentInfo:start");
	const environment = await getEnvironmentInfo();
	debugStartup("system-prompt:getEnvironmentInfo:done");
	return renderPromptTemplate(systemPromptTemplate, {
		tools: toolNamesArray,
		toolDescriptions,
		repeatToolDescriptions,
		environment,
		systemPromptCustomization: systemPromptCustomization ?? "",
		contextFiles,
		agentsMdSearch,
		git,
		skills: filteredSkills,
		preloadedSkills: preloadedSkillContents,
		rules: rules ?? [],
		date,
		dateTime,
		cwd: resolvedCwd,
		appendSystemPrompt: resolvedAppendPrompt ?? "",
	});
}
