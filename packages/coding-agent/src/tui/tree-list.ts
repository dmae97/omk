/**
 * Hierarchical tree list rendering helper.
 */

import type { Theme } from "$c/modes/theme/theme";
import { formatMoreItems } from "$c/tools/render-utils";
import type { TreeContext } from "./types";
import { getTreeBranch, getTreeContinuePrefix } from "./utils";

export interface TreeListOptions<T> {
	items: T[];
	expanded?: boolean;
	maxCollapsed?: number;
	itemType?: string;
	renderItem: (item: T, context: TreeContext) => string | string[];
}

export function renderTreeList<T>(options: TreeListOptions<T>, theme: Theme): string[] {
	const { items, expanded = false, maxCollapsed = 8, itemType = "item", renderItem } = options;
	const lines: string[] = [];
	const maxItems = expanded ? items.length : Math.min(items.length, maxCollapsed);

	for (let i = 0; i < maxItems; i++) {
		const isLast = i === maxItems - 1 && (expanded || items.length <= maxCollapsed);
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
			lines.push(`${prefix}${rendered[0]}`);
			for (let j = 1; j < rendered.length; j++) {
				lines.push(`${continuePrefix}${rendered[j]}`);
			}
		} else {
			lines.push(`${prefix}${rendered}`);
		}
	}

	if (!expanded && items.length > maxItems) {
		const remaining = items.length - maxItems;
		lines.push(
			`${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", formatMoreItems(remaining, itemType, theme))}`,
		);
	}

	return lines;
}
