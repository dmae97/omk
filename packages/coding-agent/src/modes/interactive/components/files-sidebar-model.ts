import { basename } from "node:path";
import {
	listRepoDirectory,
	type RepoFileEntry,
	type RepoFilePreview,
	readSafeRepoFile,
} from "../../../core/repo-files-fs.ts";
import {
	buildDirectoryTreeRows,
	buildSearchRows,
	FILES_SIDEBAR_DEFAULT_WIDTH,
	FILES_SIDEBAR_MAX_WIDTH,
	FILES_SIDEBAR_MIN_WIDTH,
	type FilesSidebarMode,
	type SearchCache,
	type VisibleTreeRow,
} from "./files-sidebar-tree.ts";

export * from "./files-sidebar-tree.ts";

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
	private searchCache: SearchCache | null = null;
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
	getWidth = (): number => this.sidebarWidth;
	getIncludeHidden = (): boolean => this.includeHidden;
	getFilter = (): string => this.filter;
	isFiltering = (): boolean => this.filtering;
	setFiltering = (active: boolean): void => {
		this.filtering = active;
	};
	getPreview = (): RepoFilePreview | null => this.preview;
	getPreviewScrollOffset = (): number => this.previewScrollOffset;
	getScrollOffset = (): number => this.scrollOffset;
	getErrorMessage = (): string | null => this.errorMessage;
	closePreview = (): void => {
		this.preview = null;
		this.previewScrollOffset = 0;
	};

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

	adjustWidth(delta: number): number {
		this.sidebarWidth = Math.max(
			FILES_SIDEBAR_MIN_WIDTH,
			Math.min(FILES_SIDEBAR_MAX_WIDTH, this.sidebarWidth + delta),
		);
		return this.sidebarWidth;
	}

	toggleHidden(): boolean {
		this.includeHidden = !this.includeHidden;
		this.refresh();
		return this.includeHidden;
	}

	setFilter(next: string): void {
		this.filter = next;
		this.searchCache = null;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
	}

	startSearch(query: string): void {
		this.setFilter(query);
		this.filtering = true;
	}

	setRootDir(nextRoot: string): void {
		if (nextRoot === this.rootDir) return;
		this.rootDir = nextRoot;
		this.rootName = basename(nextRoot) || nextRoot;
		this.expandedDirs = new Set([""]);
		this.dirCache.clear();
		this.searchCache = null;
		this.filter = "";
		this.filtering = false;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.closePreview();
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
		this.searchCache = null;
		for (const dir of this.expandedDirs) this.loadDir(dir, true);
		this.clampSelection();
	}

	collapseAll(): void {
		this.expandedDirs = new Set([""]);
		this.filter = "";
		this.filtering = false;
		this.searchCache = null;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		if (!this.dirCache.has("")) this.loadDir("", false);
	}

	getVisibleRows(): VisibleTreeRow[] {
		const term = this.filter.trim();
		let rawRows: Omit<VisibleTreeRow, "selected">[];
		if (term) {
			const res = buildSearchRows(this.rootDir, term, this.includeHidden, this.expandedDirs, this.searchCache);
			this.searchCache = res.cache;
			rawRows = res.rows;
		} else {
			rawRows = buildDirectoryTreeRows(this.dirCache, this.expandedDirs);
		}
		if (rawRows.length === 0) {
			this.selectedIndex = 0;
			return [];
		}
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, rawRows.length - 1));
		return rawRows.map((row, idx) => ({ ...row, selected: idx === this.selectedIndex }));
	}

	getSelectedEntry(): RepoFileEntry | null {
		return this.getVisibleRows()[this.selectedIndex]?.entry ?? null;
	}

	selectVisibleIndex(index: number, viewportRows = 20): RepoFileEntry | null {
		const rows = this.getVisibleRows();
		if (index < 0 || index >= rows.length) return null;
		this.selectedIndex = index;
		this.syncScroll(viewportRows, rows.length);
		return rows[index]?.entry ?? null;
	}

	moveSelection(delta: number, viewportRows = 20): void {
		const rows = this.getVisibleRows();
		if (rows.length === 0) return;
		this.selectedIndex = Math.max(0, Math.min(rows.length - 1, this.selectedIndex + delta));
		this.syncScroll(viewportRows, rows.length);
	}

	scrollTree(delta: number, viewportRows = 20): void {
		const maxScroll = Math.max(0, this.getVisibleRows().length - Math.max(1, viewportRows));
		this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollOffset + delta));
	}

	syncScroll(viewportRows: number, totalRows: number): void {
		const cap = Math.max(1, viewportRows);
		if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
		else if (this.selectedIndex >= this.scrollOffset + cap) this.scrollOffset = this.selectedIndex - cap + 1;
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, totalRows - cap)));
	}

	activateSelected(): { action: "toggled-dir" | "opened-preview" | "none"; path?: string } {
		const entry = this.getSelectedEntry();
		if (!entry) return { action: "none" };
		if (entry.kind === "dir") {
			if (this.filter.trim()) {
				this.setFilter("");
				this.filtering = false;
				let acc = "";
				for (const part of entry.path.split("/")) {
					acc = acc ? `${acc}/${part}` : part;
					this.expandedDirs.add(acc);
					this.loadDir(acc, false);
				}
				const idx = this.getVisibleRows().findIndex((r) => r.entry.path === entry.path);
				if (idx >= 0) this.selectedIndex = idx;
				return { action: "toggled-dir", path: entry.path };
			}
			if (this.expandedDirs.has(entry.path)) this.expandedDirs.delete(entry.path);
			else {
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
		const parentIdx = this.getVisibleRows().findIndex((r) => r.entry.path === parentPath);
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

	scrollPreview(delta: number, viewportRows = 12): void {
		if (!this.preview) return;
		const totalLines = this.preview.content.split(/\r?\n/).length;
		const maxScroll = Math.max(0, totalLines - Math.max(1, viewportRows));
		this.previewScrollOffset = Math.max(0, Math.min(maxScroll, this.previewScrollOffset + delta));
	}

	private clampSelection(): void {
		const rows = this.getVisibleRows();
		this.selectedIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex, rows.length - 1));
	}
}
