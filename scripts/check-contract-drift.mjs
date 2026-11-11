#!/usr/bin/env node
import { readRustBundle, assertOutputPath, checkArtifacts } from "./contracts/artifacts.mjs";
import { COMPAT_TABLE, checkCompatTable, renderCompatTable } from "./contracts/compat-table.mjs";
import { generateArtifacts } from "./contracts/typescript.mjs";
try {
	if (process.argv.length !== 2) throw Error("usage: node scripts/check-contract-drift.mjs");
	const bundle = readRustBundle();
	const result = checkArtifacts(assertOutputPath(), generateArtifacts(bundle));
	checkCompatTable(COMPAT_TABLE, renderCompatTable(bundle.compat));
	console.log(`PASS: ${result.files} generated wire artifacts and the pi-compat.ts table match Rust`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
