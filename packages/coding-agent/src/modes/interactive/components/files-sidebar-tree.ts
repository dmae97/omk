import { type RepoFileEntry, searchRepoFiles } from "../../../core/repo-files-fs.ts";

export type FilesSidebarMode = "open" | "collapsed" | "hidden";

export interface VisibleTreeRow {
	readonly entry: RepoFileEntry;
	readonly depth: number;
	readonly expanded: boolean;
	readonly selected: boolean;
	readonly isSearchHit?: boolean;
}

export const FILES_SIDEBAR_MIN_COLS = 108;
export const FILES_SIDEBAR_MIN_ROWS = 16;
export const FILES_SIDEBAR_DEFAULT_WIDTH = 28;
export const FILES_SIDEBAR_MIN_WIDTH = 20;
export const FILES_SIDEBAR_MAX_WIDTH = 44;
export const FILES_SIDEBAR_RAIL_WIDTH = 3;

export function filesSidebarGutterWidth(
	mode: FilesSidebarMode,
	sidebarWidth: number,
	termWidth: number,
	termHeight: number,
): number {
	if (mode === "hidden" || termWidth < FILES_SIDEBAR_MIN_COLS || termHeight < FILES_SIDEBAR_MIN_ROWS) return 0;
	if (mode === "collapsed") return FILES_SIDEBAR_RAIL_WIDTH;
	return Math.min(sidebarWidth, Math.max(FILES_SIDEBAR_MIN_WIDTH, Math.floor(termWidth * 0.28)));
}

export interface SearchCache {
	readonly key: string;
	readonly entries: readonly RepoFileEntry[];
}

export function buildSearchRows(
	rootDir: string,
	term: string,
	includeHidden: boolean,
	expandedDirs: ReadonlySet<string>,
	cache: SearchCache | null,
): { rows: Omit<VisibleTreeRow, "selected">[]; cache: SearchCache } {
	const key = `${rootDir}|${includeHidden ? 1 : 0}|${term.toLowerCase()}`;
	const nextCache =
		cache && cache.key === key ? cache : { key, entries: searchRepoFiles(rootDir, term, { includeHidden }) };
	const rows = nextCache.entries.map((entry) => ({
		entry,
		depth: 0,
		expanded: entry.kind === "dir" && expandedDirs.has(entry.path),
		isSearchHit: true,
	}));
	return { rows, cache: nextCache };
}

export function buildDirectoryTreeRows(
	dirCache: ReadonlyMap<string, readonly RepoFileEntry[]>,
	expandedDirs: ReadonlySet<string>,
): Omit<VisibleTreeRow, "selected">[] {
	const rows: Omit<VisibleTreeRow, "selected">[] = [];
	const visit = (relPath: string, depth: number): void => {
		for (const entry of dirCache.get(relPath) ?? []) {
			const expanded = entry.kind === "dir" && expandedDirs.has(entry.path);
			rows.push({ entry, depth, expanded });
			if (expanded) visit(entry.path, depth + 1);
		}
	};
	visit("", 0);
	return rows;
}
