import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../", import.meta.url));
const oracle = join(source, "scripts/architecture/verify-execution-budget.R");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function verifyExecutionBudget(directory, executable, rscript) {
	assert(rscript, "OMK_RSCRIPT must name a real R executable");
	const work = resolve(directory);
	const binary = resolve(executable);
	mkdirSync(work);
	const files = [oracle, binary, join(source, "native/omk-execution/src/budget.rs"), join(source, "native/omk-execution/src/bin/budget-fixtures.rs"), fileURLToPath(import.meta.url)];
	const before = files.map((path) => ({ path, sha256: sha(path) }));
	const events = [0, 1, 3].flatMap((elapsed) => [0, 1, 3].map((bytes) => `${elapsed},${bytes}`));
	const rows = [];
	for (const timeout of [1, 3, 10]) for (const limit of [0, 2, 8]) {
		for (const a of events) for (const b of events) for (const c of events) rows.push([`t${rows.length}`, timeout, limit, `${a};${b};${c}`]);
	}
	for (const row of [
		[86400000, 16777216, "0,16777216;1,0;86399999,1;86400000,0"],
		[86400000, 16777216, "0,9007199254740991;1,0;2,0"],
		[86400000, 0, "0,0;86400000,0;86400001,1"],
		[3, 2, "0,2;1,1;3,0"],
		[3, 2, "2,1;1,1;3,1"],
	]) rows.push([`t${rows.length}`, ...row]);
	const input = `${rows.map((row) => row.join("\t")).join("\n")}\n`;
	const inputPath = join(work, "input.tsv");
	writeFileSync(inputPath, input, { flag: "wx" });
	const env = { PATH: process.env.PATH, HOME: work, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", LANG: "C.UTF-8" };
	const rust = spawnSync(binary, [], { input, env, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
	writeFileSync(join(work, "rust.tsv"), rust.stdout ?? "", { flag: "wx" });
	writeFileSync(join(work, "rust.stderr.log"), rust.stderr ?? "", { flag: "wx" });
	assert(!rust.error && rust.status === 0, "Rust budget probe failed");
	assert.equal(rust.stdout.trim().split("\n").length, rows.length, "missing budget traces");
	assert.match(rust.stdout, /continue,2;output_limit,2;output_limit,2/);
	const check = (name, resultPath) => {
		const result = spawnSync(rscript, ["--vanilla", oracle, inputPath, resultPath], { env, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
		writeFileSync(join(work, `${name}.stdout.log`), result.stdout ?? "", { flag: "wx" });
		writeFileSync(join(work, `${name}.stderr.log`), result.stderr ?? "", { flag: "wx" });
		assert(!result.error, "R executable unavailable");
		return result;
	};
	const r = check("oracle", join(work, "rust.tsv"));
	assert.equal(r.status, 0, r.stderr);
	assert(r.stdout.includes(`PASS traces=${rows.length} exact_integer_decisions=true`), "missing R acceptance receipt");
	const changed = rust.stdout.replace("continue,0", "deadline,0");
	assert.notEqual(changed, rust.stdout);
	writeFileSync(join(work, "mutant.tsv"), changed, { flag: "wx" });
	const mutant = check("negative-control", join(work, "mutant.tsv"));
	assert.notEqual(mutant.status, 0, "R accepted a changed decision");
	assert.match(mutant.stderr, /oracle mismatch/);
	assert.deepEqual(files.map((path) => ({ path, sha256: sha(path) })), before, "source/binary changed");
	const receipt = { status: "pass", traces: rows.length, exactIntegers: true, negativeControl: "rejected", inputSha256: sha(inputPath), outputSha256: sha(join(work, "rust.tsv")), sources: before, r: r.stdout.trim() };
	writeFileSync(join(work, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
	return receipt;
}
if (import.meta.main) {
	try {
		assert.equal(process.argv.length, 4, "Usage: verify-execution-budget.mjs NEW_DIRECTORY BUDGET_BINARY");
		console.log(JSON.stringify(verifyExecutionBudget(process.argv[2], process.argv[3], process.env.OMK_RSCRIPT)));
	} catch (error) { console.error(error.message); process.exitCode = 1; }
}
