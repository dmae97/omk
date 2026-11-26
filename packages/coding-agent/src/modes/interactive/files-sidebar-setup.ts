import type { Component, TUI } from "omk-tui";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { FilePreviewDrawerComponent } from "./components/file-preview-drawer.ts";
import { FilesSidebarComponent } from "./components/files-sidebar.ts";
import {
	FILES_SIDEBAR_MIN_COLS,
	FILES_SIDEBAR_MIN_ROWS,
	type FilesSidebarMode,
	FilesSidebarModel,
	filesSidebarGutterWidth,
} from "./components/files-sidebar-model.ts";

export interface FilesSidebarSetupOptions {
	readonly ui: TUI;
	readonly settingsManager: SettingsManager;
	readonly getCwd: () => string;
	readonly getEditor: () => Component;
	readonly insertTextIntoEditor: (text: string) => void;
	readonly onStateChange?: () => void;
}

export interface FilesSidebarController {
	readonly model: FilesSidebarModel;
	readonly sidebar: FilesSidebarComponent;
	readonly preview: FilePreviewDrawerComponent;
	toggle(): void;
	focus(): void;
	setMode(mode: FilesSidebarMode, persist?: boolean): void;
	syncRootDir(cwd: string): void;
	handleCommand(arg: string): string;
}

export function setupFilesSidebar(options: FilesSidebarSetupOptions): FilesSidebarController {
	const { ui, settingsManager, getCwd, getEditor, insertTextIntoEditor, onStateChange } = options;
	const initialMode: FilesSidebarMode = settingsManager.getShowFilesSidebar() ? "open" : "hidden";
	const model = new FilesSidebarModel(getCwd(), initialMode);

	const returnFocusToEditor = (): void => {
		ui.setFocus(getEditor());
		ui.requestRender();
	};

	const sidebarVisible = (width: number, height: number): boolean =>
		filesSidebarGutterWidth(model.getMode(), model.getWidth(), width, height) > 0;

	const gutterWidth = (width: number, height: number): number =>
		filesSidebarGutterWidth(model.getMode(), model.getWidth(), width, height);

	const sidebar = new FilesSidebarComponent(model, {
		getRows: () => ui.terminal.rows,
		requestRender: () => {
			onStateChange?.();
			ui.requestRender();
		},
		onInsertPath: (relPath) => {
			model.closePreview();
			insertTextIntoEditor(`${relPath} `);
			returnFocusToEditor();
		},
		onReturnFocus: returnFocusToEditor,
		onToggleMode: () => controller.toggle(),
	});

	const preview = new FilePreviewDrawerComponent(model, () => ui.terminal.rows);

	ui.showOverlay(sidebar, {
		anchor: "top-left",
		width: (termWidth, termHeight) => Math.max(3, gutterWidth(termWidth, termHeight)),
		maxHeight: "100%",
		nonCapturing: true,
		visible: sidebarVisible,
	});

	ui.showOverlay(preview, {
		anchor: "bottom-right",
		width: (termWidth, termHeight) => {
			const left = gutterWidth(termWidth, termHeight);
			return Math.max(20, termWidth - (left > 0 ? left + 1 : 0));
		},
		maxHeight: "45%",
		nonCapturing: true,
		visible: (width, height) =>
			model.getPreview() !== null && width >= FILES_SIDEBAR_MIN_COLS && height >= FILES_SIDEBAR_MIN_ROWS,
	});

	ui.setLeftGutter((width, height) => {
		const w = gutterWidth(width, height);
		return w > 0 ? w + 1 : 0;
	});

	const controller: FilesSidebarController = {
		model,
		sidebar,
		preview,
		toggle() {
			const next = model.toggleMode();
			settingsManager.setShowFilesSidebar(next !== "hidden");
			if (next !== "open") {
				model.closePreview();
				ui.setFocus(getEditor());
			}
			onStateChange?.();
			ui.requestRender();
		},
		focus() {
			if (model.getMode() !== "open") {
				model.setMode("open");
				settingsManager.setShowFilesSidebar(true);
			}
			ui.setFocus(sidebar);
			onStateChange?.();
			ui.requestRender();
		},
		setMode(mode, persist = true) {
			model.setMode(mode);
			if (persist) settingsManager.setShowFilesSidebar(mode !== "hidden");
			if (mode !== "open") {
				model.closePreview();
				ui.setFocus(getEditor());
			}
			onStateChange?.();
			ui.requestRender();
		},
		syncRootDir(cwd) {
			model.setRootDir(cwd);
			ui.requestRender();
		},
		handleCommand(arg) {
			const sub = arg.trim().toLowerCase();
			if (sub === "off" || sub === "hide") {
				this.setMode("hidden", true);
				return "Files sidebar hidden (/files on to restore)";
			}
			if (sub === "on" || sub === "show" || sub === "open") {
				this.setMode("open", true);
				return "Files sidebar open (Alt+E to focus, Ctrl+B/Alt+B to collapse)";
			}
			if (sub === "collapse" || sub === "rail") {
				this.setMode("collapsed", true);
				return "Files sidebar collapsed to rail";
			}
			if (sub === "toggle") {
				const next = model.toggleMode();
				settingsManager.setShowFilesSidebar(next !== "hidden");
				if (next !== "open") {
					model.closePreview();
					ui.setFocus(getEditor());
				}
				onStateChange?.();
				ui.requestRender();
				return `Files sidebar: ${next}`;
			}
			this.focus();
			return "Files sidebar focused (↑↓ nav, Enter preview, @ insert, Esc back)";
		},
	};

	return controller;
}

export interface FilesKeyBinder {
	onAction(action: "app.files.toggle" | "app.files.focus", handler: () => void): void;
}

export function mountFilesSidebarOnMode(
	ui: TUI,
	settingsManager: SettingsManager,
	getCwd: () => string,
	getEditor: () => Component & { getText(): string; setText(text: string): void },
	keyBinder: FilesKeyBinder,
	onStateChange: () => void,
): FilesSidebarController {
	const ctrl = setupFilesSidebar({
		ui,
		settingsManager,
		getCwd,
		getEditor,
		insertTextIntoEditor: (t) => {
			const ed = getEditor();
			ed.setText(`${ed.getText()}${t}`);
		},
		onStateChange,
	});
	keyBinder.onAction("app.files.toggle", () => ctrl.toggle());
	keyBinder.onAction("app.files.focus", () => ctrl.focus());
	return ctrl;
}

export function runFilesSlashCommand(
	ctrl: FilesSidebarController | undefined,
	text: string,
	clearEditor: () => void,
	showStatus: (msg: string) => void,
): void {
	clearEditor();
	showStatus(ctrl?.handleCommand(text.slice(6)) ?? "Files sidebar unavailable");
}
