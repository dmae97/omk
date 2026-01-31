/**
 * System prompt construction and project context loading
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { find as wasmFind } from "@oh-my-pi/pi-natives";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import chalk from "chalk";
import { contextFileCapability } from "./capability/context-file";
import { systemPromptCapability } from "./capability/system-prompt";
import { renderPromptTemplate } from "./config/prompt-templates";
import { SettingsManager, type SkillsSettings } from "./config/settings-manager";
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

function firstNonEmpty(values: Array<string | undefined | null>): string | null {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

function firstNonEmptyLine(value: string | null): string | null {
	if (!value) return null;
	const line = value
		.split("\n")
		.map(entry => entry.trim())
		.filter(Boolean)[0];
	return line ?? null;
}

function parseWmicTable(output: string, header: string): string | null {
	const lines = output
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const filtered = lines.filter(line => line.toLowerCase() !== header.toLowerCase());
	return filtered[0] ?? null;
}

function parseKeyValueOutput(output: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [key, ...rest] = trimmed.split("=");
		if (!key || rest.length === 0) continue;
		const value = rest.join("=").trim();
		if (value) result[key.trim()] = value;
	}
	return result;
}

function stripQuotes(value: string): string {
	return value.replace(/^"|"$/g, "");
}

const AGENTS_MD_PATTERN = "**/AGENTS.md";
const AGENTS_MD_LIMIT = 200;
const PROJECT_TREE_LIMIT = 2000;
const PROJECT_TREE_PER_DIR_LIMIT = 10;
const PROJECT_TREE_PER_DIR_DEPTH = 2;
const PROJECT_TREE_IGNORED = new Set([
	".git",
	".hg",
	".svn",
	".next",
	".turbo",
	".cache",
	".venv",
	".idea",
	".vscode",
	"build",
	"dist",
	"node_modules",
	"target",
]);

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

type ProjectTreeEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
};

type ProjectTreeScan = {
	children: Map<string, ProjectTreeEntry[]>;
	truncated: boolean;
	truncatedDirs: Set<string>;
};

const GLOB_TIMEOUT_MS = 5000;

/**
 * Scan project tree using ripgrep-wasm find with exclusion filters.
 * Returns null if scan fails.
 */
async function scanProjectTreeWithGlob(root: string): Promise<ProjectTreeScan | null> {
	let entries: string[];
	const timeoutSignal = AbortSignal.timeout(GLOB_TIMEOUT_MS);
	try {
		const result = await untilAborted(timeoutSignal, () =>
			wasmFind({
				pattern: "**/*",
				path: root,
				fileType: "file",
			}),
		);
		entries = result.matches.map(match => match.path).filter(entry => entry.length > 0);
	} catch {
		return null;
	}

	// Build directory contents map from file list
	// Map<dirPath, Map<entryPath, isDirectory>>
	const dirContents = new Map<string, Map<string, boolean>>();
	dirContents.set(root, new Map());

	for (const entry of entries) {
		const filePath = entry;
		if (!filePath) continue;
		const absolutePath = path.join(root, filePath);
		// Check static ignores on path components
		const relative = path.relative(root, absolutePath);
		const parts = relative.split(path.sep);
		if (parts.some(p => PROJECT_TREE_IGNORED.has(p))) continue;

		// Add file to its parent directory
		const parent = path.dirname(absolutePath);
		if (!dirContents.has(parent)) dirContents.set(parent, new Map());
		dirContents.get(parent)!.set(absolutePath, false);

		// Add all intermediate directories
		let dir = parent;
		while (dir.length >= root.length && dir !== path.dirname(dir)) {
			const parentDir = path.dirname(dir);
			if (!dirContents.has(parentDir)) dirContents.set(parentDir, new Map());
			dirContents.get(parentDir)!.set(dir, true);
			dir = parentDir;
		}
	}

	// BFS to build the tree with limits
	const children = new Map<string, ProjectTreeEntry[]>();
	let entryCount = 0;
	let truncated = false;
	const truncatedDirs = new Set<string>();

	const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: root, depth: 0 }];
	let cursor = 0;

	while (cursor < queue.length && !truncated) {
		const { dirPath, depth } = queue[cursor];
		cursor += 1;

		const contents = dirContents.get(dirPath);
		if (!contents || contents.size === 0) continue;

		// Get stats for sorting
		const entries = Array.from(contents.entries());
		const withStats = await Promise.all(
			entries.map(async ([entryPath, isDirectory]) => {
				try {
					const stats = await fs.stat(entryPath);
					return { entryPath, isDirectory, mtimeMs: stats.mtimeMs };
				} catch {
					return { entryPath, isDirectory, mtimeMs: 0 };
				}
			}),
		);

		withStats.sort((a, b) => {
			if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
			return path.basename(a.entryPath).localeCompare(path.basename(b.entryPath));
		});

		const perDirLimit = depth >= PROJECT_TREE_PER_DIR_DEPTH ? PROJECT_TREE_PER_DIR_LIMIT : null;
		const limited = perDirLimit === null ? withStats : withStats.slice(0, perDirLimit);
		const hasMoreEntries = perDirLimit !== null && withStats.length > perDirLimit;

		const mapped: ProjectTreeEntry[] = [];
		for (const { entryPath, isDirectory } of limited) {
			if (entryCount >= PROJECT_TREE_LIMIT) {
				truncated = true;
				break;
			}

			mapped.push({
				name: path.basename(entryPath),
				isDirectory,
				path: entryPath,
			});
			entryCount += 1;

			if (isDirectory) {
				queue.push({ dirPath: entryPath, depth: depth + 1 });
			}
		}

		if (!truncated && hasMoreEntries) {
			truncatedDirs.add(dirPath);
		}
		children.set(dirPath, mapped);
	}

	return { children, truncated, truncatedDirs };
}

async function scanProjectTree(root: string): Promise<ProjectTreeScan> {
	const globResult = await scanProjectTreeWithGlob(root);
	if (globResult) return globResult;
	return { children: new Map(), truncated: false, truncatedDirs: new Set() };
}

function renderProjectTree(scan: ProjectTreeScan, root: string): string {
	const lines: string[] = [];

	const collapseDir = (dirPath: string): { path: string; entries: ProjectTreeEntry[] } | null => {
		let currentPath = dirPath;
		while (true) {
			const entries = scan.children.get(currentPath);
			if (!entries || entries.length === 0) return null;
			const files = entries.filter(entry => !entry.isDirectory);
			const dirs = entries.filter(entry => entry.isDirectory);
			if (files.length === 0 && dirs.length === 1 && !scan.truncatedDirs.has(currentPath)) {
				currentPath = dirs[0].path;
				continue;
			}
			return { path: currentPath, entries };
		}
	};

	const renderDir = (dirPath: string, indent: string, isRoot: boolean): void => {
		const collapsed = collapseDir(dirPath);
		if (!collapsed) return;
		const { path: collapsedPath, entries } = collapsed;

		// For non-root directories, print the header and indent contents
		const contentIndent = isRoot ? indent : `${indent}  `;
		if (!isRoot) {
			const relative = path.relative(root, collapsedPath) || ".";
			lines.push(`${indent}@ ${relative}`);
		}

		const files = entries.filter(entry => !entry.isDirectory);
		const dirs = entries.filter(entry => entry.isDirectory);

		for (const entry of files) {
			lines.push(`${contentIndent}- ${entry.name}`);
		}

		if (scan.truncatedDirs.has(collapsedPath)) {
			lines.push(`${contentIndent}- …`);
		}

		for (const entry of dirs) {
			renderDir(entry.path, contentIndent, false);
		}
	};

	renderDir(root, "", true);

	if (scan.truncated) {
		lines.push("…");
	}

	return lines.join("\n");
}

async function buildProjectTreeSnapshot(root: string): Promise<string> {
	const scan = await scanProjectTree(root);
	return renderProjectTree(scan, root);
}

function getOsName(): string {
	switch (process.platform) {
		case "win32":
			return "Windows";
		case "darwin":
			return "macOS";
		case "linux":
			return "Linux";
		case "freebsd":
			return "FreeBSD";
		case "openbsd":
			return "OpenBSD";
		case "netbsd":
			return "NetBSD";
		case "aix":
			return "AIX";
		default:
			return process.platform || "unknown";
	}
}

async function getKernelVersion(): Promise<string> {
	if (process.platform === "win32") {
		return await $`ver`
			.quiet()
			.text()
			.catch(() => "unknown");
	} else {
		return await $`uname -sr`
			.quiet()
			.text()
			.catch(() => "unknown");
	}
}

async function getOsDistro(): Promise<string | null> {
	switch (process.platform) {
		case "win32": {
			const output = await $`wmic os get Caption,Version /value`
				.quiet()
				.text()
				.catch(() => null);
			if (!output) return null;
			const parsed = parseKeyValueOutput(output);
			const caption = parsed.Caption;
			const version = parsed.Version;
			if (caption && version) return `${caption} ${version}`.trim();
			return caption ?? version ?? null;
		}
		case "darwin": {
			const name = firstNonEmptyLine(
				await $`sw_vers -productName`
					.quiet()
					.text()
					.catch(() => null),
			);
			const version = firstNonEmptyLine(
				await $`sw_vers -productVersion`
					.quiet()
					.text()
					.catch(() => null),
			);
			if (name && version) return `${name} ${version}`.trim();
			return name ?? version ?? null;
		}
		case "linux": {
			const lsb = firstNonEmptyLine(
				await $`lsb_release -ds`
					.quiet()
					.text()
					.catch(() => null),
			);
			if (lsb) return stripQuotes(lsb);
			const osRelease = await Bun.file("/etc/os-release")
				.text()
				.catch(() => null);
			if (!osRelease) return null;
			const parsed = parseKeyValueOutput(osRelease);
			const pretty = parsed.PRETTY_NAME ?? parsed.NAME;
			const version = parsed.VERSION ?? parsed.VERSION_ID;
			if (pretty) return stripQuotes(pretty);
			if (parsed.NAME && version) return `${stripQuotes(parsed.NAME)} ${stripQuotes(version)}`.trim();
			return parsed.NAME ? stripQuotes(parsed.NAME) : null;
		}
		default:
			return null;
	}
}

function getCpuArch(): string {
	return process.arch || "unknown";
}

async function getCpuModel(): Promise<string | null> {
	switch (process.platform) {
		case "win32": {
			const output = await $`wmic cpu get Name`
				.quiet()
				.text()
				.catch(() => null);
			return output ? parseWmicTable(output, "Name") : null;
		}
		case "darwin": {
			return firstNonEmptyLine(
				await $`sysctl -n machdep.cpu.brand_string`
					.quiet()
					.text()
					.catch(() => null),
			);
		}
		case "linux": {
			const lscpu = await $`lscpu`
				.quiet()
				.text()
				.catch(() => null);
			if (lscpu) {
				const match = lscpu
					.split("\n")
					.map(line => line.trim())
					.find(line => line.toLowerCase().startsWith("model name:"));
				if (match) return match.split(":").slice(1).join(":").trim();
			}
			const cpuInfo = await Bun.file("/proc/cpuinfo")
				.text()
				.catch(() => null);
			if (!cpuInfo) return null;
			for (const line of cpuInfo.split("\n")) {
				const [key, ...rest] = line.split(":");
				if (!key || rest.length === 0) continue;
				const normalized = key.trim().toLowerCase();
				if (normalized === "model name" || normalized === "hardware" || normalized === "processor") {
					return rest.join(":").trim();
				}
			}
			return null;
		}
		default:
			return null;
	}
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
	const termProgram = process.env.TERM_PROGRAM;
	const termProgramVersion = process.env.TERM_PROGRAM_VERSION;
	if (termProgram) {
		return termProgramVersion ? `${termProgram} ${termProgramVersion}` : termProgram;
	}

	if (process.env.WT_SESSION) return "Windows Terminal";

	const term = firstNonEmpty([process.env.TERM, process.env.COLORTERM, process.env.TERMINAL_EMULATOR]);
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
	if (process.env.KDE_FULL_SESSION === "true") return "KDE";
	const raw = firstNonEmpty([
		process.env.XDG_CURRENT_DESKTOP,
		process.env.DESKTOP_SESSION,
		process.env.XDG_SESSION_DESKTOP,
		process.env.GDMSESSION,
	]);
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
	const explicit = firstNonEmpty([process.env.WINDOWMANAGER]);
	if (explicit) return explicit;

	const desktop = firstNonEmpty([process.env.XDG_CURRENT_DESKTOP, process.env.DESKTOP_SESSION]);
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
	const [distro, cpu, gpu, disk, kernel] = await Promise.all([
		getOsDistro(),
		getCpuModel(),
		getGpuModel(),
		getDiskInfo(),
		getKernelVersion(),
	]);
	return {
		os: getOsName(),
		distro: distro ?? "unknown",
		kernel: kernel ?? "unknown",
		arch: getCpuArch(),
		cpu: cpu ?? "unknown",
		gpu: gpu ?? "unknown",
		disk: disk ?? "unknown",
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
	return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)}TB`;
}

async function getDiskInfo(): Promise<string | null> {
	switch (process.platform) {
		case "win32": {
			const output = await $`wmic logicaldisk get Caption,Size,FreeSpace /format:csv`
				.quiet()
				.text()
				.catch(() => null);
			if (!output) return null;
			const lines = output.split("\n").filter(l => l.trim() && !l.startsWith("Node"));
			const disks: string[] = [];
			for (const line of lines) {
				const parts = line.split(",");
				if (parts.length < 4) continue;
				const caption = parts[1]?.trim();
				const freeSpace = Number.parseInt(parts[2]?.trim() ?? "", 10);
				const size = Number.parseInt(parts[3]?.trim() ?? "", 10);
				if (!caption || Number.isNaN(size) || size === 0) continue;
				const used = size - (Number.isNaN(freeSpace) ? 0 : freeSpace);
				const pct = Math.round((used / size) * 100);
				disks.push(`${caption} ${formatBytes(used)}/${formatBytes(size)} (${pct}%)`);
			}
			return disks.length > 0 ? disks.join(", ") : null;
		}
		case "linux":
		case "darwin": {
			const output = await $`df -h /`
				.quiet()
				.text()
				.catch(() => null);
			if (!output) return null;
			const lines = output.split("\n");
			if (lines.length < 2) return null;
			const parts = lines[1].split(/\s+/);
			if (parts.length < 5) return null;
			const size = parts[1];
			const used = parts[2];
			const pct = parts[4];
			return `/ ${used}/${size} (${pct})`;
		}
		default:
			return null;
	}
}

async function getEnvironmentInfo(): Promise<Array<{ label: string; value: string }>> {
	// Load cached system info or collect fresh
	let sysInfo = await loadSystemInfoCache();
	if (!sysInfo) {
		sysInfo = await collectSystemInfo();
		await saveSystemInfoCache(sysInfo);
	}

	// Get the actual shell used for command execution (not $SHELL)
	const shellConfig = await SettingsManager.getGlobalShellConfig();

	return [
		{ label: "OS", value: sysInfo.os },
		{ label: "Distro", value: sysInfo.distro },
		{ label: "Kernel", value: sysInfo.kernel },
		{ label: "Arch", value: sysInfo.arch },
		{ label: "CPU", value: sysInfo.cpu },
		{ label: "GPU", value: sysInfo.gpu },
		{ label: "Disk", value: sysInfo.disk },
		{ label: "Shell", value: shellConfig.shell },
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
	/** Whether this is the main coordinator agent (not a subagent). Enables parallel delegation emphasis. */
	isCoordinator?: boolean;
}

/** Build the system prompt with tools, guidelines, and context */
export async function buildSystemPrompt(options: BuildSystemPromptOptions = {}): Promise<string> {
	if (process.env.NULL_PROMPT === "true") {
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
		isCoordinator,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedCustomPrompt = await resolvePromptInput(customPrompt, "system prompt");
	const resolvedAppendPrompt = await resolvePromptInput(appendSystemPrompt, "append system prompt");

	// Load SYSTEM.md customization (prepended to prompt)
	const systemPromptCustomization = await loadSystemPromptFiles({ cwd: resolvedCwd });

	const now = new Date();
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
	const projectTree = await buildProjectTreeSnapshot(resolvedCwd);

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
			projectTree,
			agentsMdSearch,
			git,
			skills: filteredSkills,
			preloadedSkills: preloadedSkillContents,
			rules: rules ?? [],
			dateTime,
			cwd: resolvedCwd,
			isCoordinator: isCoordinator ?? false,
		});
	}

	return renderPromptTemplate(systemPromptTemplate, {
		tools: toolNamesArray,
		environment: await getEnvironmentInfo(),
		systemPromptCustomization: systemPromptCustomization ?? "",
		contextFiles,
		projectTree,
		agentsMdSearch,
		git,
		skills: filteredSkills,
		preloadedSkills: preloadedSkillContents,
		rules: rules ?? [],
		dateTime,
		cwd: resolvedCwd,
		appendSystemPrompt: resolvedAppendPrompt ?? "",
		isCoordinator: isCoordinator ?? false,
	});
}
