#!/usr/bin/env bun
/**
 * Sync package.json files across the monorepo:
 *   1. Enforce consistent field ordering
 *   2. Regenerate `exports` from filesystem structure
 *
 * Export rules:
 *   - Every .ts/.tsx file under src/ gets an export without extension
 *   - Directories with index.ts/index.tsx get a directory-level export (without /index)
 *   - src/index.ts maps to "."
 *   - Non-TS assets with companion .d.ts get typed exports
 *   - Non-TS glob exports are preserved (e.g. ./prompts/* -> *.md)
 *   - Packages without existing exports are skipped for export generation
 *
 * Usage:
 *   bun scripts/sync-exports.ts          # update all packages
 *   bun scripts/sync-exports.ts --check  # dry-run, exit 1 if anything changed
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
const CHECK_MODE = process.argv.includes("--check");

// Canonical field order for package.json. Fields not listed here are placed
// between the last "known" field before them and the next one, preserving
// relative order of unknown fields. `files` and `exports` are always last.
const FIELD_ORDER = [
	"type",
	"private",
	"name",
	"version",
	"description",
	"homepage",
	"author",
	"contributors",
	"license",
	"repository",
	"bugs",
	"keywords",
	"main",
	"types",
	"bin",
	"scripts",
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
	"engines",
	// --- everything else goes here ---
	"files",
	"exports",
];

function orderFields(pkg: Record<string, unknown>): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	const knownSet = new Set(FIELD_ORDER);
	const unknownKeys = Object.keys(pkg).filter((k) => !knownSet.has(k));

	// Place known fields in order, then unknown fields, then files/exports
	const tailFields = ["files", "exports"];
	for (const key of FIELD_ORDER) {
		if (tailFields.includes(key)) continue; // handled below
		if (key in pkg) ordered[key] = pkg[key];
	}
	for (const key of unknownKeys) {
		ordered[key] = pkg[key];
	}
	for (const key of tailFields) {
		if (key in pkg) ordered[key] = pkg[key];
	}
	return ordered;
}
type ExportEntry = string | { types: string; import: string };
type ExportsMap = Record<string, ExportEntry>;

function tsExportEntry(srcRelative: string): { types: string; import: string } {
	return { types: `./${srcRelative}`, import: `./${srcRelative}` };
}

function collectExports(srcDir: string): ExportsMap {
	const exports: ExportsMap = {};
	const dtsFiles = new Set<string>();
	const nonTsAssets: string[] = [];
	// Track which directories contain loose .ts/.tsx files (non-index)
	const dirsWithFiles = new Set<string>();

	function walk(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				const indexTs = path.join(fullPath, "index.ts");
				const indexTsx = path.join(fullPath, "index.tsx");
				const indexFile = fs.existsSync(indexTs) ? indexTs : fs.existsSync(indexTsx) ? indexTsx : null;

				if (indexFile) {
					const exportKey = `./${path.relative(srcDir, fullPath)}`;
					const srcRel = path.relative(path.dirname(srcDir), indexFile);
					exports[exportKey] = tsExportEntry(srcRel);
				}

				walk(fullPath);
			} else if (entry.isFile()) {
				if (entry.name.endsWith(".d.ts")) {
					dtsFiles.add(fullPath);
				} else if (!/\.tsx?$/.test(entry.name)) {
					nonTsAssets.push(fullPath);
				} else if (entry.name === "index.ts" || entry.name === "index.tsx") {
					if (dir === srcDir) {
						const srcRel = path.relative(path.dirname(srcDir), fullPath);
						exports["."] = tsExportEntry(srcRel);
					}
				} else {
					dirsWithFiles.add(dir);
				}
			}
		}
	}

	walk(srcDir);

	// Emit a glob export per directory that has loose .ts/.tsx files
	for (const dir of dirsWithFiles) {
		const rel = path.relative(srcDir, dir);
		const exportKey = rel ? `./${rel}/*` : "./*";
		const srcGlob = rel ? `./src/${rel}/*.ts` : "./src/*.ts";
		exports[exportKey] = { types: srcGlob, import: srcGlob };
	}

	// Export non-TS assets that have a companion .d.ts
	for (const asset of nonTsAssets) {
		const dts = `${asset}.d.ts`;
		if (!dtsFiles.has(dts)) continue;
		const exportKey = `./${path.relative(srcDir, asset)}`;
		const importPath = `./${path.relative(path.dirname(srcDir), asset)}`;
		const typesPath = `./${path.relative(path.dirname(srcDir), dts)}`;
		exports[exportKey] = { types: typesPath, import: importPath };
	}

	return exports;
}

function getNonTsExports(existing: ExportsMap): ExportsMap {
	const preserved: ExportsMap = {};
	for (const [key, value] of Object.entries(existing)) {
		// Preserve entries whose targets are non-TS and non-generated (e.g. glob patterns for .md)
		const target = typeof value === "string" ? value : value?.import || value?.types || "";
		if (target.includes("*") && !/\*\.tsx?$/.test(target)) {
			preserved[key] = value;
		}
	}
	return preserved;
}

function sortExports(exports: ExportsMap): ExportsMap {
	const entries = Object.entries(exports);
	entries.sort(([a], [b]) => {
		// "." always first
		if (a === ".") return -1;
		if (b === ".") return 1;
		return a.localeCompare(b);
	});
	return Object.fromEntries(entries);
}

let dirty = false;

const pkgDirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => path.join(PACKAGES_DIR, d.name));

for (const pkgDir of pkgDirs) {
	const pkgJsonPath = path.join(pkgDir, "package.json");
	if (!fs.existsSync(pkgJsonPath)) continue;

	const raw = fs.readFileSync(pkgJsonPath, "utf-8");
	const pkgJson = JSON.parse(raw);
	const pkgName = pkgJson.name || path.basename(pkgDir);
	const changes: string[] = [];

	// --- 1. Regenerate exports ---
	const srcDir = path.join(pkgDir, "src");
	if (pkgJson.exports && fs.existsSync(srcDir)) {
		const preserved = getNonTsExports(pkgJson.exports);
		const generated = collectExports(srcDir);
		const merged = sortExports({ ...generated, ...preserved });

		if (JSON.stringify(pkgJson.exports) !== JSON.stringify(merged)) {
			pkgJson.exports = merged;
			changes.push("exports");
		}
	}

	// --- 2. Enforce field order ---
	const ordered = orderFields(pkgJson);
	if (JSON.stringify(Object.keys(pkgJson)) !== JSON.stringify(Object.keys(ordered))) {
		changes.push("field order");
	}

	if (changes.length > 0) {
		if (CHECK_MODE) {
			console.log(`${pkgName}: out of sync (${changes.join(", ")})`);
			dirty = true;
		} else {
			fs.writeFileSync(pkgJsonPath, JSON.stringify(ordered, null, "\t") + "\n");
			console.log(`${pkgName}: updated (${changes.join(", ")})`);
		}
	}
}

if (CHECK_MODE && dirty) {
	console.error("\nRun `bun scripts/sync-exports.ts` to fix.");
	process.exit(1);
}
