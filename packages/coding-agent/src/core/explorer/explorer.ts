import { spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { tokenizeForRelevance } from "../context-budget-relevance.ts";
import {
	DEFAULT_EXPLORER_BUDGET,
	type ExploreOptions,
	type ExplorerBudget,
	type ExplorerFile,
	type ExplorerRange,
	type ExplorerResult,
} from "./explorer-types.ts";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "vendor", "coverage", ".omk"]);
const EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".md",
	".json",
	".rs",
	".go",
	".java",
	".css",
	".html",
	".yml",
	".yaml",
	".toml",
	".sh",
	".txt",
]);
const MAX_TERMS = 8;
const RANGES_PER_FILE = 2;

interface ScannedFile {
	readonly absolute: string;
	readonly path: string;
	readonly lines: readonly string[];
	readonly matchedTerms: readonly string[];
	readonly matchLines: readonly number[];
	readonly score: number;
}

/** ripgrep covers the whole workspace fast and honors .gitignore; the Node walk is the fallback. */
let rgSupported: boolean | undefined;

function rgAvailable(): boolean {
	if (rgSupported === undefined) rgSupported = spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
	return rgSupported;
}

function rgMatchedFiles(root: string, term: string): readonly string[] {
	const result = spawnSync(
		"rg",
		[
			"--files-with-matches",
			"--fixed-strings",
			"--ignore-case",
			"--no-messages",
			"--glob",
			"!**/node_modules/**",
			"--glob",
			"!**/dist/**",
			"--glob",
			"!**/vendor/**",
			"--glob",
			"!**/coverage/**",
			"--glob",
			"!**/.omk/**",
			"--",
			term,
			root,
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	if (result.status !== 0 && result.status !== 1) return [];
	return result.stdout
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => resolve(root, line));
}

function listCandidates(root: string, budget: ExplorerBudget): { files: string[]; capped: boolean } {
	const files: string[] = [];
	const queue = [root];
	let capped = false;
	while (queue.length > 0 && files.length < budget.maxFilesScanned) {
		const dir = queue.shift() as string;
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (files.length >= budget.maxFilesScanned) {
				capped = true;
				break;
			}
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) queue.push(path);
			} else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
				files.push(path);
			}
		}
	}
	if (queue.length > 0) capped = true;
	return { files: files.sort(), capped };
}

function readPrefix(path: string, maxBytes: number): string {
	const fd = openSync(path, "r");
	try {
		const size = Math.min(maxBytes, statSync(path).size);
		const buffer = Buffer.alloc(size);
		const read = readSync(fd, buffer, 0, size, 0);
		return buffer.subarray(0, read).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

function scanFile(
	absolute: string,
	root: string,
	terms: readonly string[],
	budget: ExplorerBudget,
): ScannedFile | undefined {
	const text = readPrefix(absolute, budget.maxBytesPerFile);
	if (text.includes("\u0000")) return undefined;
	const path = relative(root, absolute).split(sep).join("/");
	const lines = text.split("\n");
	const lowerPath = path.toLowerCase();
	const matchedTerms: string[] = [];
	const matchLines: number[] = [];
	let matches = 0;
	for (const term of terms) {
		let termMatches = 0;
		for (let index = 0; index < lines.length; index += 1) {
			if (lines[index].toLowerCase().includes(term)) {
				if (termMatches === 0) matchLines.push(index + 1);
				termMatches += 1;
			}
		}
		if (termMatches > 0) {
			matchedTerms.push(term);
			matches += termMatches;
		}
	}
	if (matchedTerms.length === 0) return undefined;
	const pathBonus = terms.some((term) => lowerPath.includes(term)) ? 5 : 0;
	// A definition in source outranks the same term in docs or a test reference.
	const docPenalty = extname(absolute) === ".md" ? 2 : 0;
	const testPenalty = /\.(?:test|spec)\.[^.]+$/.test(path) ? 1 : 0;
	const score = matchedTerms.length * 10 + pathBonus + Math.min(matches, 20) * 0.1 - docPenalty - testPenalty;
	return { absolute, path, lines, matchedTerms, matchLines, score };
}

function rangesFor(file: ScannedFile, budget: ExplorerBudget): ExplorerRange[] {
	const reason = `matched: ${file.matchedTerms.join(", ")}`;
	const ranges: ExplorerRange[] = [];
	for (const line of file.matchLines) {
		if (ranges.length >= RANGES_PER_FILE) break;
		const start = Math.max(1, line - budget.contextLines);
		const end = Math.min(file.lines.length, line + budget.contextLines, start + budget.maxRangeLines - 1);
		const last = ranges.at(-1);
		if (last && start <= last.end + 1) continue;
		ranges.push({ start, end, reason });
	}
	return ranges;
}

/** Search a workspace read-only and return ranked paths with line ranges, never whole files. */
export async function exploreCodebase(options: ExploreOptions): Promise<ExplorerResult> {
	const budget = { ...DEFAULT_EXPLORER_BUDGET, ...options.budget };
	const root = resolve(options.cwd);
	const terms = [...new Set(tokenizeForRelevance(options.question).filter((term) => term.length >= 2))]
		.slice(0, MAX_TERMS)
		.map((term) => term.toLowerCase());
	const empty = {
		question: options.question,
		files: [],
		coverage: { searched: terms, visited: [], notVisited: [] },
		negative: [],
		budget: { filesScanned: 0, bytesRead: 0, truncated: false },
	} satisfies ExplorerResult;
	if (terms.length === 0) return empty;

	const candidates: string[] = [];
	let capped = false;
	let searchCapped = false;
	if (rgAvailable()) {
		const seen = new Set<string>();
		for (const term of terms) for (const file of rgMatchedFiles(root, term)) seen.add(file);
		candidates.push(...[...seen].sort());
	} else {
		const walked = listCandidates(root, budget);
		candidates.push(...walked.files);
		capped = walked.capped;
	}
	const readCandidates = candidates.slice(0, budget.maxFilesScanned);
	if (candidates.length > readCandidates.length) searchCapped = true;
	const scanned: ScannedFile[] = [];
	const visited: string[] = [];
	let bytesRead = 0;
	for (const absolute of readCandidates) {
		const relativePath = relative(root, absolute);
		if (relativePath.startsWith("..")) continue;
		const before = statSync(absolute).size;
		const file = scanFile(absolute, root, terms, budget);
		bytesRead += Math.min(before, budget.maxBytesPerFile);
		visited.push(relativePath.split(sep).join("/"));
		if (file) scanned.push(file);
	}
	scanned.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

	const matchedAll = new Set(scanned.flatMap((file) => file.matchedTerms));
	const negative = terms.filter((term) => !matchedAll.has(term));
	const notVisited: string[] = [];
	if (capped) notVisited.push(`scan stopped after ${budget.maxFilesScanned} files`);
	if (searchCapped) notVisited.push(`${candidates.length - readCandidates.length} more matching files not read`);
	const files: ExplorerFile[] = [];
	let rangeCount = 0;
	for (const file of scanned) {
		if (files.length >= budget.maxFilesReturned) {
			notVisited.push(file.path);
			continue;
		}
		const ranges = rangesFor(file, budget);
		const kept = ranges.slice(0, Math.max(0, budget.maxRangesTotal - rangeCount));
		if (kept.length < ranges.length) notVisited.push(`${file.path}: more matching lines`);
		if (kept.length > 0) files.push({ path: file.path, ranges: kept, score: file.score });
		rangeCount += kept.length;
	}
	return {
		question: options.question,
		files,
		coverage: { searched: terms, visited, notVisited },
		negative,
		budget: { filesScanned: readCandidates.length, bytesRead, truncated: notVisited.length > 0 },
	};
}
