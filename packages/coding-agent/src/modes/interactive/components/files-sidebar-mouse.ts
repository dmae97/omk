import {
	computePreviewDrawerLayout,
	FILES_SIDEBAR_MIN_COLS,
	FILES_SIDEBAR_MIN_ROWS,
	type FilesSidebarModel,
	filesSidebarGutterWidth,
} from "./files-sidebar-model.ts";

export interface SgrMouseEvent {
	readonly button: number;
	readonly col: number; // 1-based terminal column
	readonly row: number; // 1-based terminal row
	readonly release: boolean;
}

const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/;

export function parseSgrMouse(data: string): SgrMouseEvent | null {
	const match = SGR_MOUSE_RE.exec(data);
	if (!match) return null;
	return {
		button: Number(match[1]),
		col: Number(match[2]),
		row: Number(match[3]),
		release: match[4] === "m",
	};
}

export function isSgrLeftPress(event: SgrMouseEvent): boolean {
	return !event.release && (event.button & 64) === 0 && (event.button & 32) === 0 && (event.button & 0b11) === 0;
}

export function isSgrLeftDrag(event: SgrMouseEvent): boolean {
	return !event.release && (event.button & 64) === 0 && (event.button & 32) !== 0 && (event.button & 0b11) === 0;
}

export function isSgrLeftRelease(event: SgrMouseEvent): boolean {
	return event.release && (event.button & 64) === 0 && (event.button & 0b11) === 0;
}

export function isSgrWheelUp(event: SgrMouseEvent): boolean {
	return !event.release && (event.button & 64) !== 0 && (event.button & 0b11) === 0;
}

export function isSgrWheelDown(event: SgrMouseEvent): boolean {
	return !event.release && (event.button & 64) !== 0 && (event.button & 0b11) === 1;
}

export function hasSgrFastScrollModifier(event: SgrMouseEvent): boolean {
	return (event.button & (4 | 16)) !== 0;
}

const SGR_MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const SGR_MOUSE_OFF = "\x1b[?1002l\x1b[?1000l\x1b[?1006l";

let mouseHooksRegistered = false;
let mouseWanted = false;
let mouseActive = false;

export function setProcessMouseMode(enable: boolean, forceWrite = false): void {
	mouseWanted = enable;
	if (!process.stdout.isTTY || (!forceWrite && mouseActive === enable)) return;
	mouseActive = enable;
	try {
		process.stdout.write(enable ? SGR_MOUSE_ON : SGR_MOUSE_OFF);
	} catch {
		mouseActive = false;
	}
}

export function enableDefaultProcessMouseMode(): void {
	if (!process.stdout.isTTY || process.env.OMK_TUI_MOUSE === "0") return;
	if (!mouseHooksRegistered) {
		mouseHooksRegistered = true;
		process.once("exit", () => setProcessMouseMode(false));
		if (process.platform !== "win32") {
			process.on("SIGCONT", () => {
				if (mouseWanted) setProcessMouseMode(true, true);
			});
		}
	}
	setProcessMouseMode(true);
}

export interface FilesSidebarMouseContext {
	readonly model: FilesSidebarModel;
	readonly termWidth: number;
	readonly termHeight: number;
	readonly treeViewportRows: number;
	readonly onFocusSidebar: () => void;
	readonly onReturnFocus: () => void;
	readonly onToggleMode: () => void;
	readonly onInsertPath: (relPath: string) => void;
	readonly onRequestRender: () => void;
}

/**
 * Route SGR mouse click and wheel events targeting the left files sidebar or preview drawer.
 * Returns true if the event was consumed by the files UI.
 */
export function handleFilesSidebarMouse(event: SgrMouseEvent, ctx: FilesSidebarMouseContext): boolean {
	const { model, termWidth, termHeight, treeViewportRows } = ctx;
	const gutter = filesSidebarGutterWidth(model.getMode(), model.getWidth(), termWidth, termHeight);
	if (gutter <= 0) return false;

	const isLeftPress = isSgrLeftPress(event);
	const isWheelUp = isSgrWheelUp(event);
	const isWheelDown = isSgrWheelDown(event);
	// Click or scroll inside the left sidebar / collapsed rail
	if (event.col >= 1 && event.col <= gutter) {
		if (event.release) return true;
		if (model.getMode() === "collapsed") {
			if (isLeftPress) ctx.onFocusSidebar();
			return true;
		}
		if (isWheelUp) {
			model.scrollTree(-3, treeViewportRows);
			ctx.onRequestRender();
			return true;
		}
		if (isWheelDown) {
			model.scrollTree(3, treeViewportRows);
			ctx.onRequestRender();
			return true;
		}
		if (!isLeftPress) return true;

		// Row 1: Header toolbar (right side: ".* ⊞ ↻ ◂ ")
		if (event.row === 1) {
			const fromRight = gutter - event.col;
			if (fromRight <= 2)
				ctx.onToggleMode(); // ◂
			else if (fromRight <= 4) {
				model.refresh();
				ctx.onRequestRender();
			} else if (fromRight <= 6) {
				model.collapseAll();
				ctx.onRequestRender();
			} else if (fromRight <= 9) {
				model.toggleHidden();
				ctx.onRequestRender();
			} else {
				ctx.onFocusSidebar();
			}
			return true;
		}

		// Row 3: Filter box
		if (event.row === 3) {
			ctx.onFocusSidebar();
			model.setFiltering(true);
			ctx.onRequestRender();
			return true;
		}

		// Tree body rows start at 1-based row 5
		const bodyTop = 5;
		const bodyBottom = bodyTop + treeViewportRows - 1;
		if (event.row >= bodyTop && event.row <= bodyBottom) {
			const idx = model.getScrollOffset() + (event.row - bodyTop);
			const entry = model.selectVisibleIndex(idx, treeViewportRows);
			if (entry) {
				model.setFiltering(false);
				ctx.onFocusSidebar();
				// Rightmost 2 columns inside sidebar = "@" quick-insert target
				if (event.col >= gutter - 2) {
					ctx.onInsertPath(entry.path);
				} else {
					model.activateSelected();
					ctx.onRequestRender();
				}
			}
			return true;
		}

		ctx.onFocusSidebar();
		return true;
	}

	// Click or scroll inside the bottom-right preview drawer when visible
	if (model.getPreview() && termWidth >= FILES_SIDEBAR_MIN_COLS && termHeight >= FILES_SIDEBAR_MIN_ROWS) {
		const { drawerTop, bodyRows } = computePreviewDrawerLayout(termHeight);
		if (event.col > gutter + 1 && event.row >= drawerTop) {
			if (isWheelUp) {
				model.scrollPreview(-3, bodyRows);
				ctx.onRequestRender();
				return true;
			}
			if (isWheelDown) {
				model.scrollPreview(3, bodyRows);
				ctx.onRequestRender();
				return true;
			}
			if (isLeftPress && event.row === drawerTop) {
				const fromRight = termWidth - event.col;
				if (fromRight <= 12) {
					model.closePreview();
					ctx.onRequestRender();
				} else if (fromRight <= 24) {
					const path = model.getPreview()?.path;
					if (path) ctx.onInsertPath(path);
				}
				return true;
			}
			// Allow press/drag/release inside preview body (row > drawerTop) to fall through to text drag selection.
			return event.row === drawerTop;
		}
	}

	// Clicking in the right workspace returns focus to the prompt editor
	if (isLeftPress && event.col > gutter + 1) {
		ctx.onReturnFocus();
		return false;
	}
	return false;
}
