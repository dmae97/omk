/**
 * System prompt construction and project context loading
 */
import * as os from "node:os";
import * as path from "node:path";
import { getSystemInfo as getNativeSystemInfo, type SystemInfo } from "@oh-my-pi/pi-natives";
import { $env } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import chalk from "chalk";
import { contextFileCapability } from "./capability/context-file";
import { systemPromptCapability } from "./capability/system-prompt";
import { renderPromptTemplate } from "./config/prompt-templates";
import type { SkillsSettings } from "./config/settings";
import { type ContextFile, loadCapability, type SystemPrompt as SystemPromptFile } from "./discovery";
import { loadSkills, type Skill } from "./extensibility/skills";
import customSystemPromptTemplate from "./prompts/system/custom-system-prompt.md" with { type: "text" };
import systemPromptTemplate from "./prompts/system/system-prompt.md" with { type: "text" };
import type { ToolName } from "./tools";

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
	const git = (...args: string[]) =>
		$`git ${args}`
			.cwd(cwd)
			.quiet()
			.text()
			.catch(() => null)
			.then(text => text?.trim() ?? null);

	// Check if inside a git repo
	const isGitRepo = await git("rev-parse", "--is-inside-work-tree");
	if (isGitRepo !== "true") return null;

	// Get current branch
	const currentBranch = await git("rev-parse", "--abbrev-ref", "HEAD");
	if (!currentBranch) return null;

	// Detect main branch (check for 'main' first, then 'master')
	let mainBranch = "main";
	const mainExists = await git("rev-parse", "--verify", "main");
	if (mainExists === null) {
		const masterExists = await git("rev-parse", "--verify", "master");
		if (masterExists !== null) mainBranch = "master";
	}

	// Get git status (porcelain format for parsing)
	const status = (await git("status", "--porcelain")) || "(clean)";

	// Get recent commits
	const commits = (await git("log", "--oneline", "-5")) || "(no commits)";
	return {
		isRepo: true,
		currentBranch,
		mainBranch,
		status,
		commits,
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

const AGENTS_MD_PATTERN = "**/AGENTS.md";
const AGENTS_MD_LIMIT = 200;

interface AgentsMdSearch {
	scopePath: string;
	limit: number;
	pattern: string;
	files: string[];
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function listAgentsMdFiles(root: string, limit: number): string[] {
	try {
		const entries = Array.from(
			new Bun.Glob(AGENTS_MD_PATTERN).scanSync({ cwd: root, onlyFiles: true, dot: false, absolute: false }),
		);
		const normalized = entries
			.map(entry => normalizePath(entry))
			.filter(entry => entry.length > 0 && !entry.includes("node_modules"))
			.sort();
		return normalized.length > limit ? normalized.slice(0, limit) : normalized;
	} catch {
		return [];
	}
}

function buildAgentsMdSearch(cwd: string): AgentsMdSearch {
	const files = listAgentsMdFiles(cwd, AGENTS_MD_LIMIT);
	return {
		scopePath: ".",
		limit: AGENTS_MD_LIMIT,
		pattern: AGENTS_MD_PATTERN,
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

function getTerminalName(): string {
	const termProgram = Bun.env.TERM_PROGRAM;
	const termProgramVersion = Bun.env.TERM_PROGRAM_VERSION;
	if (termProgram) {
		return termProgramVersion ? `${termProgram} ${termProgramVersion}` : termProgram;
	}

	if (Bun.env.WT_SESSION) return "Windows Terminal";

	const term = firstNonEmpty(Bun.env.TERM, Bun.env.COLORTERM, Bun.env.TERMINAL_EMULATOR);
	return term ?? "unknown";
}

function normalizeDesktopValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "unknown";
	const parts = trimmed
		.split(":")
		.map(part => part.trim())
		.filter(Boolean);
	return parts[0] ?? trimmed;
}

function getDesktopEnvironment(): string {
	if (Bun.env.KDE_FULL_SESSION === "true") return "KDE";
	const raw = firstNonEmpty(
		Bun.env.XDG_CURRENT_DESKTOP,
		Bun.env.DESKTOP_SESSION,
		Bun.env.XDG_SESSION_DESKTOP,
		Bun.env.GDMSESSION,
	);
	return raw ? normalizeDesktopValue(raw) : "unknown";
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

function getWindowManager(): string {
	const explicit = firstNonEmpty(Bun.env.WINDOWMANAGER);
	if (explicit) return explicit;

	const desktop = firstNonEmpty(Bun.env.XDG_CURRENT_DESKTOP, Bun.env.DESKTOP_SESSION);
	if (desktop) {
		const matched = matchKnownWindowManager(desktop);
		if (matched) return matched;
	}

	return "unknown";
}

/** Cached system info structure */
interface SystemInfoCache {
	os: string;
	distro: string;
	kernel: string;
	arch: string;
	cpu: string;
	gpu: string;
	disk: string;
}

function getSystemInfoCachePath(): string {
	return path.join(os.homedir(), ".omp", "system_info.json");
}

async function loadSystemInfoCache(): Promise<SystemInfoCache | null> {
	try {
		const cachePath = getSystemInfoCachePath();
		const file = Bun.file(cachePath);
		if (!(await file.exists())) return null;
		const content = await file.json();
		return content as SystemInfoCache;
	} catch {
		return null;
	}
}

async function saveSystemInfoCache(info: SystemInfoCache): Promise<void> {
	try {
		const cachePath = getSystemInfoCachePath();
		await Bun.write(cachePath, JSON.stringify(info, null, "\t"));
	} catch {
		// Silently ignore cache write failures
	}
}

async function collectSystemInfo(): Promise<SystemInfoCache> {
	let nativeInfo: SystemInfo | null = null;
	try {
		nativeInfo = getNativeSystemInfo();
	} catch {
		nativeInfo = null;
	}

	const gpu = await getGpuModel();
	const cpus = os.cpus();

	return {
		os: `${os.platform()} ${os.release()}`,
		arch: os.arch(),
		distro: nativeInfo?.distro ?? os.type(),
		kernel: nativeInfo?.kernel ?? os.version(),
		cpu: `${cpus.length}x ${nativeInfo?.cpu ?? cpus[0]?.model}`,
		gpu: gpu ?? "unknown",
		disk: nativeInfo?.disk ?? "unknown",
	};
}

async function getEnvironmentInfo(): Promise<Array<{ label: string; value: string }>> {
	// Load cached system info or collect fresh
	let sysInfo = await loadSystemInfoCache();
	if (!sysInfo) {
		sysInfo = await collectSystemInfo();
		await saveSystemInfoCache(sysInfo);
	}

	return [
		{ label: "OS", value: sysInfo.os },
		{ label: "Distro", value: sysInfo.distro },
		{ label: "Kernel", value: sysInfo.kernel },
		{ label: "Arch", value: sysInfo.arch },
		{ label: "CPU", value: sysInfo.cpu },
		{ label: "GPU", value: sysInfo.gpu },
		{ label: "Disk", value: sysInfo.disk },
		{ label: "Terminal", value: getTerminalName() },
		{ label: "DE", value: getDesktopEnvironment() },
		{ label: "WM", value: getWindowManager() },
	];
}

/** Resolve input as file path or literal string */
export async function resolvePromptInput(input: string | undefined, description: string): Promise<string | undefined> {
	if (!input) {
		return undefined;
	}

	const file = Bun.file(input);
	if (await file.exists()) {
		try {
			return await file.text();
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

export interface LoadContextFilesOptions {
	/** Working directory to start walking up from. Default: process.cwd() */
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
	const resolvedCwd = options.cwd ?? process.cwd();

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
	const resolvedCwd = options.cwd ?? process.cwd();

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
	/** Skills settings for discovery. */
	skillsSettings?: SkillsSettings;
	/** Working directory. Default: process.cwd() */
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
		skillsSettings,
		toolNames,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		preloadedSkills: providedPreloadedSkills,
		rules,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedCustomPrompt = await resolvePromptInput(customPrompt, "system prompt");
	const resolvedAppendPrompt = await resolvePromptInput(appendSystemPrompt, "append system prompt");

	// Load SYSTEM.md customization (prepended to prompt)
	const systemPromptCustomization = await loadSystemPromptFiles({ cwd: resolvedCwd });

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

	// Resolve context files: use provided or discover
	const contextFiles = providedContextFiles ?? (await loadProjectContextFiles({ cwd: resolvedCwd }));
	const agentsMdSearch = buildAgentsMdSearch(resolvedCwd);

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

	// Resolve skills: use provided or discover
	const skills =
		providedSkills ??
		(skillsSettings?.enabled !== false ? (await loadSkills({ ...skillsSettings, cwd: resolvedCwd })).skills : []);
	const preloadedSkills = providedPreloadedSkills;
	const preloadedSkillContents = preloadedSkills ? await loadPreloadedSkillContents(preloadedSkills) : [];

	// Get git context
	const git = await loadGitContext(resolvedCwd);

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

	return renderPromptTemplate(systemPromptTemplate, {
		tools: toolNamesArray,
		environment: await getEnvironmentInfo(),
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
