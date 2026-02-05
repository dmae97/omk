/**
 * Multi-line editor component for hooks.
 * Supports Ctrl+G for external editor.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Container, Editor, matchesKey, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import { $env } from "@oh-my-pi/pi-utils";
import { nanoid } from "nanoid";
import { getEditorTheme, theme } from "../../modes/theme/theme";
import { DynamicBorder } from "./dynamic-border";

export class HookEditorComponent extends Container {
	private editor: Editor;
	private onSubmitCallback: (value: string) => void;
	private onCancelCallback: () => void;
	private tui: TUI;

	constructor(
		tui: TUI,
		title: string,
		prefill: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();

		this.tui = tui;
		this.onSubmitCallback = onSubmit;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create editor
		this.editor = new Editor(getEditorTheme());
		if (prefill) {
			this.editor.setText(prefill);
		}
		this.addChild(this.editor);

		this.addChild(new Spacer(1));

		// Add hint
		const hasExternalEditor = !!($env.VISUAL || $env.EDITOR);
		const hint = hasExternalEditor
			? "ctrl+enter submit  esc cancel  ctrl+g external editor"
			: "ctrl+enter submit  esc cancel";
		this.addChild(new Text(theme.fg("dim", hint), 1, 0));

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		// Ctrl+Enter to submit
		if (keyData === "\x1b[13;5u" || keyData === "\x1b[27;5;13~") {
			this.onSubmitCallback(this.editor.getText());
			return;
		}

		// Escape to cancel
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.onCancelCallback();
			return;
		}

		// Ctrl+G for external editor
		if (matchesKey(keyData, "ctrl+g")) {
			void this.openExternalEditor();
			return;
		}

		// Forward to editor
		this.editor.handleInput(keyData);
	}

	private async openExternalEditor(): Promise<void> {
		const editorCmd = $env.VISUAL || $env.EDITOR;
		if (!editorCmd) {
			return;
		}

		const currentText = this.editor.getText();
		const tmpFile = path.join(os.tmpdir(), `omp-hook-editor-${nanoid()}.md`);

		try {
			await Bun.write(tmpFile, currentText);
			this.tui.stop();

			const [editor, ...editorArgs] = editorCmd.split(" ");
			const child = Bun.spawn([editor, ...editorArgs, tmpFile], {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			const exitCode = await child.exited;

			if (exitCode === 0) {
				const newContent = (await Bun.file(tmpFile).text()).replace(/\n$/, "");
				this.editor.setText(newContent);
			}
		} finally {
			try {
				await fs.rm(tmpFile, { force: true });
			} catch {
				// Ignore cleanup errors
			}
			this.tui.start();
			this.tui.requestRender(true);
		}
	}
}
