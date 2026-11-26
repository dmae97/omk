import { type Component, type Focusable, Key, matchesKey, truncateToWidth, visibleWidth } from "omk-tui";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { theme } from "../theme/theme.ts";
import type { FilesSidebarModel, VisibleTreeRow } from "./files-sidebar-model.ts";

export interface FilesSidebarCallbacks {
	readonly getRows: () => number;
	readonly requestRender: () => void;
	readonly onInsertPath: (relPath: string) => void;
	readonly onReturnFocus: () => void;
	readonly onToggleMode: () => void;
}

function fitPad(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
	const pad = Math.max(0, width - visibleWidth(clipped));
	return `${clipped}${" ".repeat(pad)}`;
}

export class FilesSidebarComponent implements Component, Focusable {
	focused = false;
	private readonly model: FilesSidebarModel;
	private readonly cb: FilesSidebarCallbacks;
	private lastTreeViewportRows = 16;

	constructor(model: FilesSidebarModel, callbacks: FilesSidebarCallbacks) {
		this.model = model;
		this.cb = callbacks;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("b")) || matchesKey(data, Key.alt("b"))) {
			this.cb.onToggleMode();
			return;
		}
		if (matchesKey(data, Key.alt("e"))) {
			this.cb.onReturnFocus();
			return;
		}
		if (this.model.isFiltering()) {
			this.handleFilterInput(data);
			return;
		}
		if (this.model.getPreview()) {
			if (matchesKey(data, Key.escape)) {
				this.model.closePreview();
				this.cb.requestRender();
				return;
			}
			if (matchesKey(data, Key.pageUp)) {
				this.model.scrollPreview(-10);
				this.cb.requestRender();
				return;
			}
			if (matchesKey(data, Key.pageDown)) {
				this.model.scrollPreview(10);
				this.cb.requestRender();
				return;
			}
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab)) {
			this.cb.onReturnFocus();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.model.moveSelection(-1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.model.moveSelection(1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter) || matchesKey(data, Key.right) || data === "l") {
			this.model.activateSelected();
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.left) || data === "h") {
			this.model.collapseSelectedOrParent();
			this.cb.requestRender();
			return;
		}
		if (data === "@") {
			const entry = this.model.getSelectedEntry();
			if (entry) this.cb.onInsertPath(entry.path);
			return;
		}
		if (data === "/") {
			this.model.setFiltering(true);
			this.cb.requestRender();
			return;
		}
		if (data === ".") {
			this.model.toggleHidden();
			this.cb.requestRender();
			return;
		}
		if (data === "c") {
			this.model.collapseAll();
			this.cb.requestRender();
			return;
		}
		if (data === "r") {
			this.model.refresh();
			this.cb.requestRender();
			return;
		}
		if (data === "[") {
			this.model.adjustWidth(-4);
			this.cb.requestRender();
			return;
		}
		if (data === "]") {
			this.model.adjustWidth(4);
			this.cb.requestRender();
		}
	}

	private handleFilterInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.model.setFilter("");
			this.model.setFiltering(false);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.model.setFiltering(false);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.model.setFilter(this.model.getFilter().slice(0, -1));
			this.cb.requestRender();
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) !== 0x7f) {
			this.model.setFilter(this.model.getFilter() + data);
			this.cb.requestRender();
		}
	}

	render(width: number): string[] {
		const height = Math.max(8, this.cb.getRows());
		const mode = this.model.getMode();
		if (mode === "hidden" || width < 2) return [];
		if (mode === "collapsed" || width <= 4) {
			return this.renderCollapsedRail(width, height);
		}
		return this.renderOpenSidebar(width, height);
	}

	private renderCollapsedRail(width: number, height: number): string[] {
		const sep = theme.fg(this.focused ? "accent" : "borderMuted", "│");
		const inner = Math.max(1, width - 1);
		const labels = ["▸", "", "F", "I", "L", "E", "S"];
		const lines: string[] = [];
		for (let i = 0; i < height; i++) {
			const glyph = labels[i] ?? "";
			const styled = i === 0 ? theme.fg("accent", glyph) : theme.fg("dim", glyph);
			lines.push(`${fitPad(glyph ? ` ${styled}` : "", inner)}${sep}`);
		}
		return lines;
	}

	private renderOpenSidebar(width: number, height: number): string[] {
		const borderRole = this.focused ? "border" : "borderMuted";
		const sep = theme.fg(borderRole, "│");
		const inner = Math.max(4, width - 1);
		const rule = `${theme.fg("borderMuted", "─".repeat(inner))}${theme.fg(borderRole, "┤")}`;
		const lines: string[] = [];

		// Header row: REPO · <name>  .* ⊞ ↻ ◂
		const rootLabel = singleLineDisplayText(this.model.getRootName());
		const hiddenBadge = this.model.getIncludeHidden() ? theme.fg("accent", ".*") : theme.fg("dim", ".*");
		const tools = `${hiddenBadge} ${theme.fg("dim", "⊞ ↻ ◂")}`;
		const toolsWidth = visibleWidth(tools);
		const titleBudget = Math.max(4, inner - toolsWidth - 3);
		const prefix = this.focused ? theme.fg("accent", "◧") : theme.fg("dim", "◧");
		const title = `${prefix} ${theme.fg("muted", theme.bold(`REPO · ${rootLabel}`))}`;
		const titleClip = visibleWidth(title) <= titleBudget ? title : truncateToWidth(title, titleBudget, "…");
		const headGap = " ".repeat(Math.max(1, inner - 2 - visibleWidth(titleClip) - toolsWidth));
		lines.push(` ${titleClip}${headGap}${tools} ${sep}`);
		lines.push(rule);

		// Filter input row
		const filterVal = singleLineDisplayText(this.model.getFilter());
		const filterLine = this.model.isFiltering()
			? `${theme.fg("accent", "/")} ${theme.fg("text", filterVal)}${theme.fg("accent", "█")}`
			: filterVal
				? `${theme.fg("dim", "/")} ${theme.fg("text", filterVal)}`
				: theme.fg("dim", "Filter repo files...");
		lines.push(`${fitPad(` ${filterLine}`, inner)}${sep}`);
		lines.push(rule);

		// Tree body
		const footerRows = 2;
		const bodyRows = Math.max(1, height - lines.length - footerRows);
		this.lastTreeViewportRows = bodyRows;
		const visibleRows = this.model.getVisibleRows();
		this.model.syncScroll(bodyRows, visibleRows.length);
		const start = this.model.getScrollOffset();
		const slice = visibleRows.slice(start, start + bodyRows);

		if (slice.length === 0) {
			const emptyMsg = this.model.getErrorMessage() ?? (filterVal ? "No matching files" : "Empty directory");
			lines.push(`${fitPad(` ${theme.fg("dim", singleLineDisplayText(emptyMsg))}`, inner)}${sep}`);
			for (let i = 1; i < bodyRows; i++) {
				lines.push(`${" ".repeat(inner)}${sep}`);
			}
		} else {
			for (const row of slice) {
				lines.push(`${this.renderTreeRow(row, inner)}${sep}`);
			}
			for (let i = slice.length; i < bodyRows; i++) {
				lines.push(`${" ".repeat(inner)}${sep}`);
			}
		}

		// Bottom hint bar
		lines.push(rule);
		const hint = this.focused
			? theme.fg("muted", " ↑↓ ⏎ @ / . c r [/] Esc")
			: theme.fg("dim", " Alt+E focus · ^B/Alt+B");
		lines.push(`${fitPad(hint, inner)}${sep}`);
		return lines;
	}

	private renderTreeRow(row: VisibleTreeRow, inner: number): string {
		const lead = row.selected ? theme.fg("accent", "┃") : " ";
		const guides = row.depth > 0 ? theme.fg("borderMuted", "│ ".repeat(Math.min(row.depth, 5))) : "";
		const chev = row.entry.kind === "dir" ? theme.fg("dim", row.expanded ? "▾" : "▸") : theme.fg("dim", "·");
		const glyph = row.entry.kind === "dir" ? theme.fg("warning", "▣") : theme.fg("dim", "▫");
		const name = singleLineDisplayText(row.entry.name);
		const nameStyled = row.selected ? theme.bold(theme.fg("text", name)) : theme.fg("muted", name);
		const suffix = row.selected ? ` ${theme.fg("dim", "@")}` : "";
		const suffixW = row.selected ? 2 : 0;
		const contentBudget = Math.max(1, inner - suffixW);
		const left = `${lead}${guides}${chev} ${glyph} ${nameStyled}`;
		const fitted = fitPad(left, contentBudget);
		return `${fitted}${suffix}`;
	}
}
