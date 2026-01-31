/**
 * Native ripgrep wrapper using wasm-bindgen.
 *
 * JS handles filesystem operations (directory walking, file reading).
 * WASM handles pure regex matching using ripgrep's engine.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { globPaths } from "@oh-my-pi/pi-utils";
import {
	CompiledPattern as WasmCompiledPattern,
	has_match as wasmHasMatch,
	search as wasmSearch,
} from "../../wasm/pi_natives";
import { WorkerPool } from "../pool";
import { resolveWorkerSpecifier } from "../worker-resolver";
import { FileReader } from "./file-reader";
import { buildGlobPattern, matchesTypeFilter, resolveTypeFilter } from "./filters";
import type {
	ContextLine,
	GrepMatch,
	GrepOptions,
	GrepResult,
	GrepSummary,
	WasmSearchResult,
	WorkerRequest,
	WorkerResponse,
} from "./types";

export type { ContextLine, GrepMatch, GrepOptions, GrepResult, GrepSummary };

// =============================================================================
// File Walking
// =============================================================================

function filterUndefined<T extends Record<string, unknown>>(obj: T): T {
	const result = {} as T;
	for (const [key, value] of Object.entries(obj)) {
		if (value !== undefined) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

// =============================================================================
// Grep Implementation
// =============================================================================

const GREP_WORKERS = (() => {
	const val = process.env.OMP_GREP_WORKERS;
	if (val === undefined) return true;
	const n = Number.parseInt(val, 10);
	return Number.isNaN(n) || n > 0;
})();

/**
 * Search files for a regex pattern (direct, single-threaded).
 */
async function grepDirect(options: GrepOptions, onMatch?: (match: GrepMatch) => void): Promise<GrepResult> {
	const searchPath = path.resolve(options.path);
	const outputMode = options.mode ?? "content";
	const wasmMode = outputMode === "content" ? "content" : "count";

	const stat = await fs.stat(searchPath);
	const isFile = stat.isFile();

	using compiledPattern = new WasmCompiledPattern(
		filterUndefined({
			pattern: options.pattern,
			ignoreCase: options.ignoreCase,
			multiline: options.multiline,
			context: options.context,
			maxColumns: options.maxColumns,
			mode: wasmMode,
		}),
	);

	const typeFilter = resolveTypeFilter(options.type);
	const globPattern = buildGlobPattern(options.glob);

	const matches: GrepMatch[] = [];
	let totalMatches = 0;
	let filesWithMatches = 0;
	let filesSearched = 0;
	let limitReached = false;
	const maxCount = options.maxCount;
	const globalOffset = options.offset ?? 0;

	if (isFile) {
		if (typeFilter && !matchesTypeFilter(searchPath, typeFilter)) {
			return {
				matches,
				totalMatches,
				filesWithMatches,
				filesSearched,
				limitReached: limitReached || undefined,
			};
		}

		const fileReader = new FileReader();
		const content = await fileReader.read(searchPath);
		if (!content) {
			return {
				matches,
				totalMatches,
				filesWithMatches,
				filesSearched,
				limitReached: limitReached || undefined,
			};
		}
		filesSearched = 1;

		const result = compiledPattern.search_bytes(
			content,
			maxCount,
			globalOffset > 0 ? globalOffset : undefined,
		) as WasmSearchResult;

		if (result.error) {
			throw new Error(result.error);
		}

		if (result.matchCount > 0) {
			filesWithMatches = 1;
			totalMatches = result.matchCount;

			if (outputMode === "content") {
				for (const m of result.matches) {
					const match: GrepMatch = {
						path: searchPath,
						lineNumber: m.lineNumber,
						line: m.line,
						contextBefore: m.contextBefore?.length ? m.contextBefore : undefined,
						contextAfter: m.contextAfter?.length ? m.contextAfter : undefined,
						truncated: m.truncated || undefined,
					};
					matches.push(match);
					onMatch?.(match);
				}
			} else {
				const match: GrepMatch = {
					path: searchPath,
					lineNumber: 0,
					line: "",
					matchCount: result.matchCount,
				};
				matches.push(match);
				onMatch?.(match);
			}

			limitReached = result.limitReached || (maxCount !== undefined && totalMatches >= maxCount);
		}
	} else {
		const paths = await globPaths(globPattern, {
			cwd: searchPath,
			dot: options.hidden ?? true,
			onlyFiles: true,
			gitignore: true,
		});

		const fileReader = new FileReader();
		for (const relativePath of paths) {
			if (limitReached) break;
			if (typeFilter && !matchesTypeFilter(relativePath, typeFilter)) {
				continue;
			}

			const normalizedPath = relativePath.replace(/\\/g, "/");
			const fullPath = path.join(searchPath, normalizedPath);

			const content = await fileReader.read(fullPath);
			if (!content) continue;

			filesSearched++;

			if (!compiledPattern.has_match_bytes(content)) {
				continue;
			}

			const fileOffset = globalOffset > 0 ? Math.max(globalOffset - totalMatches, 0) : 0;
			const remaining = maxCount !== undefined ? Math.max(maxCount - totalMatches, 0) : undefined;
			if (remaining === 0) {
				limitReached = true;
				break;
			}
			const result = compiledPattern.search_bytes(
				content,
				remaining,
				fileOffset > 0 ? fileOffset : undefined,
			) as WasmSearchResult;

			if (result.error) {
				continue;
			}

			if (result.matchCount > 0) {
				filesWithMatches++;
				totalMatches += result.matchCount;

				if (outputMode === "content") {
					for (const m of result.matches) {
						const match: GrepMatch = {
							path: normalizedPath,
							lineNumber: m.lineNumber,
							line: m.line,
							contextBefore: m.contextBefore?.length ? m.contextBefore : undefined,
							contextAfter: m.contextAfter?.length ? m.contextAfter : undefined,
							truncated: m.truncated || undefined,
						};
						matches.push(match);
						onMatch?.(match);
					}
				} else {
					const match: GrepMatch = {
						path: normalizedPath,
						lineNumber: 0,
						line: "",
						matchCount: result.matchCount,
					};
					matches.push(match);
					onMatch?.(match);
				}

				if (result.limitReached || (maxCount !== undefined && totalMatches >= maxCount)) {
					limitReached = true;
				}
			}
		}
	}

	return {
		matches,
		totalMatches,
		filesWithMatches,
		filesSearched,
		limitReached: limitReached || undefined,
	};
}

// =============================================================================
// Content Search (lower-level API)
// =============================================================================

/**
 * Search a single file's content for a pattern.
 * Lower-level API for when you already have file content.
 */
export function searchContent(
	content: string,
	options: {
		pattern: string;
		ignoreCase?: boolean;
		multiline?: boolean;
		maxCount?: number;
		offset?: number;
		context?: number;
		maxColumns?: number;
		mode?: "content" | "count";
	},
): WasmSearchResult {
	return wasmSearch(content, filterUndefined(options)) as WasmSearchResult;
}

/**
 * Quick check if content contains a pattern match.
 */
export function hasMatch(
	content: string,
	pattern: string,
	options?: { ignoreCase?: boolean; multiline?: boolean },
): boolean {
	return wasmHasMatch(content, pattern, options?.ignoreCase ?? false, options?.multiline ?? false);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Search files for a regex pattern.
 *
 * Uses worker pool by default. Set `OMP_GREP_WORKERS=0` to disable.
 */
export async function grep(options: GrepOptions, onMatch?: (match: GrepMatch) => void): Promise<GrepResult> {
	if (GREP_WORKERS) {
		return await grepPoolInternal(options);
	}
	return await grepDirect(options, onMatch);
}

/**
 * Search files using worker pool (always, ignores OMP_GREP_WORKERS).
 */
export async function grepPool(options: GrepOptions): Promise<GrepResult> {
	return await grepPoolInternal(options);
}

// =============================================================================
// Worker Pool
// =============================================================================

const pool = new WorkerPool<WorkerRequest, WorkerResponse>({
	createWorker: () =>
		new Worker(
			resolveWorkerSpecifier({
				compiled: "./packages/natives/src/grep/worker.ts",
				dev: new URL("./worker.ts", import.meta.url),
			}),
		),
	maxWorkers: 4,
	idleTimeoutMs: 30_000,
});

async function grepPoolInternal(request: GrepOptions): Promise<GrepResult> {
	const response = await pool.request<Extract<WorkerResponse, { type: "result" }>>({
		type: "grep",
		request,
	});
	return response.result;
}

/** Terminate all grep workers. */
export function terminate(): void {
	pool.terminate();
}

export { grepDirect };
