import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { digestFile, ROOT, validateBundle, verifyFixtures } from "./verify-fixtures.mjs";

const sources = [
	"native/omk-policy/Cargo.toml",
	"native/omk-policy/Cargo.lock",
	"native/omk-policy/src/lib.rs",
	"native/omk-policy/src/bin/policy-fixtures.rs",
	"scripts/architecture/verify-rust-policy.mjs",
];

function expectedOutput(bundle) {
	const lines = ["RUST_POLICY_V1"];
	for (const kind of ["dag", "memory"]) {
		const rows = readFileSync(join(bundle, `${kind}.tsv`), "utf8")
			.split("\n")
			.slice(1, -1);
		for (const row of rows) {
			const r = row.split("\t");
			lines.push(
				(kind === "dag" ? [kind, r[0], r[4], r[6], r[7], r[8]] : [kind, r[0], r[1], r[6], r[3], r[4]]).join("\t"),
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

export function verifyRustPolicy(directory, executable, rscript = process.env.OMK_RSCRIPT || "Rscript") {
	const bundle = resolve(directory);
	const binary = resolve(executable);
	const bindings = () =>
		Object.fromEntries(
			[...sources.map((file) => [file, join(ROOT, file)]), ["binary", binary]].map(([name, file]) => [
				name,
				digestFile(file),
			]),
		);
	const before = bindings();
	const manifest = validateBundle(bundle);
	verifyFixtures(bundle, rscript);
	const expected = expectedOutput(bundle);
	const result = spawnSync(binary, [bundle], {
		encoding: "utf8",
		timeout: 120_000,
		killSignal: "SIGKILL",
		maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
	});
	if (result.error) throw new Error(`Rust policy executable unavailable or failed: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`Rust policy execution failed (${result.status}, ${result.signal})`);
	if (validateBundle(bundle) !== manifest || JSON.stringify(bindings()) !== JSON.stringify(before)) {
		throw new Error("Rust policy inputs changed during verification");
	}
	if (result.stdout !== expected) throw new Error("Rust policy output mismatch (exact graph/strategy/bytes required)");
	return { version: 1, dagCases: 2214, memoryCases: 16, manifestSha256: manifest, bindings: before };
}

if (typeof import.meta.main !== "boolean") throw new Error("Node.js >=22.19.0 is required");
if (import.meta.main) {
	try {
		if (process.argv.length !== 4)
			throw new Error("Usage: node scripts/architecture/verify-rust-policy.mjs <bundle> <policy-fixtures-binary>");
		console.log(`RUST_POLICY_VERIFIED ${JSON.stringify(verifyRustPolicy(process.argv[2], process.argv[3]))}`);
	} catch (error) {
		console.error(`FAIL ${error.message}`);
		process.exitCode = 1;
	}
}
