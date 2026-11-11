#!/usr/bin/env node
import { readRustBundle, assertOutputPath, writeArtifacts } from "./contracts/artifacts.mjs";
import { generateArtifacts } from "./contracts/typescript.mjs";
try {
	if (process.argv.length !== 3 || process.argv[2] !== "--write")
		throw Error("usage: node scripts/generate-contracts.mjs --write");
	const artifacts = generateArtifacts(readRustBundle());
	writeArtifacts(assertOutputPath(), artifacts);
	console.log(`GENERATED: ${artifacts.size} type-only wire artifacts; T004 compatibility integration unchanged`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
