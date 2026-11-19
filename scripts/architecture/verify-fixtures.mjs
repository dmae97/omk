import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURE_FILES = ["dag.tsv", "memory.tsv", "invalid.tsv", "wpl.tsv"];
export const SOURCE_FILES = [
	"scripts/architecture/export-fixtures.mjs",
	"scripts/architecture/verify-fixtures.mjs",
	"scripts/architecture/verify-fixtures.R",
	"packages/agent/src/tool-dag-reduce.ts",
	"packages/adaptorch-wpl/src/state-machine.ts",
	"packages/adaptorch-wpl/src/types.ts",
];

export function digestFile(path) {
	if (!lstatSync(path).isFile()) throw new Error(`Not a regular input file: ${path}`);
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sourceDigests() {
	return Object.fromEntries(SOURCE_FILES.map((file) => [file, digestFile(join(ROOT, file))]));
}

function exactKeys(value, keys) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
	);
}

export function validateBundle(directory) {
	const manifestFile = join(directory, "manifest.json");
	const manifestDigest = digestFile(manifestFile);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	} catch (error) {
		throw new Error(`Invalid manifest: ${error.message}`);
	}
	if (
		!exactKeys(manifest, ["version", "inputs", "fixtures"]) ||
		manifest.version !== 1 ||
		!exactKeys(manifest.inputs, SOURCE_FILES) ||
		!exactKeys(manifest.fixtures, FIXTURE_FILES) ||
		![...Object.values(manifest.inputs), ...Object.values(manifest.fixtures)].every(
			(value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
		)
	) {
		throw new Error("Invalid manifest schema, filenames or digest syntax");
	}
	for (const file of SOURCE_FILES) {
		if (digestFile(join(ROOT, file)) !== manifest.inputs[file]) throw new Error(`Stale source digest: ${file}`);
	}
	for (const file of FIXTURE_FILES) {
		if (digestFile(join(directory, file)) !== manifest.fixtures[file])
			throw new Error(`Invalid fixture digest: ${file}`);
	}
	return manifestDigest;
}

export function verifyFixtures(directory, rscript = process.env.OMK_RSCRIPT || "Rscript") {
	const bundle = resolve(directory);
	const before = validateBundle(bundle);
	const result = spawnSync(rscript, ["--vanilla", join(ROOT, "scripts/architecture/verify-fixtures.R"), bundle], {
		encoding: "utf8",
		timeout: 120_000,
		maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" },
	});
	if (result.error) throw new Error(`R executable unavailable or failed: ${result.error.message}`);
	process.stdout.write(result.stdout);
	if (result.status !== 0) throw new Error(`R oracle failed (${result.status}): ${result.stderr.trim()}`);
	if (validateBundle(bundle) !== before) throw new Error("Manifest changed during R verification");
	if (
		!/^R ORACLE R version .+$/m.test(result.stdout) ||
		!/^PASS graphs=1107 dag_cases=2214 memory_cases=16 invalid_cases=15 states=14 pairs=196$/m.test(result.stdout)
	) {
		throw new Error("R oracle did not return the required bounded PASS receipt");
	}
	return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length !== 3) throw new Error("Usage: node scripts/architecture/verify-fixtures.mjs <bundle>");
		const bundle = verifyFixtures(process.argv[2]);
		console.log(`VERIFIED ${bundle} (source/fixture integrity, bounded TS/R parity; not authentication)`);
	} catch (error) {
		console.error(`FAIL ${error.message}`);
		process.exitCode = 1;
	}
}
