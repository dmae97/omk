/**
 * Multi-line editor component for hooks.
 * Supports Ctrl+G for external editor.
 */
import { Container, Editor, matchesKey, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import { getEditorTheme, theme } from "../../modes/theme/theme";
import { getEditorCommand, openInEditor } from "../../utils/external-editor";
import { DynamicBorder } from "./dynamic-border";

export class HookEditorComponent extends Container {
	#editor: Editor;
	#onSubmitCallback: (value: string) => void;
	#onCancelCallback: () => void;
	#tui: TUI;

	constructor(
		tui: TUI,
		title: string,
		prefill: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();

		this.#tui = tui;
		this.#onSubmitCallback = onSubmit;
		this.#onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create editor
		this.#editor = new Editor(getEditorTheme());
		if (prefill) {
			this.#editor.setText(prefill);
		}
		this.addChild(this.#editor);

		this.addChild(new Spacer(1));

		// Add hint
		const hint = "ctrl+enter submit  esc cancel  ctrl+g external editor";
		this.addChild(new Text(theme.fg("dim", hint), 1, 0));

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		// Ctrl+Enter to submit
		if (keyData === "\x1b[13;5u" || keyData === "\x1b[27;5;13~") {
			this.#onSubmitCallback(this.#editor.getText());
			return;
		}

		// Escape to cancel
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.#onCancelCallback();
			return;
		}

		// Ctrl+G for external editor
		if (matchesKey(keyData, "ctrl+g")) {
			void this.#openExternalEditor();
			return;
		}

		// Forward to editor
		this.#editor.handleInput(keyData);
	}

	async #openExternalEditor(): Promise<void> {
		const editorCmd = getEditorCommand();
		if (!editorCmd) return;

		const currentText = this.#editor.getText();
		try {
			this.#tui.stop();
			const result = await openInEditor(editorCmd, currentText);
			if (result !== null) {
				this.#editor.setText(result);
			}
		} finally {
			this.#tui.start();
			this.#tui.requestRender(true);
		}
	}
}
