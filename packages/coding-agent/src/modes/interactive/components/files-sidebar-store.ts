import { listRepoDirectory, type RepoFileEntry } from "../../../core/repo-files-fs.ts";
import {
	buildDirectoryTreeRows,
	buildSearchRows,
	DIR_ENTRY_LIMIT_STEPS,
	type FilesTruncationStatus,
	nextLimitStep,
	resolveFilesTruncationStatus,
	SEARCH_SCAN_LIMIT_STEPS,
	type SearchCache,
	type VisibleTreeRow,
} from "./files-sidebar-tree.ts";

/** Owns directory listings, search cache, and bounded exploration limits for FilesSidebarModel. */
export class FilesSidebarDirStore {
	readonly expandedDirs = new Set<string>([""]);
	readonly dirCache = new Map<string, readonly RepoFileEntry[]>();
	readonly dirTruncated = new Map<string, { shown: number; total: number }>();
	maxDirEntries: number = DIR_ENTRY_LIMIT_STEPS[0];
	maxSearchScanned: number = SEARCH_SCAN_LIMIT_STEPS[0];
	searchCache: SearchCache | null = null;

	resetLimits(): void {
		this.dirCache.clear();
		this.dirTruncated.clear();
		this.maxDirEntries = DIR_ENTRY_LIMIT_STEPS[0];
		this.maxSearchScanned = SEARCH_SCAN_LIMIT_STEPS[0];
		this.searchCache = null;
	}

	resetSearch(): void {
		this.searchCache = null;
		this.maxSearchScanned = SEARCH_SCAN_LIMIT_STEPS[0];
	}

	loadDir(
		rootDir: string,
		relPath: string,
		includeHidden: boolean,
		force: boolean,
		onRootName: (name: string) => void,
	): { entries: readonly RepoFileEntry[]; error: string | null } {
		if (!force && this.dirCache.has(relPath)) return { entries: this.dirCache.get(relPath) ?? [], error: null };
		try {
			const listing = listRepoDirectory(rootDir, relPath, { includeHidden, maxEntries: this.maxDirEntries });
			if (relPath === "") onRootName(listing.rootName);
			this.dirCache.set(relPath, listing.entries);
			if (listing.truncated)
				this.dirTruncated.set(relPath, { shown: listing.entries.length, total: listing.totalEntries });
			else this.dirTruncated.delete(relPath);
			return { entries: listing.entries, error: null };
		} catch (error) {
			return { entries: [], error: error instanceof Error ? error.message : String(error) };
		}
	}

	buildRawRows(rootDir: string, filter: string, includeHidden: boolean): Omit<VisibleTreeRow, "selected">[] {
		const term = filter.trim();
		if (!term) return buildDirectoryTreeRows(this.dirCache, this.expandedDirs);
		const res = buildSearchRows(
			rootDir,
			term,
			includeHidden,
			this.expandedDirs,
			this.searchCache,
			this.maxSearchScanned,
		);
		this.searchCache = res.cache;
		return res.rows;
	}

	getTruncationStatus(rootDir: string, filter: string, includeHidden: boolean): FilesTruncationStatus {
		if (filter.trim() && !this.searchCache) this.buildRawRows(rootDir, filter, includeHidden);
		return resolveFilesTruncationStatus(
			filter,
			this.searchCache,
			this.maxSearchScanned,
			this.expandedDirs,
			this.dirTruncated,
			this.maxDirEntries,
		);
	}

	expandLimit(rootDir: string, filter: string, includeHidden: boolean, onRootName: (name: string) => void): boolean {
		if (filter.trim()) {
			const next = nextLimitStep(this.maxSearchScanned, SEARCH_SCAN_LIMIT_STEPS);
			if (next === null) return false;
			this.maxSearchScanned = next;
			this.searchCache = null;
			return true;
		}
		const next = nextLimitStep(this.maxDirEntries, DIR_ENTRY_LIMIT_STEPS);
		if (next === null) return false;
		this.maxDirEntries = next;
		for (const dir of this.expandedDirs) {
			if (this.dirTruncated.has(dir)) this.loadDir(rootDir, dir, includeHidden, true, onRootName);
		}
		return true;
	}
}
