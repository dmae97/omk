#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Glob } from "bun";

const PACKAGES: Record<string, string> = {
	"coding-agent": "$c",
	ai: "$ai",
	tui: "$tui",
	agent: "$agent",
	"omp-stats": "$stats",
};

const ROOT = resolve(import.meta.dirname, "..");

async function transformFile(filePath: string, pkgName: string, prefix: string): Promise<number> {
	const content = readFileSync(filePath, "utf-8");
	const pkgRoot = resolve(ROOT, "packages", pkgName);
	const srcRoot = resolve(pkgRoot, "src");
	const fileDir = dirname(filePath);

	let transformed = content;
	let count = 0;

	// Match import/export from with relative paths starting with ../
	const importRegex = /(from\s+["'])(\.\.[^"']+)(["'])/g;

	transformed = content.replace(importRegex, (match, before, importPath, after) => {
		// Resolve the relative import to absolute
		const absolutePath = resolve(fileDir, importPath);

		// Check if it resolves within src/
		if (!absolutePath.startsWith(srcRoot)) {
			return match; // Outside src, keep as-is
		}

		// Get path relative to src/
		let relToSrc = relative(srcRoot, absolutePath);

		// Handle index imports - if pointing to a directory, it's importing index
		// But we keep the path as-is since TS resolves index automatically

		const newImport = `${prefix}/${relToSrc}`;
		count++;
		return `${before}${newImport}${after}`;
	});

	if (count > 0) {
		writeFileSync(filePath, transformed);
	}

	return count;
}

async function transformPackage(pkgName: string, prefix: string): Promise<number> {
	const pkgRoot = resolve(ROOT, "packages", pkgName);
	const glob = new Glob("**/*.ts");
	let total = 0;

	for await (const file of glob.scan({ cwd: resolve(pkgRoot, "src"), absolute: true })) {
		total += await transformFile(file, pkgName, prefix);
	}

	// Also transform test files if directory exists
	const testDir = resolve(pkgRoot, "test");
	try {
		const testGlob = new Glob("**/*.ts");
		for await (const file of testGlob.scan({ cwd: testDir, absolute: true })) {
			total += await transformFile(file, pkgName, prefix);
		}
	} catch {
		// test dir doesn't exist, skip
	}

	return total;
}

async function main() {
	console.log("Transforming relative imports to path aliases...\n");

	let grandTotal = 0;
	for (const [pkgName, prefix] of Object.entries(PACKAGES)) {
		const count = await transformPackage(pkgName, prefix);
		console.log(`  ${pkgName}: ${count} imports transformed`);
		grandTotal += count;
	}

	console.log(`\nTotal: ${grandTotal} imports transformed`);
}

main().catch(console.error);
