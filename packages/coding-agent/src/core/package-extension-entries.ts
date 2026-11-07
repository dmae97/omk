import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { globSync } from "glob";
import ignore from "ignore";
import {
	type PackageManifestDialect,
	PackageManifestPolicyError,
	type PackageManifestResolution,
	readPackageManifest,
} from "./package-manifest.ts";
import { applyPatterns } from "./package-resource-patterns.ts";

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

export function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
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

export function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

export function isOverridePattern(s: string): boolean {
	return s.startsWith("!") || s.startsWith("+") || s.startsWith("-");
}

export function hasGlobPattern(s: string): boolean {
	return s.includes("*") || s.includes("?");
}

export function resolveManifestPaths(entries: string[], root: string): string[] {
	const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
	return sourceEntries.flatMap((entry) => {
		if (!hasGlobPattern(entry)) {
			return [resolve(root, entry)];
		}

		return globSync(entry, {
			cwd: root,
			absolute: true,
			dot: false,
			nodir: false,
		}).map((match) => resolve(match));
	});
}

export function resolveExtensionEntries(
	dir: string,
	dialect: PackageManifestDialect,
	activeDirs: ReadonlySet<string> = new Set(),
	depth = 0,
): string[] | null {
	if (dialect === "omk") {
		const canonicalDir = realpathSync(dir);
		if (activeDirs.has(canonicalDir) || depth >= 64) return [];
		activeDirs = new Set(activeDirs).add(canonicalDir);
	}
	const packageJsonPath = join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		let resolvedManifest: PackageManifestResolution | null;
		try {
			resolvedManifest = readPackageManifest(packageJsonPath, dialect);
		} catch (error) {
			if (error instanceof PackageManifestPolicyError) return [];
			throw error;
		}
		if (resolvedManifest && (resolvedManifest.key !== null || resolvedManifest.diagnostics.length > 0)) {
			const entries: string[] = [];
			if (dialect === "omk" && resolvedManifest.diagnostics.length > 0) return entries;
			const declared = resolvedManifest.manifest?.extensions ?? [];
			const paths =
				dialect === "omk" ? resolveManifestPaths(declared, dir) : declared.map((ext) => resolve(dir, ext));
			for (const path of paths) {
				if (!existsSync(path)) continue;
				const nested =
					dialect === "omk" && statSync(path).isDirectory()
						? collectAutoExtensionEntries(path, dialect, activeDirs, depth + 1)
						: null;
				entries.push(...(nested ?? [path]));
			}
			// Compatibility deliberately retains literal entries and index fallback, not native expansion.
			if (dialect === "omk") return Array.from(applyPatterns(entries, declared.filter(isOverridePattern), dir));
			if (entries.length > 0) return entries;
		}
	}

	const indexTs = join(dir, "index.ts");
	const indexJs = join(dir, "index.js");
	if (existsSync(indexTs)) {
		return [indexTs];
	}
	if (existsSync(indexJs)) {
		return [indexJs];
	}

	return null;
}

export function collectAutoExtensionEntries(
	dir: string,
	dialect: PackageManifestDialect,
	activeDirs: ReadonlySet<string> = new Set(),
	depth = 0,
): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	// First check if this directory itself has explicit extension entries (package.json or index)
	const rootEntries = resolveExtensionEntries(dir, dialect, activeDirs, depth);
	if (rootEntries) {
		return rootEntries;
	}
	if (dialect === "omk") activeDirs = new Set(activeDirs).add(realpathSync(dir));

	// Otherwise, discover extensions from directory contents
	const ig = ignore();
	addIgnoreRules(ig, dir, dir);

	try {
		const dirEntries = readdirSync(dir, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();

			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDir = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(dir, fullPath));
			const ignorePath = isDir ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) continue;

			if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				entries.push(fullPath);
			} else if (isDir) {
				const resolvedEntries = resolveExtensionEntries(fullPath, dialect, activeDirs, depth + 1);
				if (resolvedEntries) {
					entries.push(...resolvedEntries);
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}
