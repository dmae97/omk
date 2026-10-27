/** Read-only codebase exploration: an evidence pack of paths and line ranges, never whole files. */

export interface ExplorerBudget {
	/** Files opened at most. */
	readonly maxFilesScanned: number;
	/** Bytes read per file at most. */
	readonly maxBytesPerFile: number;
	/** Files returned at most. */
	readonly maxFilesReturned: number;
	/** Ranges returned across all files at most. */
	readonly maxRangesTotal: number;
	/** Lines in one returned range at most. */
	readonly maxRangeLines: number;
	/** Context lines kept on each side of a match. */
	readonly contextLines: number;
}

export const DEFAULT_EXPLORER_BUDGET: ExplorerBudget = {
	maxFilesScanned: 400,
	maxBytesPerFile: 65_536,
	maxFilesReturned: 6,
	maxRangesTotal: 12,
	maxRangeLines: 40,
	contextLines: 3,
};

export interface ExplorerRange {
	readonly start: number;
	readonly end: number;
	readonly reason: string;
}

export interface ExplorerFile {
	readonly path: string;
	readonly ranges: readonly ExplorerRange[];
	readonly score: number;
}

export interface ExplorerCoverage {
	/** Query terms actually searched for. */
	readonly searched: readonly string[];
	/** Workspace-relative files that were opened. */
	readonly visited: readonly string[];
	/** Work left out because a budget cap was reached. */
	readonly notVisited: readonly string[];
}

export interface ExplorerResult {
	readonly question: string;
	readonly files: readonly ExplorerFile[];
	readonly coverage: ExplorerCoverage;
	/** Query terms with no match anywhere in the scanned files. */
	readonly negative: readonly string[];
	readonly budget: {
		readonly filesScanned: number;
		readonly bytesRead: number;
		readonly truncated: boolean;
	};
}

export interface ExploreOptions {
	readonly cwd: string;
	readonly question: string;
	readonly budget?: Partial<ExplorerBudget>;
}
