#!/usr/bin/env node
import { readRustBundle, assertOutputPath, writeArtifacts } from "./contracts/artifacts.mjs";
import { COMPAT_TABLE, renderCompatTable, writeCompatTable } from "./contracts/compat-table.mjs";
import { generateArtifacts } from "./contracts/typescript.mjs";
try {
	if (process.argv.length !== 3 || process.argv[2] !== "--write")
		throw Error("usage: node scripts/generate-contracts.mjs --write");
	const bundle = readRustBundle();
	const artifacts = generateArtifacts(bundle);
	const compat = renderCompatTable(bundle.compat);
	writeArtifacts(assertOutputPath(), artifacts);
	writeCompatTable(COMPAT_TABLE, compat);
	console.log(`GENERATED: ${artifacts.size} type-only wire artifacts and the pi-compat.ts runtime table`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
