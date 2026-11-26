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
import { handleFilesSidebarMouse, parseSgrMouse } from "./components/files-sidebar-mouse.ts";

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
	setMouseEnabled(enabled: boolean): void;
	syncRootDir(cwd: string): void;
	handleCommand(arg: string): string;
}

const SGR_MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const SGR_MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";

export function setupFilesSidebar(options: FilesSidebarSetupOptions): FilesSidebarController {
	const { ui, settingsManager, getCwd, getEditor, insertTextIntoEditor, onStateChange } = options;
	const initialMode: FilesSidebarMode = settingsManager.getShowFilesSidebar() ? "open" : "hidden";
	const model = new FilesSidebarModel(getCwd(), initialMode);

	let mouseActive = false;
	const setMouseMode = (enable: boolean): void => {
		if (!process.stdout.isTTY || mouseActive === enable) return;
		mouseActive = enable;
		try {
			process.stdout.write(enable ? SGR_MOUSE_ON : SGR_MOUSE_OFF);
		} catch {
			mouseActive = false;
		}
	};

	if (process.stdout.isTTY && process.env.OMK_TUI_MOUSE !== "0") {
		setMouseMode(true);
		process.once("exit", () => setMouseMode(false));
	}

	const syncCwdIfChanged = (): void => {
		const cwd = getCwd();
		if (cwd && cwd !== model.getRootDir()) model.setRootDir(cwd);
	};

	const returnFocusToEditor = (): void => {
		ui.setFocus(getEditor());
		ui.requestRender();
	};

	const insertPath = (relPath: string): void => {
		model.closePreview();
		insertTextIntoEditor(`${relPath} `);
		returnFocusToEditor();
	};

	const gutterWidth = (width: number, height: number): number => {
		syncCwdIfChanged();
		return filesSidebarGutterWidth(model.getMode(), model.getWidth(), width, height);
	};

	const sidebarVisible = (width: number, height: number): boolean => gutterWidth(width, height) > 0;

	const sidebar = new FilesSidebarComponent(model, {
		getRows: () => ui.terminal.rows,
		requestRender: () => {
			onStateChange?.();
			ui.requestRender();
		},
		onInsertPath: insertPath,
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

	ui.addInputListener((data) => {
		const mouse = parseSgrMouse(data);
		if (!mouse) return undefined;
		const consumed = handleFilesSidebarMouse(mouse, {
			model,
			termWidth: ui.terminal.columns,
			termHeight: ui.terminal.rows,
			treeViewportRows: sidebar.getTreeViewportRows(),
			onFocusSidebar: () => controller.focus(),
			onReturnFocus: returnFocusToEditor,
			onToggleMode: () => controller.toggle(),
			onInsertPath: insertPath,
			onRequestRender: () => {
				onStateChange?.();
				ui.requestRender();
			},
		});
		return consumed ? { consume: true } : undefined;
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
			syncCwdIfChanged();
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
		setMouseEnabled(enabled) {
			setMouseMode(enabled);
		},
		syncRootDir(cwd) {
			model.setRootDir(cwd);
			ui.requestRender();
		},
		handleCommand(arg) {
			const raw = arg.trim();
			const sub = raw.toLowerCase();
			if (sub === "off" || sub === "hide") {
				this.setMode("hidden", true);
				return "Files sidebar hidden (/files on to restore)";
			}
			if (sub === "on" || sub === "show" || sub === "open") {
				this.setMode("open", true);
				return "Files sidebar open (Alt+E to browse, Ctrl+B/Alt+B to collapse)";
			}
			if (sub === "collapse" || sub === "rail") {
				this.setMode("collapsed", true);
				return "Files sidebar collapsed to rail";
			}
			if (sub === "toggle") {
				this.toggle();
				return `Files sidebar: ${model.getMode()}`;
			}
			if (sub === "mouse off" || sub === "mouse 0") {
				setMouseMode(false);
				return "Files sidebar mouse mode off (drag-select text freely)";
			}
			if (sub === "mouse on" || sub === "mouse 1") {
				setMouseMode(true);
				return "Files sidebar mouse mode on (click & wheel enabled; Shift+drag selects text)";
			}
			if (raw) {
				model.startSearch(raw);
				this.focus();
				return `Searching files for "${raw}" (↑↓ pick, Enter view, Tab insert, Esc clear)`;
			}
			this.focus();
			return "Files focused (↑↓ move, Enter preview, Space/@ insert, / search, Esc back)";
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
