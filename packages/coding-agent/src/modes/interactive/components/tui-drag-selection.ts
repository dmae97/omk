import type { TUI } from "omk-tui";
import { copyToClipboard } from "../../../utils/clipboard.ts";
import { handleOmkHeaderMouseClick } from "../todos-visibility.ts";
import type { FilesSidebarModel } from "./files-sidebar-model.ts";
import {
	handleFilesSidebarMouse,
	isSgrLeftDrag,
	isSgrLeftPress,
	isSgrLeftRelease,
	isSgrWheelDown,
	isSgrWheelUp,
	parseSgrMouse,
	type SgrMouseEvent,
} from "./files-sidebar-mouse.ts";
import {
	applySelectionHighlight,
	clampCell,
	extractSelectedText,
	normalizeSelectionRange,
	resolveSelectionPane,
	type ScreenCell,
	type SelectionPaneBounds,
	type TuiDragSelectionState,
} from "./tui-drag-selection-model.ts";

export {
	applySelectionHighlight,
	extractSelectedText,
	normalizeSelectionRange,
	resolveSelectionPane,
	type ScreenCell,
	type SelectionPaneBounds,
	type TuiDragSelectionState,
};

export interface TuiDragSelectionOptions {
	readonly ui: TUI;
	readonly getLeftGutter: (termWidth: number, termHeight: number) => number;
	readonly onCopy?: (text: string) => void | Promise<void>;
}

export interface TuiDragSelectionController {
	handleActiveDragOrRelease(mouse: SgrMouseEvent): boolean;
	handleUnhandledMouse(mouse: SgrMouseEvent): boolean;
	handleKeyInput(data: string): { consume: true } | undefined;
	clear(): void;
	getState(): TuiDragSelectionState;
}

export function setupTuiDragSelection(options: TuiDragSelectionOptions): TuiDragSelectionController {
	const { ui, getLeftGutter } = options;
	const copyText =
		options.onCopy ??
		((text: string) => {
			void copyToClipboard(text).catch(() => {});
		});

	let state: TuiDragSelectionState = { kind: "idle" };

	const activeRange = (): { start: ScreenCell; end: ScreenCell; pane: SelectionPaneBounds } | null => {
		if (state.kind === "dragging" && state.moved) {
			return { ...normalizeSelectionRange(state.anchor, state.focus), pane: state.pane };
		}
		if (state.kind === "selected") return { start: state.start, end: state.end, pane: state.pane };
		return null;
	};

	const clear = (): void => {
		if (state.kind === "idle") return;
		const hadHighlight = state.kind === "selected" || state.moved;
		state = { kind: "idle" };
		if (hadHighlight) ui.requestRender();
	};

	const copySelection = (start: ScreenCell, end: ScreenCell, pane: SelectionPaneBounds): void => {
		const text = extractSelectedText(ui.getViewportLines(), start, end, pane);
		if (text.trim().length === 0) return;
		try {
			const res = copyText(text);
			if (res && typeof (res as Promise<void>).catch === "function") void (res as Promise<void>).catch(() => {});
		} catch {
			// Clipboard errors must never crash TUI input handling.
		}
	};

	ui.setViewportDecorator((viewportLines, width, height) => {
		if (state.kind !== "idle" && (state.termWidth !== width || state.termHeight !== height)) {
			state = { kind: "idle" };
			return [...viewportLines];
		}
		const range = activeRange();
		return range
			? applySelectionHighlight(viewportLines, range.start, range.end, range.pane, width)
			: (viewportLines as string[]);
	});

	return {
		handleActiveDragOrRelease(mouse: SgrMouseEvent): boolean {
			if (state.kind !== "dragging") return false;
			const cell: ScreenCell = {
				col: clampCell(mouse.col, 1, Math.max(1, ui.terminal.columns)),
				row: clampCell(mouse.row, 1, Math.max(1, ui.terminal.rows)),
			};
			if (isSgrLeftDrag(mouse)) {
				const moved = state.moved || cell.col !== state.anchor.col || cell.row !== state.anchor.row;
				if (cell.col !== state.focus.col || cell.row !== state.focus.row || moved !== state.moved) {
					state = { ...state, focus: cell, moved };
					if (moved) ui.requestRender();
				}
				return true;
			}
			if (isSgrLeftRelease(mouse)) {
				const moved = state.moved || cell.col !== state.anchor.col || cell.row !== state.anchor.row;
				if (!moved) {
					state = { kind: "idle" };
					return true;
				}
				const { start, end } = normalizeSelectionRange(state.anchor, cell);
				const { pane, termWidth, termHeight } = state;
				state = { kind: "selected", start, end, pane, termWidth, termHeight };
				copySelection(start, end, pane);
				ui.requestRender();
				return true;
			}
			return false;
		},

		handleUnhandledMouse(mouse: SgrMouseEvent): boolean {
			if (isSgrLeftPress(mouse)) {
				const termWidth = Math.max(1, ui.terminal.columns);
				const termHeight = Math.max(1, ui.terminal.rows);
				const col = clampCell(mouse.col, 1, termWidth);
				const row = clampCell(mouse.row, 1, termHeight);
				const hadHighlight = state.kind === "selected" || (state.kind === "dragging" && state.moved);
				state = {
					kind: "dragging",
					anchor: { col, row },
					focus: { col, row },
					moved: false,
					pane: resolveSelectionPane(col, getLeftGutter(termWidth, termHeight), ui.contentWidth, termWidth),
					termWidth,
					termHeight,
				};
				if (hadHighlight) ui.requestRender();
			}
			return true;
		},

		handleKeyInput(data: string): { consume: true } | undefined {
			if (state.kind === "idle") return undefined;
			if (state.kind === "selected" && (data === "\x03" || data === "\x1b[99;5u")) {
				copySelection(state.start, state.end, state.pane);
				clear();
				return { consume: true };
			}
			clear();
			return undefined;
		},

		clear,
		getState: () => state,
	};
}

export interface TuiMouseWiringOptions {
	readonly ui: TUI;
	readonly model: FilesSidebarModel;
	readonly getLeftGutter: (termWidth: number, termHeight: number) => number;
	readonly getTreeViewportRows: () => number;
	readonly dragSelection: TuiDragSelectionController;
	readonly attachChatWheel: () => void;
	readonly onToggleFiles: () => void;
	readonly onToggleTodos: () => void;
	readonly onFocusSidebar: () => void;
	readonly onReturnFocus: () => void;
	readonly onInsertPath: (relPath: string) => void;
	readonly onRequestRender: () => void;
}

export function attachTuiMouseRouting(options: TuiMouseWiringOptions): void {
	const { ui, model, getLeftGutter, getTreeViewportRows, dragSelection } = options;
	ui.addInputListener((data) => {
		const mouse = parseSgrMouse(data);
		if (!mouse) return dragSelection.handleKeyInput(data);
		if (dragSelection.handleActiveDragOrRelease(mouse)) return { consume: true };
		if (isSgrWheelUp(mouse) || isSgrWheelDown(mouse)) dragSelection.clear();
		const headerHit =
			isSgrLeftPress(mouse) &&
			handleOmkHeaderMouseClick(
				mouse.col,
				mouse.row,
				getLeftGutter(ui.terminal.columns, ui.terminal.rows),
				ui.contentWidth,
				ui.terminal.rows,
				model.getMode(),
				options.onToggleFiles,
				options.onToggleTodos,
			);
		if (headerHit) {
			dragSelection.clear();
			return { consume: true };
		}
		const sidebarHit = handleFilesSidebarMouse(mouse, {
			model,
			termWidth: ui.terminal.columns,
			termHeight: ui.terminal.rows,
			treeViewportRows: getTreeViewportRows(),
			onFocusSidebar: options.onFocusSidebar,
			onReturnFocus: options.onReturnFocus,
			onToggleMode: options.onToggleFiles,
			onInsertPath: options.onInsertPath,
			onRequestRender: options.onRequestRender,
		});
		if (sidebarHit) {
			dragSelection.clear();
			return { consume: true };
		}
		return undefined;
	});
	options.attachChatWheel();
	ui.addInputListener((data) => {
		const mouse = parseSgrMouse(data);
		return mouse && dragSelection.handleUnhandledMouse(mouse) ? { consume: true } : undefined;
	});
}
