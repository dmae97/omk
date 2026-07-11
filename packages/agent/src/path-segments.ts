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

/** True when two normalized paths may refer to the same file or subtree. */
export function pathSegmentsOverlap(left: string, right: string): boolean {
	const leftParts = pathSegments(normalizePathSlashes(left));
	const rightParts = pathSegments(normalizePathSlashes(right));
	if (leftParts.length === 0 || rightParts.length === 0) {
		return leftParts.length === rightParts.length && leftParts.length > 0;
	}
	const commonLen = Math.min(leftParts.length, rightParts.length);
	for (let i = 0; i < commonLen; i++) {
		if (leftParts[i] !== rightParts[i]) {
			return false;
		}
	}
	return true;
}
