#!/usr/bin/env node
import { readRustBundle, assertOutputPath, checkArtifacts } from "./contracts/artifacts.mjs";
import { generateArtifacts } from "./contracts/typescript.mjs";
try {
	if (process.argv.length !== 2) throw Error("usage: node scripts/check-contract-drift.mjs");
	const result = checkArtifacts(assertOutputPath(), generateArtifacts(readRustBundle()));
	console.log(`PASS: ${result.files} generated wire artifacts match Rust; T004 compatibility-table drift NOT checked`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
