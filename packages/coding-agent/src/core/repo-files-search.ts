import { type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
export type RepoFileKind = "dir" | "file";

export interface RepoFileEntry {
	readonly name: string;
	readonly path: string;
	readonly kind: RepoFileKind;
	readonly size: number;
}

export interface SearchRepoFilesOptions {
	readonly includeHidden?: boolean;
	readonly maxResults?: number;
	readonly maxDepth?: number;
	readonly maxScanned?: number;
}

const ALWAYS_SKIP_DIRS = new Set([".git"]);
const DEFAULT_IGNORE_NAMES = new Set([
	"node_modules",
	"dist",
	"build",
	".worktrees",
	".next",
	".turbo",
	"__pycache__",
	".venv",
	"target",
]);

export type RepoFileSearchTruncationReason = "scan_limit" | "result_limit" | "depth_limit";

export interface RepoFileSearchResult {
	readonly entries: readonly RepoFileEntry[];
	readonly scanned: number;
	readonly maxScanned: number;
	readonly maxResults: number;
	readonly maxDepth: number;
	readonly truncated: boolean;
	readonly truncationReasons: readonly RepoFileSearchTruncationReason[];
}

export function searchRepoFilesWithMeta(
	rootDir: string,
	query: string,
	options: SearchRepoFilesOptions = {},
): RepoFileSearchResult {
	const term = query.trim().toLowerCase();
	const maxResults = Math.min(500, Math.max(10, Number(options.maxResults) || 80));
	const maxDepth = Math.min(12, Math.max(1, Number(options.maxDepth) || 6));
	const maxScanned = Math.min(20_000, Math.max(100, Number(options.maxScanned) || 1500));
	if (!term) {
		return { entries: [], scanned: 0, maxScanned, maxResults, maxDepth, truncated: false, truncationReasons: [] };
	}
	const includeHidden = Boolean(options.includeHidden);
	const rootReal = realpathSync(resolve(rootDir));
	const matches: { entry: RepoFileEntry; score: number }[] = [];
	let scanned = 0;
	let hitScanLimit = false;
	let hitDepthLimit = false;

	const walk = (dir: string, depth: number): void => {
		if (depth > maxDepth) {
			hitDepthLimit = true;
			return;
		}
		if (scanned >= maxScanned) {
			hitScanLimit = true;
			return;
		}
		let dirents: Dirent[];
		try {
			dirents = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const dirent of dirents) {
			const name = dirent.name;
			if (ALWAYS_SKIP_DIRS.has(name)) continue;
			if (!includeHidden && (name.startsWith(".") || DEFAULT_IGNORE_NAMES.has(name))) continue;
			if (dirent.isSymbolicLink()) continue;
			if (scanned >= maxScanned) {
				hitScanLimit = true;
				return;
			}
			scanned += 1;
			const full = join(dir, name);
			const isDir = dirent.isDirectory();
			const rel = relative(rootReal, full).split(sep).join("/");
			const lowerName = name.toLowerCase();
			const lowerRel = rel.toLowerCase();
			if (lowerRel.includes(term)) {
				let size = 0;
				if (!isDir) {
					try {
						size = statSync(full).size;
					} catch {
						continue;
					}
				}
				const score = lowerName === term ? 0 : lowerName.startsWith(term) ? 1 : lowerName.includes(term) ? 2 : 3;
				matches.push({ entry: { name, path: rel, kind: isDir ? "dir" : "file", size }, score });
			}
			if (isDir) walk(full, depth + 1);
		}
	};

	walk(rootReal, 0);
	matches.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		if (a.entry.kind !== b.entry.kind) return a.entry.kind === "file" ? -1 : 1;
		return a.entry.path.localeCompare(b.entry.path, undefined, { sensitivity: "base" });
	});
	const hitResultLimit = matches.length > maxResults;
	const truncationReasons: RepoFileSearchTruncationReason[] = [];
	if (hitScanLimit) truncationReasons.push("scan_limit");
	if (hitResultLimit) truncationReasons.push("result_limit");
	if (hitDepthLimit) truncationReasons.push("depth_limit");
	return {
		entries: matches.slice(0, maxResults).map((m) => m.entry),
		scanned,
		maxScanned,
		maxResults,
		maxDepth,
		truncated: truncationReasons.length > 0,
		truncationReasons,
	};
}

export function searchRepoFiles(
	rootDir: string,
	query: string,
	options: SearchRepoFilesOptions = {},
): readonly RepoFileEntry[] {
	return searchRepoFilesWithMeta(rootDir, query, options).entries;
}
