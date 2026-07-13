/**
 * Path segment helpers without node:path — safe for browser bundles (browser-smoke).
 */

export function normalizePathSlashes(raw: string): string {
	return raw.replace(/\\/g, "/");
}

export function pathSegments(normalized: string): string[] {
	return normalized.split("/").filter((s) => s.length > 0);
}

/** Join cwd and relative path using forward slashes only. */
export function joinPathSegments(cwd: string, relative: string): string {
	const base = normalizePathSlashes(cwd).replace(/\/+$/, "");
	const rel = normalizePathSlashes(relative).replace(/^\/+/, "");
	if (rel.length === 0) {
		return base || "/";
	}
	if (rel.startsWith("/")) {
		return rel;
	}
	return `${base}/${rel}`;
}

/**
 * Collapse "." and ".." segments without touching the filesystem. Returns null
 * when a ".." escapes above the root, so callers can fail closed.
 */
export function collapsePathSegments(segments: readonly string[]): string[] | null {
	const collapsed: string[] = [];
	for (const segment of segments) {
		if (segment === ".") continue;
		if (segment === "..") {
			if (collapsed.length === 0) return null;
			collapsed.pop();
			continue;
		}
		collapsed.push(segment);
	}
	return collapsed;
}

/**
 * True when two normalized paths may refer to the same file or subtree.
 * Fail-closed: "."/".." are collapsed first, root-escaping paths always count
 * as overlapping, and segments compare case-insensitively so case-aliasing
 * filesystems never split one file into two "independent" paths. Symlinks and
 * hardlinks are not resolved here (no fs access); overlap only forces
 * sequential execution, so false positives are safe.
 */
export function pathSegmentsOverlap(left: string, right: string): boolean {
	const leftParts = collapsePathSegments(pathSegments(normalizePathSlashes(left)));
	const rightParts = collapsePathSegments(pathSegments(normalizePathSlashes(right)));
	if (leftParts === null || rightParts === null) {
		return true;
	}
	if (leftParts.length === 0 || rightParts.length === 0) {
		return leftParts.length === rightParts.length && leftParts.length > 0;
	}
	const commonLen = Math.min(leftParts.length, rightParts.length);
	for (let i = 0; i < commonLen; i++) {
		if (leftParts[i].toLowerCase() !== rightParts[i].toLowerCase()) {
			return false;
		}
	}
	return true;
}
