import {
	type RepoFileEntry,
	type RepoFilePreview,
	type RepoFileSearchTruncationReason,
	searchRepoFilesWithMeta,
} from "../../../core/repo-files-fs.ts";

export type FilesSidebarMode = "open" | "collapsed" | "hidden";

export interface VisibleTreeRow {
	readonly entry: RepoFileEntry;
	readonly depth: number;
	readonly expanded: boolean;
	readonly selected: boolean;
	readonly isSearchHit?: boolean;
}

export interface PreviewDrawerLayout {
	readonly drawerHeight: number;
	readonly drawerTop: number;
	readonly bodyRows: number;
}

export interface FilesTruncationStatus {
	readonly truncated: boolean;
	readonly label: string;
	readonly canExpand: boolean;
	readonly mode?: "search" | "dir";
	readonly cap?: number;
}

export const FILES_SIDEBAR_MIN_COLS = 108;
export const FILES_SIDEBAR_MIN_ROWS = 16;
export const FILES_SIDEBAR_DEFAULT_WIDTH = 28;
export const FILES_SIDEBAR_MIN_WIDTH = 20;
export const FILES_SIDEBAR_MAX_WIDTH = 44;
export const FILES_SIDEBAR_RAIL_WIDTH = 3;

export const DIR_ENTRY_LIMIT_STEPS = [300, 1000, 2000] as const;
export const SEARCH_SCAN_LIMIT_STEPS = [1500, 5000, 20_000] as const;

export function nextLimitStep(current: number, steps: readonly number[]): number | null {
	for (const step of steps) {
		if (step > current) return step;
	}
	return null;
}

/** Shared preview drawer geometry so renderer, keyboard, and mouse wheel use identical viewport height. */
export function computePreviewDrawerLayout(termHeight: number): PreviewDrawerLayout {
	const drawerHeight = Math.max(6, Math.min(16, Math.floor(termHeight * 0.42)));
	return {
		drawerHeight,
		drawerTop: termHeight - drawerHeight + 1,
		bodyRows: Math.max(3, drawerHeight - 2),
	};
}

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
	readonly scanned: number;
	readonly maxScanned: number;
	readonly truncated: boolean;
	readonly truncationReasons: readonly RepoFileSearchTruncationReason[];
}

export function buildSearchRows(
	rootDir: string,
	term: string,
	includeHidden: boolean,
	expandedDirs: ReadonlySet<string>,
	cache: SearchCache | null,
	maxScanned: number = SEARCH_SCAN_LIMIT_STEPS[0],
): { rows: Omit<VisibleTreeRow, "selected">[]; cache: SearchCache } {
	const key = `${rootDir}|${includeHidden ? 1 : 0}|${maxScanned}|${term.toLowerCase()}`;
	const nextCache: SearchCache =
		cache && cache.key === key
			? cache
			: (() => {
					const res = searchRepoFilesWithMeta(rootDir, term, { includeHidden, maxScanned });
					return {
						key,
						entries: res.entries,
						scanned: res.scanned,
						maxScanned: res.maxScanned,
						truncated: res.truncated,
						truncationReasons: res.truncationReasons,
					};
				})();
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

export function resolveFilesTruncationStatus(
	filter: string,
	searchCache: SearchCache | null,
	maxSearchScanned: number,
	expandedDirs: ReadonlySet<string>,
	dirTruncated: ReadonlyMap<string, { shown: number; total: number }>,
	maxDirEntries: number,
): FilesTruncationStatus {
	if (filter.trim()) {
		if (searchCache?.truncated) {
			const canExpand = nextLimitStep(maxSearchScanned, SEARCH_SCAN_LIMIT_STEPS) !== null;
			return {
				truncated: true,
				label: `Partial (${searchCache.maxScanned} cap${canExpand ? " · + more" : ""})`,
				canExpand,
				mode: "search",
				cap: searchCache.maxScanned,
			};
		}
		return { truncated: false, label: "", canExpand: false };
	}
	for (const dir of expandedDirs) {
		const info = dirTruncated.get(dir);
		if (info) {
			const canExpand = nextLimitStep(maxDirEntries, DIR_ENTRY_LIMIT_STEPS) !== null;
			return {
				truncated: true,
				label: `Partial (${info.shown}/${info.total}${canExpand ? " · + more" : ""})`,
				canExpand,
				mode: "dir",
				cap: maxDirEntries,
			};
		}
	}
	return { truncated: false, label: "", canExpand: false };
}

export function clampPreviewOffset(content: string, offset: number, viewportRows: number): number {
	const totalLines = content.split(/\r?\n/).length;
	const maxScroll = Math.max(0, totalLines - Math.max(1, viewportRows));
	return Math.max(0, Math.min(maxScroll, offset));
}

export function syncTreeScrollOffset(
	scrollOffset: number,
	selectedIndex: number,
	viewportRows: number,
	totalRows: number,
	followSelection: boolean,
): number {
	const cap = Math.max(1, viewportRows);
	let next = scrollOffset;
	if (followSelection) {
		if (selectedIndex < next) next = selectedIndex;
		else if (selectedIndex >= next + cap) next = selectedIndex - cap + 1;
	}
	return Math.max(0, Math.min(next, Math.max(0, totalRows - cap)));
}

export function expandPathAncestors(
	path: string,
	expandedDirs: Set<string>,
	loadDir: (relPath: string, force: boolean) => void,
): void {
	let acc = "";
	for (const part of path.split("/")) {
		acc = acc ? `${acc}/${part}` : part;
		expandedDirs.add(acc);
		loadDir(acc, false);
	}
}

export class FilesPreviewState {
	preview: RepoFilePreview | null = null;
	scrollOffset = 0;

	close(): void {
		this.preview = null;
		this.scrollOffset = 0;
	}

	open(readFile: () => RepoFilePreview): { preview: RepoFilePreview | null; error: string | null } {
		try {
			this.preview = readFile();
			this.scrollOffset = 0;
			return { preview: this.preview, error: null };
		} catch (error) {
			return { preview: null, error: error instanceof Error ? error.message : String(error) };
		}
	}

	scroll(delta: number, viewportRows: number): void {
		if (!this.preview) return;
		this.scrollOffset = clampPreviewOffset(this.preview.content, this.scrollOffset + delta, viewportRows);
	}

	clamp(viewportRows: number): number {
		if (!this.preview) return 0;
		this.scrollOffset = clampPreviewOffset(this.preview.content, this.scrollOffset, viewportRows);
		return this.scrollOffset;
	}
}
