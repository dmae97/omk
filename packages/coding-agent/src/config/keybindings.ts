import * as path from "node:path";
import {
	DEFAULT_EDITOR_KEYBINDINGS,
	type EditorAction,
	type EditorKeybindingsConfig,
	EditorKeybindingsManager,
	type KeyId,
	matchesKey,
	setEditorKeybindings,
} from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDir } from "../config";

/**
 * Application-level actions (coding agent specific).
 */
export type AppAction =
	| "interrupt"
	| "clear"
	| "exit"
	| "suspend"
	| "cycleThinkingLevel"
	| "cycleModelForward"
	| "cycleModelBackward"
	| "selectModel"
	| "togglePlanMode"
	| "expandTools"
	| "toggleThinking"
	| "externalEditor"
	| "historySearch"
	| "followUp"
	| "dequeue"
	| "pasteImage";

/**
 * All configurable actions.
 */
export type KeyAction = AppAction | EditorAction;

/**
 * Full keybindings configuration (app + editor actions).
 */
export type KeybindingsConfig = {
	[K in KeyAction]?: KeyId | KeyId[];
};

/**
 * Default application keybindings.
 */
export const DEFAULT_APP_KEYBINDINGS: Record<AppAction, KeyId | KeyId[]> = {
	interrupt: "escape",
	clear: "ctrl+c",
	exit: "ctrl+d",
	suspend: "ctrl+z",
	cycleThinkingLevel: "shift+tab",
	cycleModelForward: "ctrl+p",
	cycleModelBackward: "shift+ctrl+p",
	selectModel: "ctrl+l",
	togglePlanMode: "alt+shift+p",
	historySearch: "ctrl+r",
	expandTools: "ctrl+o",
	toggleThinking: "ctrl+t",
	externalEditor: "ctrl+g",
	followUp: "ctrl+enter",
	dequeue: "alt+up",
	pasteImage: "ctrl+v",
};

/**
 * All default keybindings (app + editor).
 */
export const DEFAULT_KEYBINDINGS: Required<KeybindingsConfig> = {
	...DEFAULT_EDITOR_KEYBINDINGS,
	...DEFAULT_APP_KEYBINDINGS,
};

// App actions list for type checking
const APP_ACTIONS: AppAction[] = [
	"interrupt",
	"clear",
	"exit",
	"suspend",
	"cycleThinkingLevel",
	"cycleModelForward",
	"cycleModelBackward",
	"selectModel",
	"togglePlanMode",
	"historySearch",
	"expandTools",
	"toggleThinking",
	"externalEditor",
	"followUp",
	"dequeue",
	"pasteImage",
];

function isAppAction(action: string): action is AppAction {
	return APP_ACTIONS.includes(action as AppAction);
}

/**
 * Key hint formatting utilities for UI labels.
 */
const MODIFIER_LABELS: Record<string, string> = {
	ctrl: "Ctrl",
	shift: "Shift",
	alt: "Alt",
};

const KEY_LABELS: Record<string, string> = {
	esc: "Esc",
	escape: "Esc",
	enter: "Enter",
	return: "Enter",
	space: "Space",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	home: "Home",
	end: "End",
	pageup: "PgUp",
	pagedown: "PgDn",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
};

const normalizeKeyId = (key: KeyId): KeyId => key.toLowerCase() as KeyId;

function formatKeyPart(part: string): string {
	const lower = part.toLowerCase();
	const modifier = MODIFIER_LABELS[lower];
	if (modifier) return modifier;
	const label = KEY_LABELS[lower];
	if (label) return label;
	if (part.length === 1) return part.toUpperCase();
	return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}

export function formatKeyHint(key: KeyId): string {
	return key.split("+").map(formatKeyPart).join("+");
}

export function formatKeyHints(keys: KeyId | KeyId[]): string {
	const list = Array.isArray(keys) ? keys : [keys];
	return list.map(formatKeyHint).join("/");
}

/**
 * Manages all keybindings (app + editor).
 */
export class KeybindingsManager {
	private config: KeybindingsConfig;
	private appActionToKeys: Map<AppAction, KeyId[]>;

	private constructor(config: KeybindingsConfig) {
		this.config = config;
		this.appActionToKeys = new Map();
		this.buildMaps();
	}

	/**
	 * Create from config file and set up editor keybindings.
	 */
	static async create(agentDir: string = getAgentDir()): Promise<KeybindingsManager> {
		const configPath = path.join(agentDir, "keybindings.json");
		const config = await KeybindingsManager.loadFromFile(configPath);
		const manager = new KeybindingsManager(config);

		// Set up editor keybindings globally
		const editorConfig: EditorKeybindingsConfig = {};
		for (const [action, keys] of Object.entries(config)) {
			if (!isAppAction(action)) {
				editorConfig[action as EditorAction] = keys;
			}
		}
		setEditorKeybindings(new EditorKeybindingsManager(editorConfig));

		return manager;
	}

	/**
	 * Create in-memory.
	 */
	static inMemory(config: KeybindingsConfig = {}): KeybindingsManager {
		return new KeybindingsManager(config);
	}

	private static async loadFromFile(path: string): Promise<KeybindingsConfig> {
		try {
			return await Bun.file(path).json();
		} catch (error) {
			logger.warn("Failed to parse keybindings config", { path, error: String(error) });
			return {};
		}
	}

	private buildMaps(): void {
		this.appActionToKeys.clear();

		// Set defaults for app actions
		for (const [action, keys] of Object.entries(DEFAULT_APP_KEYBINDINGS)) {
			const keyArray = Array.isArray(keys) ? keys : [keys];
			this.appActionToKeys.set(
				action as AppAction,
				keyArray.map(key => normalizeKeyId(key as KeyId)),
			);
		}

		// Override with user config (app actions only)
		for (const [action, keys] of Object.entries(this.config)) {
			if (keys === undefined || !isAppAction(action)) continue;
			const keyArray = Array.isArray(keys) ? keys : [keys];
			this.appActionToKeys.set(
				action,
				keyArray.map(key => normalizeKeyId(key as KeyId)),
			);
		}
	}

	/**
	 * Check if input matches an app action.
	 */
	matches(data: string, action: AppAction): boolean {
		const keys = this.appActionToKeys.get(action);
		if (!keys) return false;
		for (const key of keys) {
			if (matchesKey(data, key)) return true;
		}
		return false;
	}

	/**
	 * Get keys bound to an app action.
	 */
	getKeys(action: AppAction): KeyId[] {
		return this.appActionToKeys.get(action) ?? [];
	}

	/**
	 * Get display string for an action.
	 */
	getDisplayString(action: AppAction): string {
		const keys = this.getKeys(action);
		if (keys.length === 0) return "";
		if (keys.length === 1) return keys[0]!;
		return keys.join("/");
	}

	/**
	 * Get the full effective config.
	 */
	getEffectiveConfig(): Required<KeybindingsConfig> {
		const result = { ...DEFAULT_KEYBINDINGS };
		for (const [action, keys] of Object.entries(this.config)) {
			if (keys !== undefined) {
				(result as KeybindingsConfig)[action as KeyAction] = keys;
			}
		}
		return result;
	}
}

// Re-export for convenience
export type { EditorAction, KeyId };
