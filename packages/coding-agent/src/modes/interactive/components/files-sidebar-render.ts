import { truncateToWidth, visibleWidth } from "omk-tui";
import { formatCompactSize } from "../../../core/repo-files-fs.ts";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { theme } from "../theme/theme.ts";
import type { FilesSidebarModel, VisibleTreeRow } from "./files-sidebar-model.ts";

export function fitPad(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export function renderCollapsedFilesRail(width: number, height: number, focused: boolean): string[] {
	const sep = theme.fg(focused ? "accent" : "borderMuted", "│");
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

export function renderFilesContextualHints(model: FilesSidebarModel, focused: boolean): [string, string] {
	if (!focused) return [theme.fg("dim", "Alt+E browse · ^B hide"), theme.fg("dim", "/files <q> · click row")];
	if (model.isFiltering())
		return [theme.fg("muted", "↑↓ pick · ⏎ view · Tab @"), theme.fg("dim", "Type query · Esc clear")];
	if (model.getPreview()) return [theme.fg("muted", "↑↓ scroll · ⏎/@ insert"), theme.fg("dim", "PgUp/Dn · Esc close")];
	return [theme.fg("muted", "⏎ open · Space/@ ins"), theme.fg("dim", "/ find · . dot · Esc back")];
}

export function renderFilesTreeRow(row: VisibleTreeRow, inner: number): string {
	const lead = row.selected ? theme.fg("accent", "┃") : " ";
	const guides = row.depth > 0 ? theme.fg("borderMuted", "│ ".repeat(Math.min(row.depth, 5))) : "";
	const chev = row.entry.kind === "dir" ? theme.fg("dim", row.expanded ? "▾" : "▸") : theme.fg("dim", "·");
	const glyph = row.entry.kind === "dir" ? theme.fg("warning", "▣") : theme.fg("dim", "▫");
	const label = singleLineDisplayText(row.isSearchHit ? row.entry.path : row.entry.name);
	const nameStyled = row.selected ? theme.bold(theme.fg("text", label)) : theme.fg("muted", label);

	let suffix = "";
	if (row.selected) {
		suffix = ` ${theme.fg("accent", "@")}`;
	} else if (!row.isSearchHit && row.entry.kind === "file" && row.entry.size > 0 && inner >= 24) {
		suffix = ` ${theme.fg("dim", formatCompactSize(row.entry.size))}`;
	}
	const contentBudget = Math.max(1, inner - visibleWidth(suffix));
	return `${fitPad(`${lead}${guides}${chev} ${glyph} ${nameStyled}`, contentBudget)}${suffix}`;
}

export function renderOpenFilesSidebar(
	model: FilesSidebarModel,
	focused: boolean,
	width: number,
	height: number,
	onViewportRows: (rows: number) => void,
): string[] {
	const borderRole = focused ? "border" : "borderMuted";
	const sep = theme.fg(borderRole, "│");
	const inner = Math.max(4, width - 1);
	const rule = `${theme.fg("borderMuted", "─".repeat(inner))}${theme.fg(borderRole, "┤")}`;
	const lines: string[] = [];

	const rootLabel = singleLineDisplayText(model.getRootName());
	const hiddenBadge = model.getIncludeHidden() ? theme.fg("accent", ".*") : theme.fg("dim", ".*");
	const tools = `${hiddenBadge} ${theme.fg("dim", "⊞ ↻ ◂")}`;
	const toolsWidth = visibleWidth(tools);
	const titleBudget = Math.max(4, inner - toolsWidth - 3);
	const title = focused
		? `${theme.fg("accent", "●")} ${theme.bold(theme.fg("text", `FILES · ${rootLabel}`))}`
		: `${theme.fg("dim", "◧")} ${theme.fg("muted", theme.bold(`REPO · ${rootLabel}`))}`;
	const titleClip = visibleWidth(title) <= titleBudget ? title : truncateToWidth(title, titleBudget, "…");
	const headGap = " ".repeat(Math.max(1, inner - 2 - visibleWidth(titleClip) - toolsWidth));
	lines.push(` ${titleClip}${headGap}${tools} ${sep}`);
	lines.push(rule);

	const visibleRows = model.getVisibleRows();
	const filterVal = singleLineDisplayText(model.getFilter());
	const countBadge = filterVal ? theme.fg("dim", ` ${visibleRows.length}`) : "";
	const filterBudget = Math.max(4, inner - visibleWidth(countBadge));
	const filterCore = model.isFiltering()
		? `${theme.fg("accent", "/")} ${theme.fg("text", filterVal)}${theme.fg("accent", "█")}`
		: filterVal
			? `${theme.fg("dim", "/")} ${theme.fg("text", filterVal)}`
			: theme.fg("dim", "/ Filter repo files...");
	lines.push(`${fitPad(` ${filterCore}`, filterBudget)}${countBadge}${sep}`);
	lines.push(rule);

	const bodyRows = Math.max(1, height - lines.length - 3);
	onViewportRows(bodyRows);
	model.syncScroll(bodyRows, visibleRows.length);
	const start = model.getScrollOffset();
	const slice = visibleRows.slice(start, start + bodyRows);

	if (slice.length === 0) {
		const emptyMsg = model.getErrorMessage() ?? (filterVal ? "No matching files" : "Empty directory");
		lines.push(`${fitPad(` ${theme.fg("dim", singleLineDisplayText(emptyMsg))}`, inner)}${sep}`);
		for (let i = 1; i < bodyRows; i++) lines.push(`${" ".repeat(inner)}${sep}`);
	} else {
		for (const row of slice) lines.push(`${renderFilesTreeRow(row, inner)}${sep}`);
		for (let i = slice.length; i < bodyRows; i++) lines.push(`${" ".repeat(inner)}${sep}`);
	}

	lines.push(rule);
	const [hint1, hint2] = renderFilesContextualHints(model, focused);
	lines.push(`${fitPad(` ${hint1}`, inner)}${sep}`);
	lines.push(`${fitPad(` ${hint2}`, inner)}${sep}`);
	return lines;
}
