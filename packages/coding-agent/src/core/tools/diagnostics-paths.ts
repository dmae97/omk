import { statSync } from "node:fs";
import { resolve } from "node:path";
import { getFileMutationGeneration } from "./file-mutation-queue.ts";

/**
 * Exact file filter: a checker-reported path (relative to the directory the
 * checker ran in, or absolute) must resolve to the same absolute path as the
 * requested `path` (relative to the session cwd). Substring matching made
 * `a.ts` match `data.ts`.
 */
export function pathFilter(
	cwd: string,
	path: string | undefined,
	checkerDir: string,
): (d: { readonly path: string }) => boolean {
	if (!path) return () => true;
	const want = resolve(cwd, path);
	return (d) => resolve(checkerDir, d.path) === want;
}

/** mtime+size of the target file, part of the diagnostics cache key. */
export function fileStamp(cwd: string, path: string | undefined): string {
	if (!path) return "";
	try {
		const st = statSync(resolve(cwd, path));
		return `${st.mtimeMs}:${st.size}`;
	} catch {
		return "missing";
	}
}

/** Cache-key suffix: file-mutation generation + target file stamp. */
export function cacheStamp(cwd: string, path: string | undefined): string {
	return `${getFileMutationGeneration()}\0${fileStamp(cwd, path)}`;
}
