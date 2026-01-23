/**
 * Render file listings with optional icons and metadata.
 */

import type { Theme } from "$c/modes/theme/theme";
import { getLanguageFromPath } from "$c/modes/theme/theme";
import { renderTreeList } from "./tree-list";

export interface FileEntry {
	path: string;
	isDirectory?: boolean;
	meta?: string;
}

export interface FileListOptions {
	files: FileEntry[];
	expanded?: boolean;
	maxCollapsed?: number;
	showIcons?: boolean;
}

export function renderFileList(options: FileListOptions, theme: Theme): string[] {
	const { files, expanded = false, maxCollapsed = 8, showIcons = true } = options;

	return renderTreeList(
		{
			items: files,
			expanded,
			maxCollapsed,
			itemType: "file",
			renderItem: (entry) => {
				const isDirectory = entry.isDirectory ?? entry.path.endsWith("/");
				const displayPath = isDirectory && entry.path.endsWith("/") ? entry.path : entry.path;
				const lang = isDirectory ? undefined : getLanguageFromPath(displayPath);
				const icon = !showIcons
					? ""
					: isDirectory
						? theme.fg("accent", theme.icon.folder)
						: theme.fg("muted", theme.getLangIcon(lang));
				const labelColor = isDirectory ? "accent" : "toolOutput";
				const meta = entry.meta ? ` ${theme.fg("dim", entry.meta)}` : "";
				const iconPrefix = icon ? `${icon} ` : "";
				return `${iconPrefix}${theme.fg(labelColor, displayPath)}${meta}`;
			},
		},
		theme,
	);
}
