/**
 * File discovery API powered by globset + ignore crate.
 */

import * as path from "node:path";
import { native } from "../native";
import type { FindMatch, FindOptions, FindResult } from "./types";

export type { FindMatch, FindOptions, FindResult } from "./types";

/**
 * Find files matching a glob pattern.
 * Respects .gitignore by default.
 */
export async function find(options: FindOptions, onMatch?: (match: FindMatch) => void): Promise<FindResult> {
	const searchPath = path.resolve(options.path);
	const pattern = options.pattern || "*";

	// Convert simple patterns to recursive globs if needed
	const globPattern = pattern.includes("/") || pattern.startsWith("**") ? pattern : `**/${pattern}`;

	// napi-rs ThreadsafeFunction passes (error, value) - skip callback on error
	const cb = onMatch ? (err: Error | null, m: FindMatch) => !err && onMatch(m) : undefined;

	return native.find(
		{
			...options,
			path: searchPath,
			pattern: globPattern,
			hidden: options.hidden ?? false,
			gitignore: options.gitignore ?? true,
		},
		cb,
	);
}
