import { basename } from "node:path";
import {
	listRepoDirectory,
	type RepoFileEntry,
	type RepoFilePreview,
	readSafeRepoFile,
} from "../../../core/repo-files-fs.ts";

export type FilesSidebarMode = "open" | "collapsed" | "hidden";

export interface VisibleTreeRow {
	readonly entry: RepoFileEntry;
	readonly depth: number;
	readonly expanded: boolean;
	readonly selected: boolean;
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
	if (mode === "hidden" || termWidth < FILES_SIDEBAR_MIN_COLS || termHeight < FILES_SIDEBAR_MIN_ROWS) {
		return 0;
	}
	if (mode === "collapsed") return FILES_SIDEBAR_RAIL_WIDTH;
	return Math.min(sidebarWidth, Math.max(FILES_SIDEBAR_MIN_WIDTH, Math.floor(termWidth * 0.28)));
}

export class FilesSidebarModel {
	private rootDir: string;
	private rootName: string;
	private mode: FilesSidebarMode;
	private sidebarWidth: number;
	private includeHidden = false;
	private filter = "";
	private filtering = false;
	private expandedDirs = new Set<string>([""]);
	private dirCache = new Map<string, readonly RepoFileEntry[]>();
	private selectedIndex = 0;
	private scrollOffset = 0;
	private preview: RepoFilePreview | null = null;
	private previewScrollOffset = 0;
	private errorMessage: string | null = null;

	constructor(rootDir: string, initialMode: FilesSidebarMode = "open", width = FILES_SIDEBAR_DEFAULT_WIDTH) {
		this.rootDir = rootDir;
		this.rootName = basename(rootDir) || rootDir;
		this.mode = initialMode;
		this.sidebarWidth = Math.max(FILES_SIDEBAR_MIN_WIDTH, Math.min(FILES_SIDEBAR_MAX_WIDTH, width));
		this.loadDir("", false);
	}

	getRootDir = (): string => this.rootDir;

	getRootName = (): string => this.rootName;

	getMode = (): FilesSidebarMode => this.mode;

	setMode(mode: FilesSidebarMode): void {
		this.mode = mode;
		if (mode !== "open") this.filtering = false;
	}

	toggleMode(): FilesSidebarMode {
		this.mode = this.mode === "open" ? "collapsed" : "open";
		if (this.mode !== "open") this.filtering = false;
		else if (!this.dirCache.has("")) this.loadDir("", false);
		return this.mode;
	}

	getWidth = (): number => this.sidebarWidth;

	adjustWidth(delta: number): number {
		this.sidebarWidth = Math.max(
			FILES_SIDEBAR_MIN_WIDTH,
			Math.min(FILES_SIDEBAR_MAX_WIDTH, this.sidebarWidth + delta),
		);
		return this.sidebarWidth;
	}

	getIncludeHidden = (): boolean => this.includeHidden;

	toggleHidden(): boolean {
		this.includeHidden = !this.includeHidden;
		this.refresh();
		return this.includeHidden;
	}

	getFilter = (): string => this.filter;

	isFiltering = (): boolean => this.filtering;

	setFiltering = (active: boolean): void => {
		this.filtering = active;
	};

	setFilter(next: string): void {
		this.filter = next;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
	}

	getPreview = (): RepoFilePreview | null => this.preview;

	getPreviewScrollOffset = (): number => this.previewScrollOffset;

	getScrollOffset = (): number => this.scrollOffset;

	getErrorMessage = (): string | null => this.errorMessage;

	setRootDir(nextRoot: string): void {
		if (nextRoot === this.rootDir) return;
		this.rootDir = nextRoot;
		this.rootName = basename(nextRoot) || nextRoot;
		this.expandedDirs = new Set([""]);
		this.dirCache.clear();
		this.filter = "";
		this.filtering = false;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.preview = null;
		this.previewScrollOffset = 0;
		this.loadDir("", false);
	}

	loadDir(relPath: string, force = false): readonly RepoFileEntry[] {
		if (!force && this.dirCache.has(relPath)) return this.dirCache.get(relPath) ?? [];
		try {
			const listing = listRepoDirectory(this.rootDir, relPath, { includeHidden: this.includeHidden });
			if (relPath === "") this.rootName = listing.rootName;
			this.dirCache.set(relPath, listing.entries);
			this.errorMessage = null;
			return listing.entries;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return [];
		}
	}

	refresh(): void {
		this.dirCache.clear();
		for (const dir of this.expandedDirs) {
			this.loadDir(dir, true);
		}
		this.clampSelection();
	}

	collapseAll(): void {
		this.expandedDirs = new Set([""]);
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		if (!this.dirCache.has("")) this.loadDir("", false);
	}

	getVisibleRows(): VisibleTreeRow[] {
		const term = this.filter.trim().toLowerCase();
		const rows: Omit<VisibleTreeRow, "selected">[] = [];
		const visit = (relPath: string, depth: number): boolean => {
			const entries = this.dirCache.get(relPath) ?? [];
			let anyMatched = false;
			for (const entry of entries) {
				const expanded = entry.kind === "dir" && this.expandedDirs.has(entry.path);
				const matchSelf = !term || entry.path.toLowerCase().includes(term);
				const insertIdx = rows.length;
				if (entry.kind === "dir" && expanded) {
					rows.push({ entry, depth, expanded });
					const childMatched = visit(entry.path, depth + 1);
					if (!matchSelf && !childMatched) {
						rows.splice(insertIdx);
					} else {
						anyMatched = true;
					}
				} else if (matchSelf) {
					rows.push({ entry, depth, expanded });
					anyMatched = true;
				}
			}
			return anyMatched;
		};
		visit("", 0);
		if (rows.length === 0) {
			this.selectedIndex = 0;
			return [];
		}
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, rows.length - 1));
		return rows.map((row, idx) => ({ ...row, selected: idx === this.selectedIndex }));
	}

	getSelectedEntry(): RepoFileEntry | null {
		const rows = this.getVisibleRows();
		return rows[this.selectedIndex]?.entry ?? null;
	}

	moveSelection(delta: number, viewportRows = 20): void {
		const rows = this.getVisibleRows();
		if (rows.length === 0) return;
		this.selectedIndex = Math.max(0, Math.min(rows.length - 1, this.selectedIndex + delta));
		this.syncScroll(viewportRows, rows.length);
	}

	syncScroll(viewportRows: number, totalRows: number): void {
		const cap = Math.max(1, viewportRows);
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + cap) {
			this.scrollOffset = this.selectedIndex - cap + 1;
		}
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, totalRows - cap)));
	}

	activateSelected(): { action: "toggled-dir" | "opened-preview" | "none"; path?: string } {
		const entry = this.getSelectedEntry();
		if (!entry) return { action: "none" };
		if (entry.kind === "dir") {
			if (this.expandedDirs.has(entry.path)) {
				this.expandedDirs.delete(entry.path);
			} else {
				this.expandedDirs.add(entry.path);
				this.loadDir(entry.path, false);
			}
			this.clampSelection();
			return { action: "toggled-dir", path: entry.path };
		}
		this.openPreview(entry.path);
		return { action: "opened-preview", path: entry.path };
	}

	collapseSelectedOrParent(): void {
		const entry = this.getSelectedEntry();
		if (!entry) return;
		if (entry.kind === "dir" && this.expandedDirs.has(entry.path)) {
			this.expandedDirs.delete(entry.path);
			this.clampSelection();
			return;
		}
		const slash = entry.path.lastIndexOf("/");
		if (slash <= 0) return;
		const parentPath = entry.path.slice(0, slash);
		const rows = this.getVisibleRows();
		const parentIdx = rows.findIndex((r) => r.entry.path === parentPath);
		if (parentIdx >= 0) this.selectedIndex = parentIdx;
	}

	openPreview(relPath: string): RepoFilePreview | null {
		try {
			this.preview = readSafeRepoFile(this.rootDir, relPath);
			this.previewScrollOffset = 0;
			this.errorMessage = null;
			return this.preview;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return null;
		}
	}

	closePreview(): void {
		this.preview = null;
		this.previewScrollOffset = 0;
	}

	scrollPreview(delta: number, viewportRows = 12): void {
		if (!this.preview) return;
		const totalLines = this.preview.content.split("\n").length;
		const maxScroll = Math.max(0, totalLines - Math.max(1, viewportRows));
		this.previewScrollOffset = Math.max(0, Math.min(maxScroll, this.previewScrollOffset + delta));
	}

	private clampSelection(): void {
		const rows = this.getVisibleRows();
		this.selectedIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex, rows.length - 1));
	}
}
