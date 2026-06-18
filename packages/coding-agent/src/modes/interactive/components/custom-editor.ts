import { Editor, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/omk-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.ts";

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		const actionScope = [
			"app.clipboard.pasteImage",
			"app.interrupt",
			"app.exit",
			...this.actionHandlers.keys(),
		].filter((action, index, actions): action is AppKeybinding => actions.indexOf(action) === index);
		const scopedAction = this.keybindings.matchInScope(data, actionScope);
		if (scopedAction.conflicts.length > 0) {
			// Ambiguous app-level shortcuts must fail closed and fall through to editor handling.
			super.handleInput(data);
			return;
		}

		const action = scopedAction.keybinding as AppKeybinding | undefined;

		if (action === "app.clipboard.pasteImage") {
			this.onPasteImage?.();
			return;
		}

		if (action === "app.interrupt") {
			if (!this.isShowingAutocomplete()) {
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			super.handleInput(data);
			return;
		}

		if (action === "app.exit") {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			super.handleInput(data);
			return;
		}

		if (action) {
			const handler = this.actionHandlers.get(action);
			if (handler) {
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
