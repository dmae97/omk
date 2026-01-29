import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger, procmgr } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { type Settings as SettingsItem, settingsCapability } from "../capability/settings";
import { getAgentDbPath, getAgentDir } from "../config";
import { loadCapability } from "../discovery";
import type { SymbolPreset } from "../modes/theme/theme";
import { AgentStorage } from "../session/agent-storage";
import { withFileLock } from "./file-lock";

export interface CompactionSettings {
	enabled?: boolean; // default: true
	reserveTokens?: number; // default: 16384
	keepRecentTokens?: number; // default: 20000
	autoContinue?: boolean; // default: true
	remoteEndpoint?: string;
}

export interface BranchSummarySettings {
	enabled?: boolean; // default: false (prompt user to summarize when leaving branch)
	reserveTokens?: number; // default: 16384 (tokens reserved for prompt + LLM response)
}

export interface RetrySettings {
	enabled?: boolean; // default: true
	maxRetries?: number; // default: 3
	baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)
}

export interface SkillsSettings {
	enabled?: boolean; // default: true
	enableSkillCommands?: boolean; // default: true - register skills as /skill:name commands
	enableCodexUser?: boolean; // default: true
	enableClaudeUser?: boolean; // default: true
	enableClaudeProject?: boolean; // default: true
	enablePiUser?: boolean; // default: true
	enablePiProject?: boolean; // default: true
	customDirectories?: string[]; // default: []
	ignoredSkills?: string[]; // default: [] (glob patterns to exclude; takes precedence over includeSkills)
	includeSkills?: string[]; // default: [] (empty = include all; glob patterns to filter)
}

export interface CommandsSettings {
	enableClaudeUser?: boolean; // default: true (load from ~/.claude/commands/)
	enableClaudeProject?: boolean; // default: true (load from .claude/commands/)
}

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
}

export interface StartupSettings {
	quiet?: boolean; // default: false - suppress welcome screen and startup info
}

export interface ImageSettings {
	autoResize?: boolean; // default: true (resize images to 2000x2000 max for better model compatibility)
	blockImages?: boolean; // default: false - when true, prevents all images from being sent to LLM providers
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export type NotificationMethod = "bell" | "osc99" | "osc9" | "auto" | "off";

export interface NotificationSettings {
	onComplete?: NotificationMethod; // default: "auto"
}

export interface AskSettings {
	/** Timeout in seconds for ask tool selections (0 or null to disable, default: 30) */
	timeout?: number | null;
	/** Notification method when ask tool is waiting for input (default: "auto") */
	notification?: NotificationMethod;
}

export interface ExaSettings {
	enabled?: boolean; // default: true (master toggle for all Exa tools)
	enableSearch?: boolean; // default: true (search, deep, code, crawl)
	enableLinkedin?: boolean; // default: false
	enableCompany?: boolean; // default: false
	enableResearcher?: boolean; // default: false
	enableWebsets?: boolean; // default: false
}

export type WebSearchProviderOption = "auto" | "exa" | "perplexity" | "anthropic";
export type ImageProviderOption = "auto" | "gemini" | "openrouter";

export interface ProviderSettings {
	webSearch?: WebSearchProviderOption; // default: "auto" (exa > perplexity > anthropic)
	image?: ImageProviderOption; // default: "auto" (openrouter > gemini)
}

export interface BashInterceptorRule {
	pattern: string;
	flags?: string;
	tool: string;
	message: string;
}

export interface BashInterceptorSettings {
	enabled?: boolean; // default: false (blocks shell commands that have dedicated tools)
	simpleLs?: boolean; // default: true (intercept bare ls commands)
	patterns?: BashInterceptorRule[]; // default: built-in rules
}

export interface MCPSettings {
	enableProjectConfig?: boolean; // default: true (load .mcp.json from project root)
}

export interface LspSettings {
	formatOnWrite?: boolean; // default: false (format files using LSP after write tool writes code files)
	diagnosticsOnWrite?: boolean; // default: true (return LSP diagnostics after write tool writes code files)
	diagnosticsOnEdit?: boolean; // default: false (return LSP diagnostics after edit tool edits code files)
}

export type PythonToolMode = "ipy-only" | "bash-only" | "both";
export type PythonKernelMode = "session" | "per-call";

export interface PythonSettings {
	toolMode?: PythonToolMode;
	kernelMode?: PythonKernelMode;
	sharedGateway?: boolean;
}

export interface CommitSettings {
	mapReduceEnabled?: boolean;
	mapReduceMinFiles?: number;
	mapReduceMaxFileTokens?: number;
	mapReduceTimeoutMs?: number;
	mapReduceMaxConcurrency?: number;
	changelogMaxDiffChars?: number;
}

export interface EditSettings {
	fuzzyMatch?: boolean; // default: true (accept high-confidence fuzzy matches for whitespace/indentation)
	fuzzyThreshold?: number; // default: 0.95 (similarity threshold for fuzzy matching)
	patchMode?: boolean; // default: true (use codex-style apply-patch format instead of old_text/new_text)
	streamingAbort?: boolean; // default: false (abort streaming edit tool calls when patch preview fails)
	/** Model-specific variant overrides. Keys are model pattern substrings (e.g., "kimi", "deepseek"). */
	modelVariants?: Record<string, "patch" | "replace">;
}

export type { SymbolPreset };

export interface TtsrSettings {
	enabled?: boolean; // default: true
	/** What to do with partial output when TTSR triggers: "keep" shows interrupted attempt, "discard" removes it */
	contextMode?: "keep" | "discard"; // default: "discard"
	/** How TTSR rules repeat: "once" = only trigger once per session, "after-gap" = can repeat after N messages */
	repeatMode?: "once" | "after-gap"; // default: "once"
	/** Number of messages before a rule can trigger again (only used when repeatMode is "after-gap") */
	repeatGap?: number; // default: 10
}

export interface TodoCompletionSettings {
	enabled?: boolean; // default: false - warn agent when it stops with incomplete todos
	maxReminders?: number; // default: 3 - maximum reminders before giving up
}

export type StatusLineSegmentId =
	| "pi"
	| "model"
	| "plan_mode"
	| "path"
	| "git"
	| "subagents"
	| "token_in"
	| "token_out"
	| "token_total"
	| "cost"
	| "context_pct"
	| "context_total"
	| "time_spent"
	| "time"
	| "session"
	| "hostname"
	| "cache_read"
	| "cache_write";

export type StatusLineSeparatorStyle = "powerline" | "powerline-thin" | "slash" | "pipe" | "block" | "none" | "ascii";

export type StatusLinePreset = "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom";

export interface StatusLineSegmentOptions {
	model?: { showThinkingLevel?: boolean };
	path?: { abbreviate?: boolean; maxLength?: number; stripWorkPrefix?: boolean };
	git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean };
	time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

export interface StatusLineSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
	segmentOptions?: StatusLineSegmentOptions;
	showHookStatus?: boolean;
}

export interface Settings {
	lastChangelogVersion?: string;
	/** Model roles map: { default: "provider/modelId", small: "provider/modelId", ... } */
	modelRoles?: Record<string, string>;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	queueMode?: "all" | "one-at-a-time"; // legacy
	interruptMode?: "immediate" | "wait";
	theme?: string;
	symbolPreset?: SymbolPreset; // default: uses theme's preset or "unicode"
	colorBlindMode?: boolean; // default: false (use blue instead of green for diff additions)
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
	startup?: StartupSettings;
	doubleEscapeAction?: "branch" | "tree"; // Action for double-escape with empty editor (default: "tree")
	thinkingBudgets?: ThinkingBudgetsSettings; // Custom token budgets for thinking levels
	/** Environment variables to set automatically on startup */
	env?: Record<string, string>;
	extensions?: string[]; // Array of extension file paths
	skills?: SkillsSettings;
	commands?: CommandsSettings;
	terminal?: TerminalSettings;
	images?: ImageSettings;
	notifications?: NotificationSettings;
	enabledModels?: string[]; // Model patterns for cycling (same format as --models CLI flag)
	exa?: ExaSettings;
	bashInterceptor?: BashInterceptorSettings;
	mcp?: MCPSettings;
	lsp?: LspSettings;
	python?: PythonSettings;
	commit?: CommitSettings;
	edit?: EditSettings;
	ttsr?: TtsrSettings;
	todoCompletion?: TodoCompletionSettings;
	providers?: ProviderSettings;
	disabledProviders?: string[]; // Discovery provider IDs that are disabled
	disabledExtensions?: string[]; // Individual extension IDs that are disabled (e.g., "skill:commit")
	statusLine?: StatusLineSettings; // Status line configuration
	showHardwareCursor?: boolean; // Show terminal cursor while still positioning it for IME
	normativeRewrite?: boolean; // default: false (rewrite tool call arguments to normalized format in session history)
	readLineNumbers?: boolean; // default: false (prepend line numbers to read tool output by default)
	ask?: AskSettings;
}

export const DEFAULT_BASH_INTERCEPTOR_RULES: BashInterceptorRule[] = [
	{
		pattern: "^\\s*(cat|head|tail|less|more)\\s+",
		tool: "read",
		message: "Use the `read` tool instead of cat/head/tail. It provides better context and handles binary files.",
	},
	{
		pattern: "^\\s*(grep|rg|ripgrep|ag|ack)\\s+",
		tool: "grep",
		message: "Use the `grep` tool instead of grep/rg. It respects .gitignore and provides structured output.",
	},
	{
		pattern: "^\\s*(find|fd|locate)\\s+.*(-name|-iname|-type|--type|-glob)",
		tool: "find",
		message: "Use the `find` tool instead of find/fd. It respects .gitignore and is faster for glob patterns.",
	},
	{
		pattern: "^\\s*sed\\s+(-i|--in-place)",
		tool: "edit",
		message: "Use the `edit` tool instead of sed -i. It provides diff preview and fuzzy matching.",
	},
	{
		pattern: "^\\s*perl\\s+.*-[pn]?i",
		tool: "edit",
		message: "Use the `edit` tool instead of perl -i. It provides diff preview and fuzzy matching.",
	},
	{
		pattern: "^\\s*awk\\s+.*-i\\s+inplace",
		tool: "edit",
		message: "Use the `edit` tool instead of awk -i inplace. It provides diff preview and fuzzy matching.",
	},
	{
		pattern: "^\\s*(echo|printf|cat\\s*<<)\\s+.*[^|]>\\s*\\S",
		tool: "write",
		message: "Use the `write` tool instead of echo/cat redirection. It handles encoding and provides confirmation.",
	},
];

const DEFAULT_BASH_INTERCEPTOR_SETTINGS: Required<BashInterceptorSettings> = {
	enabled: false,
	simpleLs: true,
	patterns: DEFAULT_BASH_INTERCEPTOR_RULES,
};

const DEFAULT_SETTINGS: Settings = {
	compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
	branchSummary: { enabled: false, reserveTokens: 16384 },
	retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
	skills: {
		enabled: true,
		enableCodexUser: true,
		enableClaudeUser: true,
		enableClaudeProject: true,
		enablePiUser: true,
		enablePiProject: true,
		customDirectories: [],
		ignoredSkills: [],
		includeSkills: [],
	},
	commands: { enableClaudeUser: true, enableClaudeProject: true },
	terminal: { showImages: true },
	images: { autoResize: true },
	notifications: { onComplete: "auto" },
	ask: { timeout: 30, notification: "auto" },
	exa: {
		enabled: true,
		enableSearch: true,
		enableLinkedin: false,
		enableCompany: false,
		enableResearcher: false,
		enableWebsets: false,
	},
	bashInterceptor: DEFAULT_BASH_INTERCEPTOR_SETTINGS,
	mcp: { enableProjectConfig: true },
	lsp: { formatOnWrite: false, diagnosticsOnWrite: true, diagnosticsOnEdit: false },
	python: { toolMode: "both", kernelMode: "session", sharedGateway: true },
	edit: { fuzzyMatch: true, fuzzyThreshold: 0.95, streamingAbort: false },
	ttsr: { enabled: true, contextMode: "discard", repeatMode: "once", repeatGap: 10 },
	providers: { webSearch: "auto", image: "auto" },
} satisfies Settings;

function normalizeBashInterceptorRule(rule: unknown): BashInterceptorRule | null {
	if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;

	const candidate = rule as Record<string, unknown>;
	const pattern = typeof candidate.pattern === "string" ? candidate.pattern : "";
	const tool = typeof candidate.tool === "string" ? candidate.tool : "";
	const message = typeof candidate.message === "string" ? candidate.message : "";
	const flags = typeof candidate.flags === "string" && candidate.flags.length > 0 ? candidate.flags : undefined;

	if (!pattern || !tool || !message) return null;
	return { pattern, flags, tool, message };
}

function normalizeBashInterceptorSettings(
	settings: BashInterceptorSettings | undefined,
): Required<BashInterceptorSettings> {
	const enabled = settings?.enabled ?? DEFAULT_BASH_INTERCEPTOR_SETTINGS.enabled;
	const simpleLs = settings?.simpleLs ?? DEFAULT_BASH_INTERCEPTOR_SETTINGS.simpleLs;
	const rawPatterns = settings?.patterns;
	let patterns: BashInterceptorRule[];
	if (rawPatterns === undefined) {
		patterns = DEFAULT_BASH_INTERCEPTOR_RULES;
	} else if (Array.isArray(rawPatterns)) {
		patterns = rawPatterns
			.map(rule => normalizeBashInterceptorRule(rule))
			.filter((rule): rule is BashInterceptorRule => rule !== null);
	} else {
		patterns = DEFAULT_BASH_INTERCEPTOR_RULES;
	}

	return { enabled, simpleLs, patterns };
}

let cachedNerdFonts: boolean | null = null;

function hasNerdFonts(): boolean {
	if (cachedNerdFonts !== null) {
		return cachedNerdFonts;
	}

	const envOverride = process.env.NERD_FONTS;
	if (envOverride === "1") {
		cachedNerdFonts = true;
		return true;
	}
	if (envOverride === "0") {
		cachedNerdFonts = false;
		return false;
	}

	const termProgram = (process.env.TERM_PROGRAM || "").toLowerCase();
	const term = (process.env.TERM || "").toLowerCase();
	const nerdTerms = ["iterm", "wezterm", "kitty", "ghostty", "alacritty"];
	cachedNerdFonts = nerdTerms.some(candidate => termProgram.includes(candidate) || term.includes(candidate));
	return cachedNerdFonts;
}

function normalizeSettings(settings: Settings): Settings {
	const merged = deepMergeSettings(DEFAULT_SETTINGS, settings);
	const symbolPreset = merged.symbolPreset ?? (hasNerdFonts() ? "nerd" : "unicode");
	return {
		...merged,
		symbolPreset,
		bashInterceptor: normalizeBashInterceptorSettings(merged.bashInterceptor),
		python: normalizePythonSettings(merged.python),
	};
}

function normalizePythonSettings(settings: PythonSettings | undefined): PythonSettings {
	const toolMode = settings?.toolMode;
	const kernelMode = settings?.kernelMode;
	const sharedGateway = settings?.sharedGateway;
	return {
		toolMode:
			toolMode === "ipy-only" || toolMode === "bash-only" || toolMode === "both"
				? toolMode
				: (DEFAULT_SETTINGS.python?.toolMode ?? "both"),
		kernelMode:
			kernelMode === "session" || kernelMode === "per-call"
				? kernelMode
				: (DEFAULT_SETTINGS.python?.kernelMode ?? "session"),
		sharedGateway:
			typeof sharedGateway === "boolean" ? sharedGateway : (DEFAULT_SETTINGS.python?.sharedGateway ?? true),
	};
}

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Settings = { ...base };

	for (const key of Object.keys(overrides) as (keyof Settings)[]) {
		const overrideValue = overrides[key];
		const baseValue = base[key];

		if (overrideValue === undefined) {
			continue;
		}

		// For nested objects, merge recursively
		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			// For primitives and arrays, override value wins
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}

	return result;
}

export class SettingsManager {
	/** SQLite storage for auth/cache (null for in-memory mode) */
	private storage: AgentStorage | null;
	/** Path to config.yml (null for in-memory mode) */
	private configPath: string | null;
	private cwd: string | null;
	private globalSettings: Settings;
	private overrides: Settings;
	private settings!: Settings;
	private persist: boolean;
	private modifiedFields = new Set<keyof Settings>();
	private modifiedNestedFields = new Map<keyof Settings, Set<string>>();

	static #lastInstance: SettingsManager | null = null;

	/**
	 * Private constructor - use static factory methods instead.
	 * @param storage - SQLite storage instance for auth/cache, or null for in-memory mode
	 * @param configPath - Path to config.yml for persistence, or null for in-memory mode
	 * @param cwd - Current working directory for project settings discovery
	 * @param initialSettings - Initial global settings to use
	 * @param persist - Whether to persist settings changes to storage
	 * @param projectSettings - Pre-loaded project settings (to avoid async in constructor)
	 */
	private constructor(
		storage: AgentStorage | null,
		configPath: string | null,
		cwd: string | null,
		initialSettings: Settings,
		persist: boolean,
		projectSettings: Settings,
		private agentDir: string | null,
	) {
		this.storage = storage;
		this.configPath = configPath;
		this.cwd = cwd;
		this.persist = persist;
		this.globalSettings = initialSettings;
		this.overrides = {};
		this.rebuildSettings(projectSettings);

		// Apply environment variables from settings
		this.applyEnvironmentVariables();
	}

	/**
	 * Apply environment variables from settings to process.env
	 * Only sets variables that are not already set in the environment
	 */
	applyEnvironmentVariables(): void {
		const envVars = this.settings.env;
		if (!envVars || typeof envVars !== "object") {
			return;
		}

		for (const [key, value] of Object.entries(envVars)) {
			if (typeof key === "string" && typeof value === "string") {
				// Only set if not already present in environment (allow override with env vars)
				if (!(key in process.env)) {
					process.env[key] = value;
				}
			}
		}
	}

	/**
	 * Create a SettingsManager that loads from persistent config.yml.
	 * @param cwd - Current working directory for project settings discovery
	 * @param agentDir - Agent directory containing config.yml
	 * @returns Configured SettingsManager with merged global and user settings
	 */
	static async create(cwd: string = process.cwd(), agentDir: string = getAgentDir()): Promise<SettingsManager> {
		cwd = path.normalize(cwd);
		agentDir = path.normalize(agentDir);

		const configPath = path.join(agentDir, "config.yml");
		const storage = await AgentStorage.open(getAgentDbPath(agentDir));

		// Migrate from legacy storage if config.yml doesn't exist
		await SettingsManager.migrateToYaml(storage, agentDir, configPath);

		// Use capability API to load user-level settings from all providers
		const result = await loadCapability(settingsCapability.id, { cwd });

		// Merge all user-level settings
		let globalSettings: Settings = {};
		for (const item of result.items as SettingsItem[]) {
			if (item.level === "user") {
				globalSettings = deepMergeSettings(globalSettings, item.data as Settings);
			}
		}

		// Load persisted settings from config.yml
		const storedSettings = await SettingsManager.loadFromYaml(configPath);
		globalSettings = deepMergeSettings(globalSettings, storedSettings);

		// Load project settings before construction (constructor is sync)
		const projectSettings = await SettingsManager.loadProjectSettingsStatic(cwd);

		const instance = new SettingsManager(storage, configPath, cwd, globalSettings, true, projectSettings, agentDir);
		SettingsManager.#lastInstance = instance;
		return instance;
	}

	/**
	 * Create an in-memory SettingsManager without persistence.
	 * @param settings - Initial settings to use
	 * @returns SettingsManager that won't persist changes to disk
	 */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		return new SettingsManager(null, null, null, settings, false, {}, null);
	}

	/**
	 * Serialize settings for passing to subagent workers.
	 * Returns the merged settings (global + project + overrides).
	 */
	serialize(): Settings {
		return { ...this.settings };
	}

	getPlansDirectory(_cwd: string = this.cwd ?? process.cwd()): string {
		return path.join(getAgentDir(), "plans");
	}

	/**
	 * Access the underlying agent storage (null for in-memory settings).
	 */
	getStorage(): AgentStorage | null {
		return this.storage;
	}

	/**
	 * Load settings from config.yml, applying any schema migrations.
	 * @param configPath - Path to config.yml, or null for in-memory mode
	 * @returns Parsed and migrated settings, or empty object if file doesn't exist
	 */
	private static async loadFromYaml(configPath: string | null): Promise<Settings> {
		if (!configPath) {
			return {};
		}
		try {
			const content = await Bun.file(configPath).text();
			const parsed = YAML.parse(content);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return {};
			}
			return SettingsManager.migrateSettings(parsed as Record<string, unknown>);
		} catch (error) {
			if (isEnoent(error)) return {};
			logger.warn("SettingsManager failed to load config.yml", { path: configPath, error: String(error) });
			return {};
		}
	}

	/**
	 * Migrate settings from legacy sources to config.yml.
	 * Migration order: settings.json -> agent.db -> config.yml
	 * Only migrates if config.yml doesn't exist.
	 */
	private static async migrateToYaml(storage: AgentStorage, agentDir: string, configPath: string): Promise<void> {
		try {
			await Bun.file(configPath).text();
			return;
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("SettingsManager failed to check config.yml", { path: configPath, error: String(err) });
				return;
			}
		}

		let settings: Settings = {};
		let migrated = false;

		// 1. Try to migrate from settings.json (oldest legacy format)
		const settingsJsonPath = path.join(agentDir, "settings.json");
		try {
			const parsed = JSON.parse(await Bun.file(settingsJsonPath).text());
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				settings = deepMergeSettings(settings, SettingsManager.migrateSettings(parsed));
				migrated = true;
				// Backup settings.json
				try {
					await fs.rename(settingsJsonPath, `${settingsJsonPath}.bak`);
				} catch (error) {
					logger.warn("SettingsManager failed to backup settings.json", { error: String(error) });
				}
			}
		} catch (error) {
			if (!isEnoent(error)) {
				logger.warn("SettingsManager failed to read settings.json", { error: String(error) });
			}
		}

		// 2. Migrate from agent.db settings table
		try {
			const dbSettings = storage.getSettings();
			if (dbSettings) {
				settings = deepMergeSettings(
					settings,
					SettingsManager.migrateSettings(dbSettings as Record<string, unknown>),
				);
				migrated = true;
			}
		} catch (error) {
			logger.warn("SettingsManager failed to read agent.db settings", { error: String(error) });
		}

		// 3. Write merged settings to config.yml if we found any
		if (migrated && Object.keys(settings).length > 0) {
			try {
				await Bun.write(configPath, YAML.stringify(settings, null, 2));
				logger.debug("SettingsManager migrated settings to config.yml", { path: configPath });
			} catch (error) {
				logger.warn("SettingsManager failed to write config.yml", { path: configPath, error: String(error) });
			}
		}
	}

	/** Migrate old settings format to new format */
	private static migrateSettings(settings: Record<string, unknown>): Settings {
		// Migrate queueMode -> steeringMode
		if ("queueMode" in settings && !("steeringMode" in settings)) {
			settings.steeringMode = settings.queueMode;
			delete settings.queueMode;
		}
		return settings as Settings;
	}

	/**
	 * Static helper to load project settings (used by create() before construction).
	 */
	private static async loadProjectSettingsStatic(cwd: string | null): Promise<Settings> {
		if (!cwd) return {};

		// Use capability API to discover settings from all providers
		const result = await loadCapability(settingsCapability.id, { cwd });

		// Merge only project-level settings (user-level settings are handled separately via globalSettings)
		let merged: Settings = {};
		for (const item of result.items as SettingsItem[]) {
			if (item.level === "project") {
				merged = deepMergeSettings(merged, item.data as Settings);
			}
		}

		return SettingsManager.migrateSettings(merged as Record<string, unknown>);
	}

	private async loadProjectSettings(): Promise<Settings> {
		return SettingsManager.loadProjectSettingsStatic(this.cwd);
	}

	private rebuildSettings(projectSettings: Settings): void {
		this.settings = normalizeSettings(
			deepMergeSettings(deepMergeSettings(this.globalSettings, projectSettings), this.overrides),
		);
	}

	/** Apply additional overrides on top of current settings */
	async applyOverrides(overrides: Partial<Settings>): Promise<void> {
		this.overrides = deepMergeSettings(this.overrides, overrides);
		const projectSettings = await this.loadProjectSettings();
		this.rebuildSettings(projectSettings);
	}

	/** Mark a field as modified during this session */
	private markModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedFields.add(field);
		if (nestedKey) {
			if (!this.modifiedNestedFields.has(field)) {
				this.modifiedNestedFields.set(field, new Set());
			}
			this.modifiedNestedFields.get(field)!.add(nestedKey);
		}
	}

	/**
	 * Persist current global settings to config.yml and rebuild merged settings.
	 * Uses file locking to prevent concurrent write races.
	 */
	private async save(): Promise<void> {
		if (this.persist && this.configPath) {
			const configPath = this.configPath;
			try {
				await withFileLock(configPath, async () => {
					// Re-read current file to get latest external changes
					const currentFileSettings = await SettingsManager.loadFromYaml(configPath);

					// Start with file settings as base - preserves external edits
					const mergedSettings: Settings = { ...currentFileSettings };

					// Only override with in-memory values for fields that were explicitly modified during this session
					for (const field of this.modifiedFields) {
						const value = this.globalSettings[field];

						// Handle nested objects specially - merge at nested level to preserve unmodified nested keys
						if (this.modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
							const nestedModified = this.modifiedNestedFields.get(field)!;
							const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
							const inMemoryNested = value as Record<string, unknown>;
							const mergedNested = { ...baseNested };
							for (const nestedKey of nestedModified) {
								mergedNested[nestedKey] = inMemoryNested[nestedKey];
							}
							(mergedSettings as Record<string, unknown>)[field] = mergedNested;
						} else {
							// For top-level primitives and arrays, use the modified value directly
							(mergedSettings as Record<string, unknown>)[field] = value;
						}
					}

					this.globalSettings = mergedSettings;
					await Bun.write(configPath, YAML.stringify(this.globalSettings, null, 2));
				});
			} catch (error) {
				logger.warn("SettingsManager save failed", { error: String(error) });
			}
		}

		const projectSettings = await this.loadProjectSettings();
		this.rebuildSettings(projectSettings);
	}

	getLastChangelogVersion(): string | undefined {
		return this.settings.lastChangelogVersion;
	}

	async setLastChangelogVersion(version: string): Promise<void> {
		this.globalSettings.lastChangelogVersion = version;
		this.markModified("lastChangelogVersion");
		await this.save();
	}

	/**
	 * Get model for a role. Returns "provider/modelId" string or undefined.
	 */
	getModelRole(role: string): string | undefined {
		return this.settings.modelRoles?.[role];
	}

	/**
	 * Set model for a role. Model should be "provider/modelId" format.
	 */
	async setModelRole(role: string, model: string): Promise<void> {
		if (!this.globalSettings.modelRoles) {
			this.globalSettings.modelRoles = {};
		}
		this.globalSettings.modelRoles[role] = model;
		this.markModified("modelRoles", role);

		if (this.overrides.modelRoles && this.overrides.modelRoles[role] !== undefined) {
			this.overrides.modelRoles[role] = model;
		}

		await this.save();
	}

	/**
	 * Get all model roles.
	 */
	getModelRoles(): Record<string, string> {
		return { ...this.settings.modelRoles };
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.settings.steeringMode || "one-at-a-time";
	}

	async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
		this.globalSettings.steeringMode = mode;
		this.markModified("steeringMode");
		await this.save();
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.settings.followUpMode || "one-at-a-time";
	}

	async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
		this.globalSettings.followUpMode = mode;
		this.markModified("followUpMode");
		await this.save();
	}

	getInterruptMode(): "immediate" | "wait" {
		return this.settings.interruptMode || "immediate";
	}

	async setInterruptMode(mode: "immediate" | "wait"): Promise<void> {
		this.globalSettings.interruptMode = mode;
		this.markModified("interruptMode");
		await this.save();
	}

	getTheme(): string | undefined {
		return this.settings.theme;
	}

	async setTheme(theme: string): Promise<void> {
		this.globalSettings.theme = theme;
		this.markModified("theme");
		await this.save();
	}

	getSymbolPreset(): SymbolPreset | undefined {
		return this.settings.symbolPreset;
	}

	async setSymbolPreset(preset: SymbolPreset): Promise<void> {
		this.globalSettings.symbolPreset = preset;
		this.markModified("symbolPreset");
		await this.save();
	}

	getColorBlindMode(): boolean {
		return this.settings.colorBlindMode ?? false;
	}

	async setColorBlindMode(enabled: boolean): Promise<void> {
		this.globalSettings.colorBlindMode = enabled;
		this.markModified("colorBlindMode");
		await this.save();
	}

	getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
		return this.settings.defaultThinkingLevel;
	}

	async setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): Promise<void> {
		this.globalSettings.defaultThinkingLevel = level;
		this.markModified("defaultThinkingLevel");
		await this.save();
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? true;
	}

	async setCompactionEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.compaction) {
			this.globalSettings.compaction = {};
		}
		this.globalSettings.compaction.enabled = enabled;
		this.markModified("compaction", "enabled");
		await this.save();
	}

	getCompactionReserveTokens(): number {
		return this.settings.compaction?.reserveTokens ?? 16384;
	}

	getCompactionKeepRecentTokens(): number {
		return this.settings.compaction?.keepRecentTokens ?? 20000;
	}

	getCompactionAutoContinue(): boolean {
		return this.settings.compaction?.autoContinue ?? true;
	}

	getCompactionRemoteEndpoint(): string | undefined {
		return this.settings.compaction?.remoteEndpoint;
	}

	getCompactionSettings(): {
		enabled: boolean;
		reserveTokens: number;
		keepRecentTokens: number;
		autoContinue: boolean;
		remoteEndpoint?: string;
	} {
		return {
			enabled: this.getCompactionEnabled(),
			reserveTokens: this.getCompactionReserveTokens(),
			keepRecentTokens: this.getCompactionKeepRecentTokens(),
			autoContinue: this.getCompactionAutoContinue(),
			remoteEndpoint: this.getCompactionRemoteEndpoint(),
		};
	}

	getBranchSummaryEnabled(): boolean {
		return this.settings.branchSummary?.enabled ?? false;
	}

	async setBranchSummaryEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.branchSummary) {
			this.globalSettings.branchSummary = {};
		}
		this.globalSettings.branchSummary.enabled = enabled;
		this.markModified("branchSummary", "enabled");
		await this.save();
	}

	getBranchSummarySettings(): { enabled: boolean; reserveTokens: number } {
		return {
			enabled: this.getBranchSummaryEnabled(),
			reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
		};
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? true;
	}

	async setRetryEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.enabled = enabled;
		this.markModified("retry", "enabled");
		await this.save();
	}

	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
		return {
			enabled: this.getRetryEnabled(),
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
		};
	}

	getCommitSettings(): Required<CommitSettings> {
		return {
			mapReduceEnabled: this.settings.commit?.mapReduceEnabled ?? true,
			mapReduceMinFiles: this.settings.commit?.mapReduceMinFiles ?? 4,
			mapReduceMaxFileTokens: this.settings.commit?.mapReduceMaxFileTokens ?? 50_000,
			mapReduceTimeoutMs: this.settings.commit?.mapReduceTimeoutMs ?? 120_000,
			mapReduceMaxConcurrency: this.settings.commit?.mapReduceMaxConcurrency ?? 5,
			changelogMaxDiffChars: this.settings.commit?.changelogMaxDiffChars ?? 120_000,
		};
	}

	getRetryMaxRetries(): number {
		return this.settings.retry?.maxRetries ?? 3;
	}

	async setRetryMaxRetries(maxRetries: number): Promise<void> {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.maxRetries = maxRetries;
		this.markModified("retry", "maxRetries");
		await this.save();
	}

	getRetryBaseDelayMs(): number {
		return this.settings.retry?.baseDelayMs ?? 2000;
	}

	async setRetryBaseDelayMs(baseDelayMs: number): Promise<void> {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.baseDelayMs = baseDelayMs;
		this.markModified("retry", "baseDelayMs");
		await this.save();
	}

	getTodoCompletionSettings(): { enabled: boolean; maxReminders: number } {
		return {
			enabled: this.settings.todoCompletion?.enabled ?? false,
			maxReminders: this.settings.todoCompletion?.maxReminders ?? 3,
		};
	}

	getTodoCompletionEnabled(): boolean {
		return this.settings.todoCompletion?.enabled ?? false;
	}

	async setTodoCompletionEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.todoCompletion) {
			this.globalSettings.todoCompletion = {};
		}
		this.globalSettings.todoCompletion.enabled = enabled;
		this.markModified("todoCompletion", "enabled");
		await this.save();
	}

	getTodoCompletionMaxReminders(): number {
		return this.settings.todoCompletion?.maxReminders ?? 3;
	}

	async setTodoCompletionMaxReminders(maxReminders: number): Promise<void> {
		if (!this.globalSettings.todoCompletion) {
			this.globalSettings.todoCompletion = {};
		}
		this.globalSettings.todoCompletion.maxReminders = maxReminders;
		this.markModified("todoCompletion", "maxReminders");
		await this.save();
	}

	getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
		return this.settings.thinkingBudgets;
	}

	getHideThinkingBlock(): boolean {
		return this.settings.hideThinkingBlock ?? false;
	}

	async setHideThinkingBlock(hide: boolean): Promise<void> {
		this.globalSettings.hideThinkingBlock = hide;
		this.markModified("hideThinkingBlock");
		await this.save();
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	async setShellPath(path: string | undefined): Promise<void> {
		this.globalSettings.shellPath = path;
		this.markModified("shellPath");
		await this.save();
	}

	getCollapseChangelog(): boolean {
		return this.settings.collapseChangelog ?? false;
	}

	async setCollapseChangelog(collapse: boolean): Promise<void> {
		this.globalSettings.collapseChangelog = collapse;
		this.markModified("collapseChangelog");
		await this.save();
	}

	getStartupQuiet(): boolean {
		return this.settings.startup?.quiet ?? false;
	}

	async setStartupQuiet(quiet: boolean): Promise<void> {
		if (!this.globalSettings.startup) {
			this.globalSettings.startup = {};
		}
		this.globalSettings.startup.quiet = quiet;
		this.markModified("startup", "quiet");
		await this.save();
	}

	getExtensionPaths(): string[] {
		return [...(this.settings.extensions ?? [])];
	}

	async setExtensionPaths(paths: string[]): Promise<void> {
		this.globalSettings.extensions = paths;
		this.markModified("extensions");
		await this.save();
	}

	getSkillsEnabled(): boolean {
		return this.settings.skills?.enabled ?? true;
	}

	async setSkillsEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.skills) {
			this.globalSettings.skills = {};
		}
		this.globalSettings.skills.enabled = enabled;
		this.markModified("skills", "enabled");
		await this.save();
	}

	getSkillsSettings(): Required<SkillsSettings> {
		return {
			enabled: this.settings.skills?.enabled ?? true,
			enableSkillCommands: this.settings.skills?.enableSkillCommands ?? true,
			enableCodexUser: this.settings.skills?.enableCodexUser ?? true,
			enableClaudeUser: this.settings.skills?.enableClaudeUser ?? true,
			enableClaudeProject: this.settings.skills?.enableClaudeProject ?? true,
			enablePiUser: this.settings.skills?.enablePiUser ?? true,
			enablePiProject: this.settings.skills?.enablePiProject ?? true,
			customDirectories: [...(this.settings.skills?.customDirectories ?? [])],
			ignoredSkills: [...(this.settings.skills?.ignoredSkills ?? [])],
			includeSkills: [...(this.settings.skills?.includeSkills ?? [])],
		};
	}

	getEnableSkillCommands(): boolean {
		return this.settings.skills?.enableSkillCommands ?? true;
	}

	async setEnableSkillCommands(enabled: boolean): Promise<void> {
		if (!this.globalSettings.skills) {
			this.globalSettings.skills = {};
		}
		this.globalSettings.skills.enableSkillCommands = enabled;
		this.markModified("skills", "enableSkillCommands");
		await this.save();
	}

	getCommandsSettings(): Required<CommandsSettings> {
		return {
			enableClaudeUser: this.settings.commands?.enableClaudeUser ?? true,
			enableClaudeProject: this.settings.commands?.enableClaudeProject ?? true,
		};
	}

	getCommandsEnableClaudeUser(): boolean {
		return this.settings.commands?.enableClaudeUser ?? true;
	}

	async setCommandsEnableClaudeUser(enabled: boolean): Promise<void> {
		if (!this.globalSettings.commands) {
			this.globalSettings.commands = {};
		}
		this.globalSettings.commands.enableClaudeUser = enabled;
		this.markModified("commands", "enableClaudeUser");
		await this.save();
	}

	getCommandsEnableClaudeProject(): boolean {
		return this.settings.commands?.enableClaudeProject ?? true;
	}

	async setCommandsEnableClaudeProject(enabled: boolean): Promise<void> {
		if (!this.globalSettings.commands) {
			this.globalSettings.commands = {};
		}
		this.globalSettings.commands.enableClaudeProject = enabled;
		this.markModified("commands", "enableClaudeProject");
		await this.save();
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	async setShowImages(show: boolean): Promise<void> {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showImages = show;
		this.markModified("terminal", "showImages");
		await this.save();
	}

	getNotificationOnComplete(): NotificationMethod {
		return this.settings.notifications?.onComplete ?? "auto";
	}

	async setNotificationOnComplete(method: NotificationMethod): Promise<void> {
		if (!this.globalSettings.notifications) {
			this.globalSettings.notifications = {};
		}
		this.globalSettings.notifications.onComplete = method;
		this.markModified("notifications", "onComplete");
		await this.save();
	}

	/** Get ask tool timeout in milliseconds (0 or null = disabled) */
	getAskTimeout(): number | null {
		const timeout = this.settings.ask?.timeout;
		if (timeout === null || timeout === 0) return null;
		return (timeout ?? 30) * 1000;
	}

	async setAskTimeout(seconds: number | null): Promise<void> {
		if (!this.globalSettings.ask) {
			this.globalSettings.ask = {};
		}
		this.globalSettings.ask.timeout = seconds;
		this.markModified("ask", "timeout");
		await this.save();
	}

	getAskNotification(): NotificationMethod {
		return this.settings.ask?.notification ?? "auto";
	}

	async setAskNotification(method: NotificationMethod): Promise<void> {
		if (!this.globalSettings.ask) {
			this.globalSettings.ask = {};
		}
		this.globalSettings.ask.notification = method;
		this.markModified("ask", "notification");
		await this.save();
	}

	getImageAutoResize(): boolean {
		return this.settings.images?.autoResize ?? true;
	}

	async setImageAutoResize(enabled: boolean): Promise<void> {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.autoResize = enabled;
		this.markModified("images", "autoResize");
		await this.save();
	}

	getBlockImages(): boolean {
		return this.settings.images?.blockImages ?? false;
	}

	async setBlockImages(blocked: boolean): Promise<void> {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.blockImages = blocked;
		this.markModified("images", "blockImages");
		await this.save();
	}

	getEnabledModels(): string[] | undefined {
		return this.settings.enabledModels;
	}

	getExaSettings(): Required<ExaSettings> {
		return {
			enabled: this.settings.exa?.enabled ?? true,
			enableSearch: this.settings.exa?.enableSearch ?? true,
			enableLinkedin: this.settings.exa?.enableLinkedin ?? false,
			enableCompany: this.settings.exa?.enableCompany ?? false,
			enableResearcher: this.settings.exa?.enableResearcher ?? false,
			enableWebsets: this.settings.exa?.enableWebsets ?? false,
		};
	}

	async setExaEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enabled = enabled;
		this.markModified("exa", "enabled");
		await this.save();
	}

	async setExaSearchEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enableSearch = enabled;
		this.markModified("exa", "enableSearch");
		await this.save();
	}

	async setExaLinkedinEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enableLinkedin = enabled;
		this.markModified("exa", "enableLinkedin");
		await this.save();
	}

	async setExaCompanyEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enableCompany = enabled;
		this.markModified("exa", "enableCompany");
		await this.save();
	}

	async setExaResearcherEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enableResearcher = enabled;
		this.markModified("exa", "enableResearcher");
		await this.save();
	}

	async setExaWebsetsEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.exa) {
			this.globalSettings.exa = {};
		}
		this.globalSettings.exa.enableWebsets = enabled;
		this.markModified("exa", "enableWebsets");
		await this.save();
	}

	// Provider settings
	getWebSearchProvider(): WebSearchProviderOption {
		return this.settings.providers?.webSearch ?? "auto";
	}

	async setWebSearchProvider(provider: WebSearchProviderOption): Promise<void> {
		if (!this.globalSettings.providers) {
			this.globalSettings.providers = {};
		}
		this.globalSettings.providers.webSearch = provider;
		this.markModified("providers", "webSearch");
		await this.save();
	}

	getImageProvider(): ImageProviderOption {
		return this.settings.providers?.image ?? "auto";
	}

	async setImageProvider(provider: ImageProviderOption): Promise<void> {
		if (!this.globalSettings.providers) {
			this.globalSettings.providers = {};
		}
		this.globalSettings.providers.image = provider;
		this.markModified("providers", "image");
		await this.save();
	}

	getBashInterceptorEnabled(): boolean {
		return this.settings.bashInterceptor?.enabled ?? DEFAULT_BASH_INTERCEPTOR_SETTINGS.enabled;
	}

	getBashInterceptorSimpleLsEnabled(): boolean {
		return this.settings.bashInterceptor?.simpleLs ?? DEFAULT_BASH_INTERCEPTOR_SETTINGS.simpleLs;
	}

	getBashInterceptorRules(): BashInterceptorRule[] {
		return [...(this.settings.bashInterceptor?.patterns ?? DEFAULT_BASH_INTERCEPTOR_RULES)];
	}

	async setBashInterceptorEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.bashInterceptor) {
			this.globalSettings.bashInterceptor = {};
		}
		this.globalSettings.bashInterceptor.enabled = enabled;
		this.markModified("bashInterceptor", "enabled");
		await this.save();
	}

	async setBashInterceptorSimpleLsEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.bashInterceptor) {
			this.globalSettings.bashInterceptor = {};
		}
		this.globalSettings.bashInterceptor.simpleLs = enabled;
		this.markModified("bashInterceptor", "simpleLs");
		await this.save();
	}

	getPythonToolMode(): PythonToolMode {
		return this.settings.python?.toolMode ?? "both";
	}

	async setPythonToolMode(mode: PythonToolMode): Promise<void> {
		if (!this.globalSettings.python) {
			this.globalSettings.python = {};
		}
		this.globalSettings.python.toolMode = mode;
		this.markModified("python", "toolMode");
		await this.save();
	}

	getPythonKernelMode(): PythonKernelMode {
		return this.settings.python?.kernelMode ?? "session";
	}

	async setPythonKernelMode(mode: PythonKernelMode): Promise<void> {
		if (!this.globalSettings.python) {
			this.globalSettings.python = {};
		}
		this.globalSettings.python.kernelMode = mode;
		this.markModified("python", "kernelMode");
		await this.save();
	}

	getPythonSharedGateway(): boolean {
		return this.settings.python?.sharedGateway ?? true;
	}

	async setPythonSharedGateway(enabled: boolean): Promise<void> {
		if (!this.globalSettings.python) {
			this.globalSettings.python = {};
		}
		this.globalSettings.python.sharedGateway = enabled;
		this.markModified("python", "sharedGateway");
		await this.save();
	}

	getMCPProjectConfigEnabled(): boolean {
		return this.settings.mcp?.enableProjectConfig ?? true;
	}

	async setMCPProjectConfigEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.mcp) {
			this.globalSettings.mcp = {};
		}
		this.globalSettings.mcp.enableProjectConfig = enabled;
		this.markModified("mcp", "enableProjectConfig");
		await this.save();
	}

	getLspFormatOnWrite(): boolean {
		return this.settings.lsp?.formatOnWrite ?? false;
	}

	async setLspFormatOnWrite(enabled: boolean): Promise<void> {
		if (!this.globalSettings.lsp) {
			this.globalSettings.lsp = {};
		}
		this.globalSettings.lsp.formatOnWrite = enabled;
		this.markModified("lsp", "formatOnWrite");
		await this.save();
	}

	getLspDiagnosticsOnWrite(): boolean {
		return this.settings.lsp?.diagnosticsOnWrite ?? true;
	}

	async setLspDiagnosticsOnWrite(enabled: boolean): Promise<void> {
		if (!this.globalSettings.lsp) {
			this.globalSettings.lsp = {};
		}
		this.globalSettings.lsp.diagnosticsOnWrite = enabled;
		this.markModified("lsp", "diagnosticsOnWrite");
		await this.save();
	}

	getLspDiagnosticsOnEdit(): boolean {
		return this.settings.lsp?.diagnosticsOnEdit ?? false;
	}

	async setLspDiagnosticsOnEdit(enabled: boolean): Promise<void> {
		if (!this.globalSettings.lsp) {
			this.globalSettings.lsp = {};
		}
		this.globalSettings.lsp.diagnosticsOnEdit = enabled;
		this.markModified("lsp", "diagnosticsOnEdit");
		await this.save();
	}

	getEditFuzzyMatch(): boolean {
		return this.settings.edit?.fuzzyMatch ?? true;
	}

	async setEditFuzzyMatch(enabled: boolean): Promise<void> {
		if (!this.globalSettings.edit) {
			this.globalSettings.edit = {};
		}
		this.globalSettings.edit.fuzzyMatch = enabled;
		this.markModified("edit", "fuzzyMatch");
		await this.save();
	}

	getEditFuzzyThreshold(): number {
		return this.settings.edit?.fuzzyThreshold ?? 0.95;
	}

	async setEditFuzzyThreshold(value: number): Promise<void> {
		if (!this.globalSettings.edit) {
			this.globalSettings.edit = {};
		}
		this.globalSettings.edit.fuzzyThreshold = value;
		this.markModified("edit", "fuzzyThreshold");
		await this.save();
	}

	getEditPatchMode(): boolean {
		return this.settings.edit?.patchMode ?? true;
	}

	async setEditPatchMode(enabled: boolean): Promise<void> {
		if (!this.globalSettings.edit) {
			this.globalSettings.edit = {};
		}
		this.globalSettings.edit.patchMode = enabled;
		this.markModified("edit", "patchMode");
		await this.save();
	}

	getEditStreamingAbort(): boolean {
		return this.settings.edit?.streamingAbort ?? false;
	}

	async setEditStreamingAbort(enabled: boolean): Promise<void> {
		if (!this.globalSettings.edit) {
			this.globalSettings.edit = {};
		}
		this.globalSettings.edit.streamingAbort = enabled;
		this.markModified("edit", "streamingAbort");
		await this.save();
	}

	/**
	 * Default model patterns that should use replace mode instead of patch mode.
	 * These are models known to struggle with unified diff format.
	 */
	static readonly DEFAULT_REPLACE_MODE_PATTERNS = ["kimi"];

	/**
	 * Get the edit variant for a specific model.
	 * Returns "patch", "replace", or null (use global default).
	 */
	getEditVariantForModel(model: string | undefined): "patch" | "replace" | null {
		if (!model) return null;
		const modelLower = model.toLowerCase();

		const userVariants = this.settings.edit?.modelVariants;
		if (userVariants) {
			for (const [pattern, variant] of Object.entries(userVariants)) {
				if (modelLower.includes(pattern.toLowerCase())) {
					return variant;
				}
			}
		}

		for (const pattern of SettingsManager.DEFAULT_REPLACE_MODE_PATTERNS) {
			if (modelLower.includes(pattern)) {
				return "replace";
			}
		}

		return null;
	}

	getEditModelVariants(): Record<string, "patch" | "replace"> {
		return this.settings.edit?.modelVariants ?? {};
	}

	async setEditModelVariant(pattern: string, variant: "patch" | "replace" | null): Promise<void> {
		if (!this.globalSettings.edit) {
			this.globalSettings.edit = {};
		}
		if (!this.globalSettings.edit.modelVariants) {
			this.globalSettings.edit.modelVariants = {};
		}
		if (variant === null) {
			delete this.globalSettings.edit.modelVariants[pattern];
		} else {
			this.globalSettings.edit.modelVariants[pattern] = variant;
		}
		this.markModified("edit", "modelVariants");
		await this.save();
	}

	getNormativeRewrite(): boolean {
		return this.settings.normativeRewrite ?? false;
	}

	async setNormativeRewrite(enabled: boolean): Promise<void> {
		this.globalSettings.normativeRewrite = enabled;
		this.markModified("normativeRewrite");
		await this.save();
	}

	getReadLineNumbers(): boolean {
		return this.settings.readLineNumbers ?? false;
	}

	async setReadLineNumbers(enabled: boolean): Promise<void> {
		this.globalSettings.readLineNumbers = enabled;
		this.markModified("readLineNumbers");
		await this.save();
	}

	getDisabledProviders(): string[] {
		return [...(this.settings.disabledProviders ?? [])];
	}

	async setDisabledProviders(providerIds: string[]): Promise<void> {
		this.globalSettings.disabledProviders = providerIds;
		this.markModified("disabledProviders");
		await this.save();
	}

	getDisabledExtensions(): string[] {
		return [...(this.settings.disabledExtensions ?? [])];
	}

	async setDisabledExtensions(extensionIds: string[]): Promise<void> {
		this.globalSettings.disabledExtensions = extensionIds;
		this.markModified("disabledExtensions");
		await this.save();
	}

	isExtensionEnabled(extensionId: string): boolean {
		return !(this.settings.disabledExtensions ?? []).includes(extensionId);
	}

	async enableExtension(extensionId: string): Promise<void> {
		const disabled = this.globalSettings.disabledExtensions ?? [];
		const index = disabled.indexOf(extensionId);
		if (index !== -1) {
			disabled.splice(index, 1);
			this.globalSettings.disabledExtensions = disabled;
			this.markModified("disabledExtensions");
			await this.save();
		}
	}

	async disableExtension(extensionId: string): Promise<void> {
		const disabled = this.globalSettings.disabledExtensions ?? [];
		if (!disabled.includes(extensionId)) {
			disabled.push(extensionId);
			this.globalSettings.disabledExtensions = disabled;
			this.markModified("disabledExtensions");
			await this.save();
		}
	}

	getTtsrSettings(): TtsrSettings {
		return this.settings.ttsr ?? {};
	}

	async setTtsrSettings(settings: TtsrSettings): Promise<void> {
		this.globalSettings.ttsr = { ...this.globalSettings.ttsr, ...settings };
		this.markModified("ttsr");
		await this.save();
	}

	getTtsrEnabled(): boolean {
		return this.settings.ttsr?.enabled ?? true;
	}

	async setTtsrEnabled(enabled: boolean): Promise<void> {
		if (!this.globalSettings.ttsr) {
			this.globalSettings.ttsr = {};
		}
		this.globalSettings.ttsr.enabled = enabled;
		this.markModified("ttsr", "enabled");
		await this.save();
	}

	getTtsrContextMode(): "keep" | "discard" {
		return this.settings.ttsr?.contextMode ?? "discard";
	}

	async setTtsrContextMode(mode: "keep" | "discard"): Promise<void> {
		if (!this.globalSettings.ttsr) {
			this.globalSettings.ttsr = {};
		}
		this.globalSettings.ttsr.contextMode = mode;
		this.markModified("ttsr", "contextMode");
		await this.save();
	}

	getTtsrRepeatMode(): "once" | "after-gap" {
		return this.settings.ttsr?.repeatMode ?? "once";
	}

	async setTtsrRepeatMode(mode: "once" | "after-gap"): Promise<void> {
		if (!this.globalSettings.ttsr) {
			this.globalSettings.ttsr = {};
		}
		this.globalSettings.ttsr.repeatMode = mode;
		this.markModified("ttsr", "repeatMode");
		await this.save();
	}

	getTtsrRepeatGap(): number {
		return this.settings.ttsr?.repeatGap ?? 10;
	}

	async setTtsrRepeatGap(gap: number): Promise<void> {
		if (!this.globalSettings.ttsr) {
			this.globalSettings.ttsr = {};
		}
		this.globalSettings.ttsr.repeatGap = gap;
		this.markModified("ttsr", "repeatGap");
		await this.save();
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Status Line Settings
	// ═══════════════════════════════════════════════════════════════════════════

	getStatusLineSettings(): StatusLineSettings {
		return this.settings.statusLine ? { ...this.settings.statusLine } : {};
	}

	getStatusLinePreset(): StatusLinePreset {
		return this.settings.statusLine?.preset ?? "default";
	}

	async setStatusLinePreset(preset: StatusLinePreset): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		if (preset !== "custom") {
			delete this.globalSettings.statusLine.leftSegments;
			delete this.globalSettings.statusLine.rightSegments;
			delete this.globalSettings.statusLine.segmentOptions;
			this.markModified("statusLine", "leftSegments");
			this.markModified("statusLine", "rightSegments");
			this.markModified("statusLine", "segmentOptions");
		}
		this.globalSettings.statusLine.preset = preset;
		this.markModified("statusLine", "preset");
		await this.save();
	}

	getStatusLineSeparator(): StatusLineSeparatorStyle {
		return this.settings.statusLine?.separator ?? "powerline-thin";
	}

	async setStatusLineSeparator(separator: StatusLineSeparatorStyle): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		this.globalSettings.statusLine.separator = separator;
		this.markModified("statusLine", "separator");
		await this.save();
	}

	getStatusLineLeftSegments(): StatusLineSegmentId[] {
		return [...(this.settings.statusLine?.leftSegments ?? [])];
	}

	async setStatusLineLeftSegments(segments: StatusLineSegmentId[]): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		this.globalSettings.statusLine.leftSegments = segments;
		this.markModified("statusLine", "leftSegments");
		// Setting segments explicitly implies custom preset
		if (this.globalSettings.statusLine.preset !== "custom") {
			this.globalSettings.statusLine.preset = "custom";
			this.markModified("statusLine", "preset");
		}
		await this.save();
	}

	getStatusLineRightSegments(): StatusLineSegmentId[] {
		return [...(this.settings.statusLine?.rightSegments ?? [])];
	}

	async setStatusLineRightSegments(segments: StatusLineSegmentId[]): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		this.globalSettings.statusLine.rightSegments = segments;
		this.markModified("statusLine", "rightSegments");
		// Setting segments explicitly implies custom preset
		if (this.globalSettings.statusLine.preset !== "custom") {
			this.globalSettings.statusLine.preset = "custom";
			this.markModified("statusLine", "preset");
		}
		await this.save();
	}

	getStatusLineSegmentOptions(): StatusLineSegmentOptions {
		return { ...this.settings.statusLine?.segmentOptions };
	}

	async setStatusLineSegmentOption<K extends keyof StatusLineSegmentOptions>(
		segment: K,
		option: keyof NonNullable<StatusLineSegmentOptions[K]>,
		value: boolean | number | string,
	): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		if (!this.globalSettings.statusLine.segmentOptions) {
			this.globalSettings.statusLine.segmentOptions = {};
		}
		if (!this.globalSettings.statusLine.segmentOptions[segment]) {
			this.globalSettings.statusLine.segmentOptions[segment] = {} as NonNullable<StatusLineSegmentOptions[K]>;
		}
		(this.globalSettings.statusLine.segmentOptions[segment] as Record<string, unknown>)[option as string] = value;
		this.markModified("statusLine", "segmentOptions");
		await this.save();
	}

	async clearStatusLineSegmentOption<K extends keyof StatusLineSegmentOptions>(
		segment: K,
		option: keyof NonNullable<StatusLineSegmentOptions[K]>,
	): Promise<void> {
		const segmentOptions = this.globalSettings.statusLine?.segmentOptions;
		if (!segmentOptions || !segmentOptions[segment]) {
			return;
		}
		delete (segmentOptions[segment] as Record<string, unknown>)[option as string];
		if (Object.keys(segmentOptions[segment] as Record<string, unknown>).length === 0) {
			delete segmentOptions[segment];
		}
		if (Object.keys(segmentOptions).length === 0) {
			delete this.globalSettings.statusLine?.segmentOptions;
		}
		this.markModified("statusLine", "segmentOptions");
		await this.save();
	}

	getStatusLineShowHookStatus(): boolean {
		return this.settings.statusLine?.showHookStatus ?? true;
	}

	async setStatusLineShowHookStatus(show: boolean): Promise<void> {
		if (!this.globalSettings.statusLine) {
			this.globalSettings.statusLine = {};
		}
		this.globalSettings.statusLine.showHookStatus = show;
		this.markModified("statusLine", "showHookStatus");
		await this.save();
	}

	getDoubleEscapeAction(): "branch" | "tree" {
		return this.settings.doubleEscapeAction ?? "tree";
	}

	async setDoubleEscapeAction(action: "branch" | "tree"): Promise<void> {
		this.globalSettings.doubleEscapeAction = action;
		this.markModified("doubleEscapeAction");
		await this.save();
	}

	getShowHardwareCursor(): boolean {
		// Check settings first
		if (this.settings.showHardwareCursor !== undefined) {
			return this.settings.showHardwareCursor;
		}
		// Check env var override
		const envVar = process.env.OMP_HARDWARE_CURSOR?.toLowerCase();
		if (envVar === "0" || envVar === "false") return false;
		if (envVar === "1" || envVar === "true") return true;
		// Default to true on Linux/macOS for IME support
		return process.platform === "linux" || process.platform === "darwin";
	}

	async setShowHardwareCursor(show: boolean): Promise<void> {
		this.globalSettings.showHardwareCursor = show;
		this.markModified("showHardwareCursor");
		await this.save();
	}

	/**
	 * Get environment variables from settings
	 */
	getEnvironmentVariables(): Record<string, string> {
		return { ...(this.settings.env ?? {}) };
	}

	/**
	 * Set environment variables in settings (not process.env)
	 * This will be applied on next startup or reload
	 */
	async setEnvironmentVariables(envVars: Record<string, string>): Promise<void> {
		this.globalSettings.env = { ...envVars };
		this.markModified("env");
		await this.save();
	}

	/**
	 * Clear all environment variables from settings
	 */
	async clearEnvironmentVariables(): Promise<void> {
		delete this.globalSettings.env;
		this.markModified("env");
		await this.save();
	}

	/**
	 * Set a single environment variable in settings
	 */
	async setEnvironmentVariable(key: string, value: string): Promise<void> {
		if (!this.globalSettings.env) {
			this.globalSettings.env = {};
		}
		this.globalSettings.env[key] = value;
		this.markModified("env", key);
		await this.save();
	}

	/**
	 * Remove a single environment variable from settings
	 */
	async removeEnvironmentVariable(key: string): Promise<void> {
		if (this.globalSettings.env) {
			delete this.globalSettings.env[key];
			this.markModified("env", key);
			await this.save();
		}
	}

	_compareUniqueCtorKeys(cwd: string, agentDir: string): boolean {
		if (this.cwd !== cwd) {
			cwd = path.normalize(cwd);
			if (this.cwd !== cwd) {
				return false;
			}
		}
		if (this.agentDir !== agentDir) {
			agentDir = path.normalize(agentDir);
			if (this.agentDir !== agentDir) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Acquire the last created SettingsManager instance.
	 * If no instance exists, create a new one.
	 * @returns The SettingsManager instance
	 */
	static acquire(
		cwd: string = process.cwd(),
		agentDir: string = getAgentDir(),
	): SettingsManager | Promise<SettingsManager> {
		const prev = SettingsManager.#lastInstance;
		if (prev?._compareUniqueCtorKeys(cwd, agentDir)) {
			return prev;
		}
		return SettingsManager.create(cwd, agentDir);
	}

	/**
	 * Gets the shell configuration
	 * @returns The shell configuration
	 */
	async getShellConfig() {
		const shell = this.getShellPath();
		return procmgr.getShellConfig(shell);
	}

	/**
	 * Gets the shell configuration from the last created SettingsManager instance.
	 * @returns The shell configuration
	 */
	static async getGlobalShellConfig() {
		const settings = await SettingsManager.acquire();
		return settings.getShellConfig();
	}
}
