import * as fs from "node:fs";
import * as path from "node:path";
import {
	type PackageManifestDialect,
	PackageManifestPolicyError,
	type PackageManifestResolution,
	readPackageManifest,
} from "../package-manifest.ts";

/** Direct loading intentionally retains its shallow discovery and declared-directory index rules. */
export function resolveDirectExtensionEntries(
	dir: string,
	dialect: PackageManifestDialect,
	activeDirs: ReadonlySet<string> = new Set(),
	depth = 0,
): string[] | null {
	const canonicalDir = dialect === "omk" ? fs.realpathSync(dir) : dir;
	if (dialect === "omk") {
		if (activeDirs.has(canonicalDir) || depth >= 64) return [];
		activeDirs = new Set(activeDirs).add(canonicalDir);
	}
	const packageJsonPath = path.join(dir, "package.json");
	if (fs.existsSync(packageJsonPath)) {
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
			for (const extPath of resolvedManifest.manifest?.extensions ?? []) {
				const candidate = path.resolve(dir, extPath);
				if (!fs.existsSync(candidate)) continue;
				if (fs.statSync(candidate).isDirectory()) {
					if (dialect === "omk" && fs.realpathSync(candidate) !== canonicalDir) {
						const nested = resolveDirectExtensionEntries(candidate, dialect, activeDirs, depth + 1);
						if (nested !== null) {
							entries.push(...nested);
							continue;
						}
					}
					for (const indexName of ["index.ts", "index.js", "index.mjs", "index.cjs"]) {
						const indexPath = path.join(candidate, indexName);
						if (fs.existsSync(indexPath)) {
							entries.push(indexPath);
							break;
						}
					}
				} else {
					entries.push(candidate);
				}
			}
			return entries;
		}
	}
	for (const indexName of ["index.ts", "index.js"]) {
		const indexPath = path.join(dir, indexName);
		if (fs.existsSync(indexPath)) return [indexPath];
	}
	return null;
}

export function discoverDirectExtensionsInDir(dir: string, dialect: PackageManifestDialect): string[] {
	if (!fs.existsSync(dir)) return [];
	const discovered: string[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const entryPath = path.join(dir, entry.name);
			if ((entry.isFile() || entry.isSymbolicLink()) && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				discovered.push(entryPath);
				continue;
			}
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				try {
					const entries = resolveDirectExtensionEntries(entryPath, dialect);
					if (entries) discovered.push(...entries);
				} catch (error) {
					if (dialect === "omk+pi") throw error;
				}
			}
		}
	} catch {
		return [];
	}
	return discovered;
}
