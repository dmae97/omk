/**
 * Hierarchical tree list rendering helper.
 */
import type { Theme } from "../modes/theme/theme";
import { formatMoreItems, replaceTabs } from "../tools/render-utils";
import type { TreeContext } from "./types";
import { getTreeBranch, getTreeContinuePrefix } from "./utils";

export interface TreeListOptions<T> {
	items: T[];
	expanded?: boolean;
	maxCollapsed?: number;
	/** Strict total-line budget for collapsed mode. When set (and not expanded),
	 *  rendering stops as soon as emitting the next item would exceed this many
	 *  lines, even within the first item. */
	maxCollapsedLines?: number;
	itemType?: string;
	renderItem: (item: T, context: TreeContext) => string | string[];
}

export function renderTreeList<T>(options: TreeListOptions<T>, theme: Theme): string[] {
	const { items, expanded = false, maxCollapsed = 8, maxCollapsedLines, itemType = "item", renderItem } = options;
	const maxItems = expanded ? items.length : Math.min(items.length, maxCollapsed);
	const linesBudget = !expanded && maxCollapsedLines !== undefined ? maxCollapsedLines : Infinity;

	// Pass 1: determine how many items fit within both the item count and line budget.
	let fittingCount = maxItems;
	if (linesBudget !== Infinity) {
		fittingCount = 0;
		let totalLines = 0;
		for (let i = 0; i < maxItems; i++) {
			const rendered = renderItem(items[i], {
				index: i,
				isLast: false,
				depth: 0,
				theme,
				prefix: "",
				continuePrefix: "",
			});
			const count = Array.isArray(rendered) ? rendered.length : rendered ? 1 : 0;
			if (count > 0 && totalLines + count > linesBudget) break;
			totalLines += count;
			fittingCount = i + 1;
		}
	}

	const remaining = items.length - fittingCount;
	const hasSummary = !expanded && remaining > 0;

	// Pass 2: render items with correct isLast and prefixes.
	const lines: string[] = [];
	for (let i = 0; i < fittingCount; i++) {
		const isLast = !hasSummary && i === fittingCount - 1;
		const branch = getTreeBranch(isLast, theme);
		const prefix = `${theme.fg("dim", branch)} `;
		const continuePrefix = `${theme.fg("dim", getTreeContinuePrefix(isLast, theme))}`;
		const context: TreeContext = {
			index: i,
			isLast,
			depth: 0,
			theme,
			prefix,
			continuePrefix,
		};
		const rendered = renderItem(items[i], context);
		if (Array.isArray(rendered)) {
			if (rendered.length === 0) continue;
			lines.push(`${prefix}${replaceTabs(rendered[0])}`);
			for (let j = 1; j < rendered.length; j++) {
				lines.push(`${continuePrefix}${replaceTabs(rendered[j])}`);
			}
		} else {
			lines.push(`${prefix}${replaceTabs(rendered)}`);
		}
	}

	if (hasSummary) {
		lines.push(`${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", formatMoreItems(remaining, itemType))}`);
	}

	return lines;
}
