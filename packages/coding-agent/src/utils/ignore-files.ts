/**
 * Ignore file handling for .gitignore/.ignore/.fdignore support when scanning directories.
 */
import * as path from "node:path";
import ignore from "ignore";

export const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"] as const;

export type IgnoreMatcher = ignore.Ignore;

/**
 * Convert a path to POSIX format (forward slashes).
 */
export function toPosixPath(p: string): string {
	return p.split(path.sep).join("/");
}

/**
 * Prefix an ignore pattern to make it relative to a subdirectory.
 * Returns null for comments and empty lines.
 */
export function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

/**
 * Read and add ignore rules from a directory to the matcher.
 */
export async function addIgnoreRules(
	ig: IgnoreMatcher,
	dir: string,
	rootDir: string,
	readFile: (path: string) => Promise<string | null>,
): Promise<void> {
	const relativeDir = path.relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = path.join(dir, filename);
		const content = await readFile(ignorePath);
		if (!content) continue;

		const patterns = content
			.split(/\r?\n/)
			.map(line => prefixIgnorePattern(line, prefix))
			.filter((line): line is string => Boolean(line));

		if (patterns.length > 0) {
			ig.add(patterns);
		}
	}
}

/**
 * Read and add ignore rules from a directory to the matcher (synchronous version).
 */
export function addIgnoreRulesSync(
	ig: IgnoreMatcher,
	dir: string,
	rootDir: string,
	readFileSync: (path: string) => string | null,
): void {
	const relativeDir = path.relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = path.join(dir, filename);
		const content = readFileSync(ignorePath);
		if (!content) continue;

		const patterns = content
			.split(/\r?\n/)
			.map(line => prefixIgnorePattern(line, prefix))
			.filter((line): line is string => Boolean(line));

		if (patterns.length > 0) {
			ig.add(patterns);
		}
	}
}

/**
 * Create a fresh ignore matcher.
 */
export function createIgnoreMatcher(): IgnoreMatcher {
	return ignore();
}

/**
 * Check if a path should be ignored.
 * @param ig - The ignore matcher
 * @param root - The root directory for relative path calculation
 * @param fullPath - The full path to check
 * @param isDir - Whether the path is a directory
 */
export function shouldIgnore(ig: IgnoreMatcher, root: string, fullPath: string, isDir: boolean): boolean {
	const relPath = toPosixPath(path.relative(root, fullPath));
	const ignorePath = isDir ? `${relPath}/` : relPath;
	return ig.ignores(ignorePath);
}
