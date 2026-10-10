/**
 * Lane path scopes for subagent scheduling.
 *
 * Lane read/write scopes are repository-relative and may contain globs. The
 * scheduler only needs a conservative answer to "could these two scopes touch
 * the same file?", so overlap is judged on each scope's literal prefix (the
 * segments before the first glob segment). A false positive only serializes two
 * lanes; a false negative lets two writers race, so every doubt resolves to
 * "overlaps".
 *
 * This module is plan-time and filesystem-free. Symlink resolution belongs to
 * whatever materializes a lane on disk, not to the scheduler.
 */

import { posix } from "node:path";

const GLOB_CHARS = /[*?[\]{}!]/;
const DRIVE_PREFIX = /^[a-zA-Z]:/;
/** `file:`, `https://`, and other URI schemes (two or more letters, so `C:` stays a drive). */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export interface NormalizedLanePath {
	/** Repository-relative POSIX path; `""` is the repository root. */
	readonly path: string;
	/** True when the input is absolute or climbs above the repository root. */
	readonly escapes: boolean;
}

export function normalizeLanePath(raw: string): NormalizedLanePath {
	const slashed = raw.trim().replace(/\\/g, "/");
	if (URI_SCHEME.test(slashed) || slashed === "~" || slashed.startsWith("~/")) return { path: slashed, escapes: true };
	if (slashed.startsWith("/") || DRIVE_PREFIX.test(slashed)) {
		return { path: slashed.replace(DRIVE_PREFIX, (drive) => drive.toLowerCase()), escapes: true };
	}
	const normalized = posix.normalize(slashed === "" ? "." : slashed).replace(/\/+$/, "");
	if (normalized === ".." || normalized.startsWith("../")) return { path: normalized, escapes: true };
	return { path: normalized === "." ? "" : normalized, escapes: false };
}

/** Segments before the first glob segment; `[]` means the scope can reach the whole repository. */
function literalPrefix(path: string): readonly string[] {
	const segments = path === "" ? [] : path.split("/");
	const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
	return firstGlob === -1 ? segments : segments.slice(0, firstGlob);
}

/** Case-insensitive, because a case-insensitive filesystem maps `Docs` and `docs` to one directory. */
function isSegmentPrefix(shorter: readonly string[], longer: readonly string[]): boolean {
	return (
		shorter.length <= longer.length &&
		shorter.every((segment, index) => segment.toLowerCase() === longer[index].toLowerCase())
	);
}

/**
 * Conservative overlap test for two lane scopes. Escaping paths are treated as
 * overlapping everything so an invalid scope can never widen parallelism, and
 * segments compare case-insensitively so `Docs/a.md` and `docs/a.md` overlap.
 */
export function lanePathsIntersect(left: string, right: string): boolean {
	const a = normalizeLanePath(left);
	const b = normalizeLanePath(right);
	if (a.escapes || b.escapes) return true;
	// A glob can match anything below its literal prefix, so scopes overlap
	// whenever one literal prefix contains the other.
	const leftPrefix = literalPrefix(a.path);
	const rightPrefix = literalPrefix(b.path);
	return isSegmentPrefix(leftPrefix, rightPrefix) || isSegmentPrefix(rightPrefix, leftPrefix);
}

/** Scope entries that are absolute or climb above the repository root. */
export function findEscapingLanePaths(paths: readonly string[] | undefined): string[] {
	return (paths ?? []).filter((path) => path.trim() !== "" && normalizeLanePath(path).escapes);
}
