import { type KeyId, matchesKey, parseKey } from "./keys";

/**
 * Editor actions that can be bound to keys.
 */
export type EditorAction =
	// Cursor movement
	| "cursorUp"
	| "cursorDown"
	| "cursorLeft"
	| "cursorRight"
	| "cursorWordLeft"
	| "cursorWordRight"
	| "cursorLineStart"
	| "cursorLineEnd"
	// Deletion
	| "deleteCharBackward"
	| "deleteCharForward"
	| "deleteWordBackward"
	| "deleteWordForward"
	| "deleteToLineStart"
	| "deleteToLineEnd"
	// Text input
	| "newLine"
	| "submit"
	| "tab"
	// Selection/autocomplete
	| "selectUp"
	| "selectDown"
	| "selectPageUp"
	| "selectPageDown"
	| "selectConfirm"
	| "selectCancel"
	// Clipboard
	| "copy";

// Re-export KeyId from keys.ts
export type { KeyId };

/**
 * Editor keybindings configuration.
 */
export type EditorKeybindingsConfig = {
	[K in EditorAction]?: KeyId | KeyId[];
};

/**
 * Default editor keybindings.
 */
export const DEFAULT_EDITOR_KEYBINDINGS: Required<EditorKeybindingsConfig> = {
	// Cursor movement
	cursorUp: "up",
	cursorDown: "down",
	cursorLeft: "left",
	cursorRight: "right",
	cursorWordLeft: ["alt+left", "ctrl+left", "alt+b"],
	cursorWordRight: ["alt+right", "ctrl+right", "alt+f"],
	cursorLineStart: ["home", "ctrl+a"],
	cursorLineEnd: ["end", "ctrl+e"],
	// Deletion
	deleteCharBackward: "backspace",
	deleteCharForward: ["delete", "ctrl+d"],
	deleteWordBackward: ["ctrl+w", "alt+backspace", "ctrl+backspace"],
	deleteWordForward: ["alt+delete", "alt+d"],
	deleteToLineStart: "ctrl+u",
	deleteToLineEnd: "ctrl+k",
	// Text input
	newLine: "shift+enter",
	submit: "enter",
	tab: "tab",
	// Selection/autocomplete
	selectUp: "up",
	selectDown: "down",
	selectPageUp: "pageUp",
	selectPageDown: "pageDown",
	selectConfirm: "enter",
	selectCancel: ["escape", "ctrl+c"],
	// Clipboard
	copy: "ctrl+c",
};

const SHIFTED_SYMBOL_KEYS = new Set<string>([
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"+",
	"{",
	"}",
	"|",
	":",
	"<",
	">",
	"?",
	"~",
]);

const normalizeKeyId = (key: KeyId): KeyId => key.toLowerCase() as KeyId;

/**
 * Manages keybindings for the editor.
 */
export class EditorKeybindingsManager {
	private actionToKeys: Map<EditorAction, KeyId[]>;

	constructor(config: EditorKeybindingsConfig = {}) {
		this.actionToKeys = new Map();
		this.buildMaps(config);
	}

	private buildMaps(config: EditorKeybindingsConfig): void {
		this.actionToKeys.clear();

		// Start with defaults
		for (const [action, keys] of Object.entries(DEFAULT_EDITOR_KEYBINDINGS)) {
			const keyArray = Array.isArray(keys) ? keys : [keys];
			this.actionToKeys.set(
				action as EditorAction,
				keyArray.map(key => normalizeKeyId(key as KeyId)),
			);
		}

		// Override with user config
		for (const [action, keys] of Object.entries(config)) {
			if (keys === undefined) continue;
			const keyArray = Array.isArray(keys) ? keys : [keys];
			this.actionToKeys.set(
				action as EditorAction,
				keyArray.map(key => normalizeKeyId(key as KeyId)),
			);
		}
	}

	/**
	 * Check if input matches a specific action.
	 */
	matches(data: string, action: EditorAction): boolean {
		const keys = this.actionToKeys.get(action);
		if (!keys) return false;
		for (const key of keys) {
			if (matchesKey(data, key)) return true;
		}

		const parsed = parseKey(data);
		if (!parsed || !parsed.startsWith("shift+")) return false;
		const keyName = parsed.slice("shift+".length);
		if (!SHIFTED_SYMBOL_KEYS.has(keyName)) return false;
		return keys.includes(keyName as KeyId);
	}

	/**
	 * Get keys bound to an action.
	 */
	getKeys(action: EditorAction): KeyId[] {
		return this.actionToKeys.get(action) ?? [];
	}

	/**
	 * Update configuration.
	 */
	setConfig(config: EditorKeybindingsConfig): void {
		this.buildMaps(config);
	}
}

// Global instance
let globalEditorKeybindings: EditorKeybindingsManager | null = null;

export function getEditorKeybindings(): EditorKeybindingsManager {
	if (!globalEditorKeybindings) {
		globalEditorKeybindings = new EditorKeybindingsManager();
	}
	return globalEditorKeybindings;
}

export function setEditorKeybindings(manager: EditorKeybindingsManager): void {
	globalEditorKeybindings = manager;
}
