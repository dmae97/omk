import { basename } from "node:path";
import { type RepoFileEntry, type RepoFilePreview, readSafeRepoFile } from "../../../core/repo-files-fs.ts";
import { FilesSidebarDirStore } from "./files-sidebar-store.ts";
import {
	expandPathAncestors,
	FILES_SIDEBAR_DEFAULT_WIDTH,
	FILES_SIDEBAR_MAX_WIDTH,
	FILES_SIDEBAR_MIN_WIDTH,
	FilesPreviewState,
	type FilesSidebarMode,
	type FilesTruncationStatus,
	syncTreeScrollOffset,
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
	private selectedIndex = 0;
	private scrollOffset = 0;
	private scrollFollowsSelection = true;
	private readonly store = new FilesSidebarDirStore();
	private readonly previewState = new FilesPreviewState();
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
	getPreview = (): RepoFilePreview | null => this.previewState.preview;
	getPreviewScrollOffset = (): number => this.previewState.scrollOffset;
	getScrollOffset = (): number => this.scrollOffset;
	getErrorMessage = (): string | null => this.errorMessage;
	closePreview = (): void => this.previewState.close();

	setMode(mode: FilesSidebarMode): void {
		this.mode = mode;
		if (mode !== "open") this.filtering = false;
	}

	toggleMode(): FilesSidebarMode {
		this.mode = this.mode === "open" ? "collapsed" : "open";
		if (this.mode !== "open") this.filtering = false;
		else if (!this.store.dirCache.has("")) this.loadDir("", false);
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
		this.store.resetSearch();
		this.resetCursor();
	}

	startSearch(query: string): void {
		this.setFilter(query);
		this.filtering = true;
	}

	setRootDir(nextRoot: string): void {
		if (nextRoot === this.rootDir) return;
		this.rootDir = nextRoot;
		this.rootName = basename(nextRoot) || nextRoot;
		this.store.resetLimits();
		this.closePreview();
		this.collapseAll();
	}

	loadDir(relPath: string, force = false): readonly RepoFileEntry[] {
		const res = this.store.loadDir(this.rootDir, relPath, this.includeHidden, force, (name) => {
			this.rootName = name;
		});
		this.errorMessage = res.error;
		return res.entries;
	}

	refresh(): void {
		this.store.dirCache.clear();
		this.store.dirTruncated.clear();
		this.store.searchCache = null;
		for (const dir of this.store.expandedDirs) this.loadDir(dir, true);
		this.clampSelection();
	}

	collapseAll(): void {
		this.store.expandedDirs.clear();
		this.store.expandedDirs.add("");
		this.filter = "";
		this.filtering = false;
		this.store.searchCache = null;
		this.resetCursor();
		if (!this.store.dirCache.has("")) this.loadDir("", false);
	}

	getTruncationStatus(): FilesTruncationStatus {
		return this.store.getTruncationStatus(this.rootDir, this.filter, this.includeHidden);
	}

	expandExplorationLimit(): boolean {
		return this.store.expandLimit(this.rootDir, this.filter, this.includeHidden, (name) => {
			this.rootName = name;
		});
	}

	getVisibleRows(): VisibleTreeRow[] {
		const rawRows = this.store.buildRawRows(this.rootDir, this.filter, this.includeHidden);
		if (rawRows.length === 0) {
			this.selectedIndex = 0;
			return [];
		}
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, rawRows.length - 1));
		return rawRows.map((row, idx) => ({ ...row, selected: idx === this.selectedIndex }));
	}

	getSelectedEntry = (): RepoFileEntry | null => this.getVisibleRows()[this.selectedIndex]?.entry ?? null;

	selectVisibleIndex(index: number, viewportRows = 20): RepoFileEntry | null {
		const rows = this.getVisibleRows();
		if (index < 0 || index >= rows.length) return null;
		this.selectedIndex = index;
		this.scrollFollowsSelection = true;
		this.syncScroll(viewportRows, rows.length);
		return rows[index]?.entry ?? null;
	}

	moveSelection(delta: number, viewportRows = 20): void {
		const rows = this.getVisibleRows();
		if (rows.length === 0) return;
		this.selectedIndex = Math.max(0, Math.min(rows.length - 1, this.selectedIndex + delta));
		this.scrollFollowsSelection = true;
		this.syncScroll(viewportRows, rows.length);
	}

	scrollTree(delta: number, viewportRows = 20): void {
		this.scrollFollowsSelection = false;
		this.scrollOffset = syncTreeScrollOffset(
			this.scrollOffset + delta,
			this.selectedIndex,
			viewportRows,
			this.getVisibleRows().length,
			false,
		);
	}

	syncScroll(viewportRows: number, totalRows: number): void {
		this.scrollOffset = syncTreeScrollOffset(this.scrollOffset, this.selectedIndex, viewportRows, totalRows, true);
	}

	syncScrollForRender(viewportRows: number, totalRows: number): void {
		this.scrollOffset = syncTreeScrollOffset(
			this.scrollOffset,
			this.selectedIndex,
			viewportRows,
			totalRows,
			this.scrollFollowsSelection,
		);
	}

	activateSelected(): { action: "toggled-dir" | "opened-preview" | "none"; path?: string } {
		const entry = this.getSelectedEntry();
		if (!entry) return { action: "none" };
		this.scrollFollowsSelection = true;
		if (entry.kind === "dir") {
			if (this.filter.trim()) {
				this.setFilter("");
				this.filtering = false;
				expandPathAncestors(entry.path, this.store.expandedDirs, (p, f) => this.loadDir(p, f));
				const idx = this.getVisibleRows().findIndex((r) => r.entry.path === entry.path);
				if (idx >= 0) this.selectedIndex = idx;
				return { action: "toggled-dir", path: entry.path };
			}
			if (this.store.expandedDirs.has(entry.path)) this.store.expandedDirs.delete(entry.path);
			else {
				this.store.expandedDirs.add(entry.path);
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
		this.scrollFollowsSelection = true;
		if (entry.kind === "dir" && this.store.expandedDirs.has(entry.path)) {
			this.store.expandedDirs.delete(entry.path);
			this.clampSelection();
			return;
		}
		const slash = entry.path.lastIndexOf("/");
		if (slash <= 0) return;
		const parentIdx = this.getVisibleRows().findIndex((r) => r.entry.path === entry.path.slice(0, slash));
		if (parentIdx >= 0) this.selectedIndex = parentIdx;
	}

	openPreview(relPath: string): RepoFilePreview | null {
		const res = this.previewState.open(() => readSafeRepoFile(this.rootDir, relPath));
		this.errorMessage = res.error;
		return res.preview;
	}

	scrollPreview = (delta: number, viewportRows: number): void => this.previewState.scroll(delta, viewportRows);
	clampPreviewScroll = (viewportRows: number): number => this.previewState.clamp(viewportRows);

	private resetCursor(): void {
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.scrollFollowsSelection = true;
	}

	private clampSelection(): void {
		const rows = this.getVisibleRows();
		this.selectedIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex, rows.length - 1));
	}
}
