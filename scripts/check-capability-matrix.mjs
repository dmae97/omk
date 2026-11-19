#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { checkCapabilityMatrix, MATRIX, readInventory } from "./lib/capability-matrix.mjs";
try {
	if (process.argv.length !== 2) throw Error("usage: node scripts/check-capability-matrix.mjs");
	const { features, builtinFiles } = checkCapabilityMatrix(JSON.parse(readFileSync(MATRIX, "utf8")), readInventory());
	console.log(`PASS: capability matrix has ${features} features and ${builtinFiles} built-in extension files`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
