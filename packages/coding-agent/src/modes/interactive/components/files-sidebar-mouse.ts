import {
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

	const isLeftPress = !event.release && (event.button & 0b11) === 0 && (event.button & 64) === 0;
	const isWheelUp = !event.release && event.button === 64;
	const isWheelDown = !event.release && event.button === 65;

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
		const drawerHeight = Math.max(6, Math.min(16, Math.floor(termHeight * 0.42)));
		const drawerTop = termHeight - drawerHeight + 1;
		if (event.col > gutter + 1 && event.row >= drawerTop) {
			if (event.release) return true;
			if (isWheelUp) {
				model.scrollPreview(-3);
				ctx.onRequestRender();
				return true;
			}
			if (isWheelDown) {
				model.scrollPreview(3);
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
			return true;
		}
	}

	// Clicking in the right workspace returns focus to the prompt editor
	if (isLeftPress && event.col > gutter + 1) {
		ctx.onReturnFocus();
		return false;
	}
	return false;
}
