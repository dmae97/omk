/**
 * Worker script for running wasm-bindgen grep.
 * Each worker loads its own WASM instance and processes requests.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { globPaths } from "@oh-my-pi/pi-utils";
import { CompiledPattern } from "../../wasm/pi_natives";
import { FileReader } from "./file-reader";
import { buildGlobPattern, matchesTypeFilter, resolveTypeFilter } from "./filters";
import type { GrepMatch, GrepOptions, GrepResult, WasmSearchResult, WorkerRequest, WorkerResponse } from "./types";

function filterUndefined<T extends Record<string, unknown>>(obj: T): T {
	const result = {} as T;
	for (const [key, value] of Object.entries(obj)) {
		if (value !== undefined) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

async function runGrep(request: GrepOptions): Promise<GrepResult> {
	const searchPath = path.resolve(request.path);
	const stat = await fs.stat(searchPath);
	const isFile = stat.isFile();

	using compiledPattern = new CompiledPattern(
		filterUndefined({
			pattern: request.pattern,
			ignoreCase: request.ignoreCase,
			multiline: request.multiline,
			context: request.context,
			maxColumns: request.maxColumns,
			mode: request.mode === "content" || !request.mode ? "content" : "count",
		}),
	);

	const matches: GrepMatch[] = [];
	let totalMatches = 0;
	let filesWithMatches = 0;
	let filesSearched = 0;
	let limitReached = false;
	const maxCount = request.maxCount;
	const globalOffset = request.offset ?? 0;
	const typeFilter = resolveTypeFilter(request.type);
	const globPattern = buildGlobPattern(request.glob);

	const fileReader = new FileReader();
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

		if (!result.error && result.matchCount > 0) {
			filesWithMatches = 1;
			totalMatches = result.matchCount;

			if (request.mode === "content" || !request.mode) {
				for (const m of result.matches) {
					matches.push({
						path: searchPath,
						lineNumber: m.lineNumber,
						line: m.line,
						contextBefore: m.contextBefore?.length ? m.contextBefore : undefined,
						contextAfter: m.contextAfter?.length ? m.contextAfter : undefined,
						truncated: m.truncated || undefined,
					});
				}
			} else {
				matches.push({
					path: searchPath,
					lineNumber: 0,
					line: "",
					matchCount: result.matchCount,
				});
			}

			limitReached = result.limitReached || (maxCount !== undefined && totalMatches >= maxCount);
		}
	} else {
		const paths = await globPaths(globPattern, {
			cwd: searchPath,
			dot: request.hidden ?? true,
			onlyFiles: true,
			gitignore: true,
		});

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

			if (result.error) continue;

			if (result.matchCount > 0) {
				filesWithMatches++;
				totalMatches += result.matchCount;

				if (request.mode === "content" || !request.mode) {
					for (const m of result.matches) {
						matches.push({
							path: normalizedPath,
							lineNumber: m.lineNumber,
							line: m.line,
							contextBefore: m.contextBefore?.length ? m.contextBefore : undefined,
							contextAfter: m.contextAfter?.length ? m.contextAfter : undefined,
							truncated: m.truncated || undefined,
						});
					}
				} else {
					matches.push({
						path: normalizedPath,
						lineNumber: 0,
						line: "",
						matchCount: result.matchCount,
					});
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

declare const self: Worker;

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
	const msg = e.data;

	switch (msg.type) {
		case "init":
			self.postMessage({ type: "ready", id: msg.id } satisfies WorkerResponse);
			break;

		case "grep":
			try {
				const result = await runGrep(msg.request);
				self.postMessage({ type: "result", id: msg.id, result } satisfies WorkerResponse);
			} catch (err) {
				self.postMessage({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				} satisfies WorkerResponse);
			}
			break;

		case "destroy":
			break;
	}
});
