/**
 * File discovery API powered by globset + ignore crate.
 */

import * as path from "node:path";
import { native } from "../native";
import type { GlobMatch, GlobOptions, GlobResult } from "./types";

export type { GlobMatch, GlobOptions, GlobResult } from "./types";
export { FileType } from "./types";

/**
 * Find files matching a glob pattern.
 * Respects .gitignore by default.
 */
export async function glob(options: GlobOptions, onMatch?: (match: GlobMatch) => void): Promise<GlobResult> {
	const searchPath = path.resolve(options.path);
	const pattern = options.pattern || "*";
	// napi-rs ThreadsafeFunction passes (error, value) - skip callback on error
	const cb = onMatch ? (err: Error | null, m: GlobMatch) => !err && onMatch(m) : undefined;

	return native.glob(
		{
			...options,
			path: searchPath,
			pattern,
			hidden: options.hidden ?? false,
			gitignore: options.gitignore ?? true,
			recursive: options.recursive ?? true,
		},
		cb,
	);
}

/**
 * Invalidate the filesystem scan cache.
 *
 * When called with a path, removes entries for roots containing that path.
 * When called without a path, clears the entire cache.
 */
export function invalidateFsScanCache(path?: string): void {
	native.invalidateFsScanCache(path);
}
