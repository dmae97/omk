import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { reduceDagDependenciesWithDiagnostics } from "../../packages/agent/src/tool-dag-reduce.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const exporter = join(root, "scripts/architecture/export-fixtures.mjs");
const verifier = join(root, "scripts/architecture/verify-fixtures.mjs");
const fixtures = ["dag.tsv", "memory.tsv", "invalid.tsv", "wpl.tsv"];
const rscript = process.env.OMK_RSCRIPT;
const rOptions = { skip: rscript ? false : "OMK_RSCRIPT not set; actual TS/R parity and R negative controls SKIP" };
let owned;
let template;

function cli(script, path, executable = rscript) {
	return spawnSync(process.execPath, ["--experimental-strip-types", script, path], {
		cwd: root,
		encoding: "utf8",
		timeout: 120_000,
		maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, OMK_RSCRIPT: executable ?? "" },
	});
}

function success(result) {
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stdout + result.stderr);
}

function failure(result, message) {
	assert.equal(result.error, undefined);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, message);
	assert.doesNotMatch(result.stdout, /VERIFIED/);
}

function fresh(t) {
	const dir = mkdtempSync(join(owned, "case-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "bundle");
	cpSync(template, path, { recursive: true });
	return path;
}

function manifest(path, change) {
	const file = join(path, "manifest.json");
	const data = JSON.parse(readFileSync(file, "utf8"));
	change(data);
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function mutate(path, file, change, rebind = true) {
	const target = join(path, file);
	const rows = readFileSync(target, "utf8")
		.trimEnd()
		.split("\n")
		.map((row) => row.split("\t"));
	change(rows);
	writeFileSync(target, `${rows.map((row) => row.join("\t")).join("\n")}\n`);
	if (rebind) {
		manifest(path, (data) => {
			data.fixtures[file] = createHash("sha256").update(readFileSync(target)).digest("hex");
		});
	}
}

before(() => {
	owned = mkdtempSync(join(tmpdir(), "omk-architecture-oracle-"));
	template = join(owned, "original");
	success(cli(exporter, template));
});
after(() => {
	if (owned) rmSync(owned, { recursive: true, force: true });
});

test("actual exported corpus covers word32 and word64 reductions across word boundaries", () => {
	const rows = readFileSync(join(template, "dag.tsv"), "utf8")
		.trimEnd()
		.split("\n")
		.slice(1)
		.map((row) => row.split("\t"));
	for (const [kind, n, inputs, outputs, bytes] of [
		[
			"word32",
			34,
			{ 30: [0], 31: [0], 32: [0, 30, 31], 33: [0, 30, 31, 32] },
			{ 30: [0], 31: [0], 32: [30, 31], 33: [32] },
			136,
		],
		[
			"word64",
			66,
			{ 31: [0], 32: [0], 63: [0, 31, 32], 64: [31, 32, 63], 65: [0, 31, 32, 63, 64] },
			{ 31: [0], 32: [0], 63: [31, 32], 64: [63], 65: [64] },
			396,
		],
	]) {
		const pair = rows.filter((row) => row[1] === kind);
		assert.equal(pair.length, 2, `missing ${kind} under both budgets`);
		assert.deepEqual(pair.map((row) => Number(row[4])).sort((a, b) => a - b), [0, 16_777_216]);
		assert.equal(new Set(pair.map((row) => row[0])).size, 1);
		const input = Array.from({ length: n }, (_, i) => inputs[i] ?? []);
		const output = Array.from({ length: n }, (_, i) => outputs[i] ?? []);
		for (const row of pair) {
			assert.equal(Number(row[2]), n);
			assert.equal(row[3], "-1");
			assert.deepEqual(row[5].split("/"), input.map((ps) => ps.join(",") || "-"));
			assert.deepEqual(row[6].split("/"), output.map((ps) => ps.join(",") || "-"));
			const budget = Number(row[4]);
			const actual = reduceDagDependenciesWithDiagnostics(input, { maxClosureBytes: budget });
			assert.deepEqual(actual.dependencies, output);
			assert.equal(actual.diagnostics.strategy, budget ? "bitset" : "traversal");
			assert.equal(actual.diagnostics.closureBytes, budget ? bytes : 0);
			assert.ok(budget ? actual.diagnostics.wordUnions > 0 : actual.diagnostics.traversalVisits > 0);
			assert.equal(row[7], actual.diagnostics.strategy);
			assert.equal(Number(row[8]), actual.diagnostics.closureBytes);
		}
	}
});

test("actual exporter produces deterministic fixtures and refuses overwrite", (t) => {
	const dir = mkdtempSync(join(owned, "export-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const second = join(dir, "second");
	success(cli(exporter, second));
	for (const file of [...fixtures, "manifest.json"]) {
		assert.deepEqual(readFileSync(join(second, file)), readFileSync(join(template, file)));
	}
	const old = readFileSync(join(second, "dag.tsv"));
	failure(cli(exporter, second), /exist/i);
	assert.deepEqual(readFileSync(join(second, "dag.tsv")), old);
	const data = JSON.parse(readFileSync(join(second, "manifest.json"), "utf8"));
	assert.deepEqual(Object.keys(data.fixtures).sort(), [...fixtures].sort());
	for (const file of fixtures) {
		assert.equal(
			data.fixtures[file],
			createHash("sha256")
				.update(readFileSync(join(second, file)))
				.digest("hex"),
		);
	}
	assert.equal(readFileSync(join(second, "dag.tsv"), "utf8").trimEnd().split("\n").length - 1, 2214);
	assert.equal(readFileSync(join(second, "memory.tsv"), "utf8").trimEnd().split("\n").length - 1, 16);
	assert.equal(readFileSync(join(second, "wpl.tsv"), "utf8").trimEnd().split("\n").length - 1, 196);
});

test("verifier fails when the R executable is unavailable", (t) => {
	failure(cli(verifier, fresh(t), join(owned, "no-such-Rscript")), /R executable unavailable/);
});
for (const status of [0, 1]) {
	test(`verifier rejects R process status ${status} without the required receipt`, (t) => {
		const path = fresh(t);
		const wrapper = join(path, "no-receipt.mjs");
		writeFileSync(wrapper, `#!${process.execPath}\nprocess.exit(${status});\n`, { mode: 0o700 });
		failure(cli(verifier, path, wrapper), status ? /R oracle failed/ : /required bounded PASS receipt/);
	});
}

function sandbox(t, files = {}) {
	const path = mkdtempSync(join(owned, "source-"));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	for (const file of Object.keys(JSON.parse(readFileSync(join(template, "manifest.json"), "utf8")).inputs)) {
		mkdirSync(dirname(join(path, file)), { recursive: true });
		cpSync(join(root, file), join(path, file));
	}
	symlinkSync(join(root, "node_modules"), join(path, "node_modules"), "dir");
	for (const [file, source] of Object.entries(files)) writeFileSync(join(path, file), source);
	return path;
}
const stateFile = "packages/adaptorch-wpl/src/state-machine.ts";
const mutatePredicate = `const file = new URL('./${stateFile}', import.meta.url);
const source = readFileSync(file, 'utf8');
assert.ok(source.includes('return TRANSITIONS[from].includes(to);'));
writeFileSync(file, source.replace('return TRANSITIONS[from].includes(to);', 'return false;'));`;
const ioImports = `import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';`;
for (const cached of ["exporter", "runtime before exporter"]) {
	test(`F1 fresh producer ignores cached ${cached}`, (t) => {
		const preload = `${ioImports}\nimport {canTransition} from './${stateFile}';
assert.equal(canTransition('DRAFTED', 'ROUTED'), true);\n${mutatePredicate}`;
		const path = sandbox(t, {
			"preload.mjs": preload,
			"driver.mjs": `${ioImports}
${cached === "exporter" ? "" : "import './preload.mjs';"}
import {exportFixtures} from './scripts/architecture/export-fixtures.mjs';
${cached === "exporter" ? mutatePredicate : ""}
console.log(exportFixtures(new URL('./bundle', import.meta.url).pathname));`,
		});
		const result = cli(join(path, "driver.mjs"), "unused");
		if (result.status !== 0) {
			assert.equal(existsSync(join(path, "bundle/manifest.json")), false);
			return failure(result, /Sources changed/);
		}
		success(result);
		if (rscript)
			failure(cli(join(path, "scripts/architecture/verify-fixtures.mjs"), join(path, "bundle")), /WPL transitions/);
		assert.match(readFileSync(join(path, "bundle/wpl.tsv"), "utf8"), /^DRAFTED\tROUTED\t0\t0$/m);
	});
}
for (const timing of ["before", "after"]) {
	test(`F1 rejects source drift ${timing} the actual producer launch`, (t) => {
		const path = sandbox(t, {
			"driver.mjs": `${ioImports}
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {exportFixtures} from './scripts/architecture/export-fixtures.mjs';
const original = childProcess.spawnSync;
const drift = () => { ${mutatePredicate} };
childProcess.spawnSync = (...args) => {
  ${timing === "before" ? "drift();" : ""}
  const result = original(...args);
  ${timing === "after" ? "drift();" : ""}
  return result;
};
syncBuiltinESMExports();
assert.throws(() => exportFixtures(new URL('./bundle', import.meta.url).pathname), /Sources changed/);
assert.equal(existsSync(new URL('./bundle/manifest.json', import.meta.url)), false);`,
		});
		success(cli(join(path, "driver.mjs"), "unused"));
	});
}
test("fresh producer does not inherit caller preloads or recursively relaunch", (t) => {
	const path = sandbox(t, {
		"poison.mjs": "throw new Error('caller preload propagated');\n",
		"driver.mjs": `import {exportFixtures} from './scripts/architecture/export-fixtures.mjs';
const poison = new URL('./poison.mjs', import.meta.url).pathname;
process.env.NODE_OPTIONS = '--import ' + poison;
process.execArgv.push('--import', poison);
console.log(exportFixtures(new URL('./bundle', import.meta.url).pathname));`,
	});
	success(cli(join(path, "driver.mjs"), "unused"));
	assert.ok(existsSync(join(path, "bundle/manifest.json")));
});
for (const [shape, replacement] of [
	["nonarray graph", "({})"],
	["extra populated row", "[...reduced, []]"],
	["extra sparse row", "Object.assign(new Array(n + 1), reduced)"],
	["sparse row", "Object.assign(new Array(n), {0: [], 2: [1]})"],
	["nonarray row", "[[], {}, [1]]"],
	["sparse predecessor", "[[], [0], new Array(1)]"],
]) {
	test(`F2 exporter rejects actual reducer returning ${shape}`, (t) => {
		const path = sandbox(t);
		const file = join(path, "packages/agent/src/tool-dag-reduce.ts");
		const source = readFileSync(file, "utf8");
		assert.ok(source.includes("dependencies: reduced,"));
		writeFileSync(file, source.replace("dependencies: reduced,", `dependencies: n === 3 ? ${replacement} : reduced,`));
		failure(
			cli(join(path, "scripts/architecture/export-fixtures.mjs"), join(path, "bundle")),
			/Invalid reducer (graph|predecessor)/,
		);
		assert.equal(existsSync(join(path, "bundle/manifest.json")), false);
	});
}

function nodeControl(name, change, message) {
	test(`Node integrity gate rejects ${name} before starting R`, (t) => {
		const path = fresh(t);
		change(path);
		const result = cli(verifier, path, join(owned, "must-not-start-R"));
		failure(result, message);
		assert.doesNotMatch(result.stdout + result.stderr, /R executable unavailable|R ORACLE/);
	});
}
for (const [name, change, message] of [
	[
		"stale source digest",
		(m) => Object.assign(m.inputs, { "packages/agent/src/tool-dag-reduce.ts": "0".repeat(64) }),
		/source digest/,
	],
	["manifest path traversal", (m) => Object.assign(m.fixtures, { "../dag.tsv": m.fixtures["dag.tsv"] }), /manifest/],
	["missing source binding", (m) => delete m.inputs["scripts/architecture/verify-fixtures.R"], /manifest/],
	["invalid digest syntax", (m) => Object.assign(m.fixtures, { "dag.tsv": "not-a-digest" }), /manifest/],
	["unexpected schema", (m) => Object.assign(m, { version: 2 }), /manifest/],
])
	nodeControl(name, (path) => manifest(path, change), message);
nodeControl("malformed manifest", (p) => writeFileSync(join(p, "manifest.json"), "{"), /manifest/);
nodeControl(
	"raw hash tamper",
	(p) => mutate(p, "dag.tsv", (r) => Object.assign(r[1], { 8: "traversal" }), false),
	/fixture digest/,
);
nodeControl("missing fixture", (p) => rmSync(join(p, "memory.tsv")), /memory.tsv/);

test("actual TypeScript fixtures pass the independent base R CLI oracle", rOptions, (t) => {
	const result = cli(verifier, fresh(t));
	success(result);
	assert.match(result.stdout, /R ORACLE R version/);
	assert.match(result.stdout, /PASS graphs=1107 dag_cases=2214 memory_cases=16 invalid_cases=15 states=14 pairs=196/);
	assert.match(result.stdout, /VERIFIED/);
});

const dagRow = (rows) =>
	rows.find((row) => row[1] === "exhaustive" && row[2] === "3" && row[3] === "7" && row[4] === "0");
for (const [name, file, change, message] of [
	["missing essential edge", "dag.tsv", (r) => Object.assign(dagRow(r), { 6: "-/-/1" }), /DAG closure/],
	["redundant extra edge", "dag.tsv", (r) => Object.assign(dagRow(r), { 6: "-/0/0,1" }), /DAG minimality/],
	...[
		["word64 missing essential 63->64 edge", 64, "-", /DAG closure preservation/],
		["word64 redundant 63->65 edge", 65, "63,64", /DAG minimality redundant edge/],
	].map(([name, target, predecessors, message]) => [
		name,
		"dag.tsv",
		(rows) => {
			const identities = rows.map((row) => row.slice(0, 6));
			const pair = rows.filter((row) => row[1] === "word64");
			assert.equal(pair.length, 2);
			for (const row of pair) {
				const output = row[6].split("/");
				output[target] = predecessors;
				row[6] = output.join("/");
			}
			assert.deepEqual(rows.map((row) => row.slice(0, 6)), identities);
		},
		message,
	]),
	["out-of-range predecessor", "dag.tsv", (r) => Object.assign(dagRow(r), { 6: "-/0/3" }), /predecessors/],
	["wrong row count", "dag.tsv", (r) => Object.assign(dagRow(r), { 6: "-/0" }), /row count/],
	...["-/0/1/", "-/0/1//", "-/0/1/-", "/-/0/1", "-//0/1", "-/0/1,", "-/0/,1", "-/0/0,,1"].map((text) => [
		`noncanonical graph ${text}`,
		"dag.tsv",
		(rows) => {
			for (const row of rows.filter((r) => r[1] === "exhaustive" && r[2] === "3" && r[3] === "7")) row[6] = text;
		},
		/DAG (canonical|row|predecessors)/,
	]),
	[
		"renamed duplicate graph substitution",
		"dag.tsv",
		(rows) => {
			const identities = rows.map((row) => row.slice(0, 5));
			for (const row of rows.filter((r) => r[1] === "exhaustive" && r[2] === "3" && r[3] === "7")) {
				const duplicate = rows.find((r) => r[1] === "exhaustive" && r[2] === "3" && r[3] === "3" && r[4] === row[4]);
				row.splice(5, 4, ...duplicate.slice(5));
			}
			assert.deepEqual(rows.map((row) => row.slice(0, 5)), identities);
		},
		/DAG coverage mask identity/,
	],
	[
		"over-cap allocation",
		"memory.tsv",
		(r) =>
			Object.assign(
				r.find((x) => x[0] === "16370" && x[1] === "16777216"),
				{ 4: "16779264" },
			),
		/memory allocation/,
	],
	["wrong direct sum", "memory.tsv", (r) => Object.assign(r[1], { 2: "0" }), /memory formula/],
	[
		"unexpected WPL transition",
		"wpl.tsv",
		(r) =>
			Object.assign(
				r.find((x) => x[0] === "CLOSED" && x[1] === "DRAFTED"),
				{ 2: "1" },
			),
		/WPL transitions/,
	],
	[
		"wrong terminal state",
		"wpl.tsv",
		(r) =>
			Object.assign(
				r.find((x) => x[0] === "ESCALATED"),
				{ 3: "1" },
			),
		/WPL terminal/,
	],
	["removed exhaustive case", "dag.tsv", (r) => r.splice(1, 1), /DAG coverage/],
	["duplicate case", "dag.tsv", (r) => r.push([...r[1]]), /DAG duplicate/],
	["removed WPL pair", "wpl.tsv", (r) => r.splice(1, 1), /WPL coverage/],
	["accepted invalid JS input", "invalid.tsv", (r) => Object.assign(r[1], { 1: "1", 2: "none" }), /invalid rejection/],
]) {
	test(`hash-rebound semantic control reaches R and rejects ${name}`, rOptions, (t) => {
		const path = fresh(t);
		mutate(path, file, change);
		const result = cli(verifier, path);
		failure(result, message);
		assert.match(result.stdout, /R ORACLE R version/);
		assert.doesNotMatch(result.stderr, /fixture digest|source digest/);
	});
}

test("post-R recheck rejects a bundle changed after the real oracle passed", rOptions, (t) => {
	const path = fresh(t);
	const wrapper = join(path, "r-wrapper.mjs");
	writeFileSync(
		wrapper,
		`#!${process.execPath}\nimport {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const r=spawnSync(${JSON.stringify(rscript)},process.argv.slice(2),{encoding:'utf8'});
process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '');
if(r.status===0) appendFileSync(${JSON.stringify(join(path, "dag.tsv"))},'\\n');
process.exit(r.status ?? 1);\n`,
		{ mode: 0o700 },
	);
	const result = cli(verifier, path, wrapper);
	failure(result, /fixture digest/);
	assert.match(result.stdout, /PASS graphs=1107/);
});
