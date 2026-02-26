/**
 * Declarative settings definitions for the UI.
 *
 * This file derives UI definitions from the schema - no duplicate get/set wrappers.
 * To add a new setting to the UI:
 * 1. Add it to settings-schema.ts with a `ui` field
 * 2. That's it - it appears in the UI automatically
 */
import { TERMINAL } from "@oh-my-pi/pi-tui";
import {
	getDefault,
	getEnumValues,
	getPathsForTab,
	getType,
	getUi,
	SETTING_TABS,
	type SettingPath,
	type SettingTab,
} from "../../config/settings-schema";

// ═══════════════════════════════════════════════════════════════════════════
// UI Definition Types
// ═══════════════════════════════════════════════════════════════════════════

export type SettingValue = boolean | string;

interface BaseSettingDef {
	path: SettingPath;
	label: string;
	description: string;
	tab: SettingTab;
}

export interface BooleanSettingDef extends BaseSettingDef {
	type: "boolean";
	condition?: () => boolean;
}

export interface EnumSettingDef extends BaseSettingDef {
	type: "enum";
	values: readonly string[];
}

export interface SubmenuSettingDef extends BaseSettingDef {
	type: "submenu";
	get options(): OptionList;
	onPreview?: (value: string) => void;
	onPreviewCancel?: (originalValue: string) => void;
}

export type SettingDef = BooleanSettingDef | EnumSettingDef | SubmenuSettingDef;

// ═══════════════════════════════════════════════════════════════════════════
// Condition Functions
// ═══════════════════════════════════════════════════════════════════════════

const CONDITIONS: Record<string, () => boolean> = {
	hasImageProtocol: () => !!TERMINAL.imageProtocol,
};

// ═══════════════════════════════════════════════════════════════════════════
// Submenu Option Providers
// ═══════════════════════════════════════════════════════════════════════════

type OptionList = ReadonlyArray<{ value: string; label: string; description?: string }>;
type OptionProvider = (() => OptionList) | OptionList;

const OPTION_PROVIDERS: Partial<Record<SettingPath, OptionProvider>> = {
	// Retry max retries
	"retry.maxRetries": [
		{ value: "1", label: "1 retry" },
		{ value: "2", label: "2 retries" },
		{ value: "3", label: "3 retries" },
		{ value: "5", label: "5 retries" },
		{ value: "10", label: "10 retries" },
	],
	// Task max concurrency
	"task.maxConcurrency": [
		{ value: "0", label: "Unlimited" },
		{ value: "1", label: "1 task" },
		{ value: "2", label: "2 tasks" },
		{ value: "4", label: "4 tasks" },
		{ value: "8", label: "8 tasks" },
		{ value: "16", label: "16 tasks" },
		{ value: "32", label: "32 tasks" },
		{ value: "64", label: "64 tasks" },
	],
	// Task max recursion depth
	"task.maxRecursionDepth": [
		{ value: "-1", label: "Unlimited" },
		{ value: "0", label: "None" },
		{ value: "1", label: "Single" },
		{ value: "2", label: "Double" },
		{ value: "3", label: "Triple" },
	],
	// Todo max reminders
	"todo.reminders.max": [
		{ value: "1", label: "1 reminder" },
		{ value: "2", label: "2 reminders" },
		{ value: "3", label: "3 reminders" },
		{ value: "5", label: "5 reminders" },
	],
	// Grep context
	"grep.contextBefore": [
		{ value: "0", label: "0 lines" },
		{ value: "1", label: "1 line" },
		{ value: "2", label: "2 lines" },
		{ value: "3", label: "3 lines" },
		{ value: "5", label: "5 lines" },
	],
	"grep.contextAfter": [
		{ value: "0", label: "0 lines" },
		{ value: "1", label: "1 line" },
		{ value: "2", label: "2 lines" },
		{ value: "3", label: "3 lines" },
		{ value: "5", label: "5 lines" },
		{ value: "10", label: "10 lines" },
	],
	// Autocomplete max visible
	autocompleteMaxVisible: [
		{ value: "3", label: "3 items" },
		{ value: "5", label: "5 items" },
		{ value: "7", label: "7 items" },
		{ value: "10", label: "10 items" },
		{ value: "15", label: "15 items" },
		{ value: "20", label: "20 items" },
	],
	// Ask timeout
	"ask.timeout": [
		{ value: "0", label: "Disabled" },
		{ value: "15", label: "15 seconds" },
		{ value: "30", label: "30 seconds" },
		{ value: "60", label: "60 seconds" },
		{ value: "120", label: "120 seconds" },
	],
	// Edit fuzzy threshold
	"edit.fuzzyThreshold": [
		{ value: "0.85", label: "0.85", description: "Lenient" },
		{ value: "0.90", label: "0.90", description: "Moderate" },
		{ value: "0.95", label: "0.95", description: "Default" },
		{ value: "0.98", label: "0.98", description: "Strict" },
	],
	// TTSR repeat gap
	"ttsr.repeatGap": [
		{ value: "5", label: "5 messages" },
		{ value: "10", label: "10 messages" },
		{ value: "15", label: "15 messages" },
		{ value: "20", label: "20 messages" },
		{ value: "30", label: "30 messages" },
	],
	"ttsr.interruptMode": [
		{ value: "always", label: "always", description: "Interrupt on prose and tool streams" },
		{ value: "prose-only", label: "prose-only", description: "Interrupt only on reply/thinking matches" },
		{ value: "tool-only", label: "tool-only", description: "Interrupt only on tool-call argument matches" },
		{ value: "never", label: "never", description: "Never interrupt; inject warning after completion" },
	],
	// Provider options
	"providers.webSearch": [
		{
			value: "auto",
			label: "Auto",
			description:
				"Priority: Perplexity > Exa > Brave > Jina > Kimi > Anthropic > Gemini > Codex > Z.AI > Synthetic",
		},
		{ value: "exa", label: "Exa", description: "Requires EXA_API_KEY" },
		{ value: "brave", label: "Brave", description: "Requires BRAVE_API_KEY" },
		{ value: "jina", label: "Jina", description: "Requires JINA_API_KEY" },
		{ value: "kimi", label: "Kimi", description: "Requires MOONSHOT_SEARCH_API_KEY or MOONSHOT_API_KEY" },
		{ value: "perplexity", label: "Perplexity", description: "Requires PERPLEXITY_COOKIES or PERPLEXITY_API_KEY" },
		{ value: "anthropic", label: "Anthropic", description: "Uses Anthropic web search" },
		{ value: "zai", label: "Z.AI", description: "Calls Z.AI webSearchPrime MCP" },
		{ value: "synthetic", label: "Synthetic", description: "Requires SYNTHETIC_API_KEY" },
	],
	"providers.image": [
		{ value: "auto", label: "Auto", description: "Priority: OpenRouter > Gemini" },
		{ value: "gemini", label: "Gemini", description: "Requires GEMINI_API_KEY" },
		{ value: "openrouter", label: "OpenRouter", description: "Requires OPENROUTER_API_KEY" },
	],
	"providers.kimiApiFormat": [
		{ value: "openai", label: "OpenAI", description: "api.kimi.com" },
		{ value: "anthropic", label: "Anthropic", description: "api.moonshot.ai" },
	],
	// Default thinking level
	defaultThinkingLevel: [
		{ value: "off", label: "off", description: "No reasoning" },
		{ value: "minimal", label: "minimal", description: "Very brief (~1k tokens)" },
		{ value: "low", label: "low", description: "Light (~2k tokens)" },
		{ value: "medium", label: "medium", description: "Moderate (~8k tokens)" },
		{ value: "high", label: "high", description: "Deep (~16k tokens)" },
		{ value: "xhigh", label: "xhigh", description: "Maximum (~32k tokens)" },
	],
	// Temperature
	temperature: [
		{ value: "-1", label: "Default", description: "Use provider default" },
		{ value: "0", label: "0", description: "Deterministic" },
		{ value: "0.2", label: "0.2", description: "Focused" },
		{ value: "0.5", label: "0.5", description: "Balanced" },
		{ value: "0.7", label: "0.7", description: "Creative" },
		{ value: "1", label: "1", description: "Maximum variety" },
	],
	// Symbol preset
	symbolPreset: [
		{ value: "unicode", label: "Unicode", description: "Standard symbols (default)" },
		{ value: "nerd", label: "Nerd Font", description: "Requires Nerd Font" },
		{ value: "ascii", label: "ASCII", description: "Maximum compatibility" },
	],
	// Status line preset
	"statusLine.preset": [
		{ value: "default", label: "Default", description: "Model, path, git, context, tokens, cost" },
		{ value: "minimal", label: "Minimal", description: "Path and git only" },
		{ value: "compact", label: "Compact", description: "Model, git, cost, context" },
		{ value: "full", label: "Full", description: "All segments including time" },
		{ value: "nerd", label: "Nerd", description: "Maximum info with Nerd Font icons" },
		{ value: "ascii", label: "ASCII", description: "No special characters" },
		{ value: "custom", label: "Custom", description: "User-defined segments" },
	],
	// Status line separator
	"statusLine.separator": [
		{ value: "powerline", label: "Powerline", description: "Solid arrows (Nerd Font)" },
		{ value: "powerline-thin", label: "Thin chevron", description: "Thin arrows (Nerd Font)" },
		{ value: "slash", label: "Slash", description: "Forward slashes" },
		{ value: "pipe", label: "Pipe", description: "Vertical pipes" },
		{ value: "block", label: "Block", description: "Solid blocks" },
		{ value: "none", label: "None", description: "Space only" },
		{ value: "ascii", label: "ASCII", description: "Greater-than signs" },
	],
};

function createSubmenuSettingDef(base: Omit<SettingDef, "type" | "options">, provider: OptionProvider): SettingDef {
	if (typeof provider === "function") {
		return {
			...base,
			type: "submenu",
			get options() {
				return provider();
			},
		};
	} else {
		return {
			...base,
			type: "submenu",
			options: provider,
		};
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Schema to UI Conversion
// ═══════════════════════════════════════════════════════════════════════════

function pathToSettingDef(path: SettingPath): SettingDef | null {
	const ui = getUi(path);
	if (!ui) return null;

	const schemaType = getType(path);
	const base = { path, label: ui.label, description: ui.description, tab: ui.tab };

	// Check for condition
	const condition = ui.condition ? CONDITIONS[ui.condition] : undefined;

	if (schemaType === "boolean") {
		return { ...base, type: "boolean", condition };
	}

	if (schemaType === "enum") {
		const values = getEnumValues(path) ?? [];

		// If marked as submenu, use submenu type
		if (ui.submenu) {
			const provider = OPTION_PROVIDERS[path];
			if (!provider) return null;
			return createSubmenuSettingDef(base, provider);
		}

		return { ...base, type: "enum", values };
	}

	if (schemaType === "number" && ui.submenu) {
		const provider = OPTION_PROVIDERS[path];
		if (provider) {
			return createSubmenuSettingDef(base, provider);
		}
	}

	if (schemaType === "string" && ui.submenu) {
		const provider = OPTION_PROVIDERS[path];
		if (provider) {
			return createSubmenuSettingDef(base, provider);
		}
		// For theme etc, options will be injected at runtime
		return createSubmenuSettingDef(base, []);
	}

	return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/** Cache of generated definitions */
let cachedDefs: SettingDef[] | null = null;

/** Get all setting definitions with UI */
export function getAllSettingDefs(): SettingDef[] {
	if (cachedDefs) return cachedDefs;

	const defs: SettingDef[] = [];
	for (const tab of [...SETTING_TABS, "status"] as SettingTab[]) {
		for (const path of getPathsForTab(tab)) {
			const def = pathToSettingDef(path);
			if (def) defs.push(def);
		}
	}
	cachedDefs = defs;
	return defs;
}

/** Get settings for a specific tab */
export function getSettingsForTab(tab: SettingTab): SettingDef[] {
	return getAllSettingDefs().filter(def => def.tab === tab);
}

/** Get a setting definition by path */
export function getSettingDef(path: SettingPath): SettingDef | undefined {
	return getAllSettingDefs().find(def => def.path === path);
}

/** Get default value for display */
export function getDisplayDefault(path: SettingPath): string {
	const value = getDefault(path);
	if (value === undefined) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}
