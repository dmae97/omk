import { Text, visibleWidth } from "omk-tui";
import type { FilesSidebarMode } from "./components/files-sidebar-model.ts";
import { theme } from "./theme/theme.ts";

const TODO_WIDGET_KEY_RE = /^(?:omk-todo|pi-todos?|todos?)$|(?:^|[-_:])todos?(?:$|[-_:])/i;

export function isTodoWidgetKey(key: string): boolean {
	return TODO_WIDGET_KEY_RE.test(key);
}

export function createTodosHiddenBanner(): Text {
	return new Text(
		theme.fg("dim", "  ☐ TODOS hidden · click ") +
			theme.fg("accent", "☐ Todos ▸") +
			theme.fg("dim", " or press Alt+T / /todos show"),
		0,
		0,
	);
}

export type HeaderChipHit = "files" | "todos";

/**
 * Hit-test the clickable chips on row 1 of `OMK · STATUS`:
 * `┌─ [◧ Files ◂  ][☑ Todos ▾  ]◉ OMK · STATUS ...`
 * `col` is 1-based terminal column; `leftGutter` is the reserved columns before the header.
 */
export function hitTestOmkHeaderChips(
	col: number,
	leftGutter: number,
	filesSidebarMode?: FilesSidebarMode,
): HeaderChipHit | undefined {
	// Prefix inside header row 1: "┌─ " (3 columns)
	const startCol = leftGutter + 1 + visibleWidth("┌─ ");
	let cursor = startCol;

	if (filesSidebarMode === "open" || filesSidebarMode === "collapsed") {
		const filesLabel = filesSidebarMode === "open" ? "◧ Files ◂" : "◧ Files ▸";
		const filesWidth = visibleWidth(filesLabel);
		if (col >= cursor && col < cursor + filesWidth) return "files";
		cursor += filesWidth + 2; // "  " spacer after files chip
	}

	const todosWidth = visibleWidth("☑ Todos ▾");
	if (col >= cursor && col < cursor + todosWidth) return "todos";
	return undefined;
}

export function formatFilesAndMouseHelp(
	sidebarMode: FilesSidebarMode,
	mouseEnabled: boolean,
	savedShowFilesSidebar: boolean | undefined,
): string {
	const savedNote =
		savedShowFilesSidebar === undefined
			? "not saved (using default/env)"
			: `saved as ${String(savedShowFilesSidebar)} in settings.json`;
	return [
		`Files sidebar: ${sidebarMode} (default: on · ${savedNote})`,
		"  Precedence: project .omk/settings.json showFilesSidebar > global ~/.omk/agent/settings.json showFilesSidebar > OMK_FILES_SIDEBAR=0 > default on.",
		"  Disable/toggle: Ctrl+B / Alt+B, /files off, /files collapse (session-only), or OMK_FILES_SIDEBAR=0 (when unset in settings.json). Ctrl+B and /files on|off|toggle persist to global settings.json.",
		`Mouse mode: ${mouseEnabled ? "on" : "off"} (default: on in TTY · drag selects & copies text; Shift+drag uses terminal selection)`,
		"  Disable/toggle: /files mouse off|on (session-only, not saved) or export OMK_TUI_MOUSE=0 for persistent off.",
		"Todos panel: Alt+T, /todos hide|show|toggle, or click ☑ Todos ▾/☐ Todos ▸ in the top bar (persisted to showTodos in settings.json; OMK_SHOW_TODOS=0 default off).",
	].join("\n");
}

export interface FilesCommandTarget {
	getMode(): FilesSidebarMode;
	setMode(mode: FilesSidebarMode, persist?: boolean): void;
	toggle(): void;
	focus(): void;
	startSearch(query: string): void;
	setMouseMode(enable: boolean): void;
	isMouseEnabled(): boolean;
	getSavedShowFilesSidebar(): boolean | undefined;
}

export function dispatchFilesCommand(target: FilesCommandTarget, arg: string): string {
	const raw = arg.trim();
	const sub = raw.toLowerCase();
	if (sub === "off" || sub === "hide") {
		target.setMode("hidden", true);
		return "Files sidebar hidden (saved to settings.json · /files on to restore)";
	}
	if (sub === "on" || sub === "show" || sub === "open") {
		target.setMode("open", true);
		return "Files sidebar open (saved to settings.json · Alt+E browse, Ctrl+B/Alt+B collapse)";
	}
	if (sub === "collapse" || sub === "rail") {
		target.setMode("collapsed", false);
		return "Files sidebar collapsed to rail (session-only)";
	}
	if (sub === "toggle") {
		target.toggle();
		return `Files sidebar: ${target.getMode()}`;
	}
	if (sub === "mouse off" || sub === "mouse 0") {
		target.setMouseMode(false);
		return "Files sidebar mouse mode off (session-only, not saved; drag-select text freely)";
	}
	if (sub === "mouse on" || sub === "mouse 1") {
		target.setMouseMode(true);
		return "Files sidebar mouse mode on (session-only, not saved; drag selects & copies text; Shift+drag uses terminal selection)";
	}
	if (sub === "help" || sub === "status" || sub === "?") {
		return formatFilesAndMouseHelp(target.getMode(), target.isMouseEnabled(), target.getSavedShowFilesSidebar());
	}
	if (raw) {
		target.startSearch(raw);
		target.focus();
		return `Searching files for "${raw}" (↑↓ pick, Enter view, Tab insert, Esc clear)`;
	}
	target.focus();
	return "Files focused (↑↓ move, Enter preview, Space/@ insert, / search, Esc back · /files help for settings)";
}

export interface TodosCommandTarget {
	isTodosVisible(): boolean;
	setTodosVisible(visible: boolean, persist?: boolean): void;
	toggleTodos(): void;
}

export function dispatchTodosCommand(target: TodosCommandTarget, arg: string): string {
	const sub = arg.trim().toLowerCase();
	if (sub === "hide" || sub === "off") {
		target.setTodosVisible(false, true);
		return "TODOS hidden (saved to settings.json · click ☐ Todos ▸, press Alt+T, or run /todos show)";
	}
	if (sub === "show" || sub === "on") {
		target.setTodosVisible(true, true);
		return "TODOS shown (saved to settings.json · click ☑ Todos ▾ or press Alt+T to hide)";
	}
	if (sub === "status" || sub === "help") {
		return `TODOS: ${target.isTodosVisible() ? "shown" : "hidden"} (default: on · settings.json showTodos > OMK_SHOW_TODOS=0 · toggle via Alt+T, /todos, or top bar Todos chip)`;
	}
	target.toggleTodos();
	return target.isTodosVisible()
		? "TODOS shown (saved to settings.json)"
		: "TODOS hidden (saved to settings.json · click ☐ Todos ▸ or press Alt+T to restore)";
}

export function handleOmkHeaderMouseClick(
	mouseCol: number,
	mouseRow: number,
	leftGutter: number,
	contentWidth: number,
	termHeight: number,
	filesSidebarMode: FilesSidebarMode,
	onToggleFiles: () => void,
	onToggleTodos: () => void,
): boolean {
	if (mouseRow === 1) {
		const hit = hitTestOmkHeaderChips(mouseCol, leftGutter, filesSidebarMode);
		if (hit === "files") {
			onToggleFiles();
			return true;
		}
		if (hit === "todos") {
			onToggleTodos();
			return true;
		}
		return false;
	}
	// Clickable right-aligned `☑ Todos ▾` / `☐ Todos ▸` button on the always-visible bottom footer row.
	const chipWidth = visibleWidth("☑ Todos ▾");
	const rightEdge = leftGutter + contentWidth;
	if (
		mouseRow >= Math.max(2, termHeight - 2) &&
		mouseRow <= termHeight &&
		mouseCol >= rightEdge - chipWidth + 1 &&
		mouseCol <= rightEdge
	) {
		onToggleTodos();
		return true;
	}
	return false;
}

export function runFilesSlashCommand(
	ctrl: { handleCommand(arg: string): string; handleTodosCommand(arg: string): string } | undefined,
	text: string,
	clearEditor: () => void,
	showStatus: (msg: string) => void,
): void {
	clearEditor();
	if (/^\/todos(?: |$)/.test(text)) {
		showStatus(ctrl?.handleTodosCommand(text.slice(6)) ?? "Todos toggle unavailable");
		return;
	}
	showStatus(ctrl?.handleCommand(text.slice(6)) ?? "Files sidebar unavailable");
}

export function formatFooterPwdRowWithTodosChip(
	metaText: string,
	width: number,
	minPadding: number,
	todosVisible: boolean,
	truncate: (s: string, w: number, ellipsis: string) => string,
): { pwdLine: string; pwdLeft: string; pwdRight: string } {
	const chipRaw = todosVisible ? "☑ Todos ▾" : "☐ Todos ▸";
	const chipStyled = todosVisible ? theme.fg("muted", chipRaw) : theme.fg("dim", chipRaw);
	const chipWidth = visibleWidth(chipRaw);
	if (width < chipWidth + 10) {
		const pwdLeft = truncate(metaText, width, theme.fg("dim", "…"));
		return { pwdLine: pwdLeft, pwdLeft, pwdRight: "" };
	}
	const pwdLeft = truncate(metaText, width - chipWidth - minPadding, theme.fg("dim", "…"));
	const pad = " ".repeat(Math.max(minPadding, width - visibleWidth(pwdLeft) - chipWidth));
	return { pwdLine: pwdLeft + pad + chipStyled, pwdLeft, pwdRight: chipStyled };
}
