import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { canTransition, isTerminalState } from "../../packages/adaptorch-wpl/src/state-machine.ts";
import { reduceDagDependenciesWithDiagnostics } from "../../packages/agent/src/tool-dag-reduce.ts";
import { digestFile, FIXTURE_FILES, ROOT, sourceDigests } from "./verify-fixtures.mjs";

const budgets = [0, 16_777_216];
function encode(graph, n) {
	if (!Array.isArray(graph) || graph.length !== n) throw new Error("Invalid reducer graph row count");
	const rows = [];
	for (let target = 0; target < n; target++) {
		const row = graph[target];
		if (!Object.hasOwn(graph, target) || !Array.isArray(row)) throw new Error("Invalid reducer graph row");
		let previous = -1;
		const values = [];
		for (let i = 0; i < row.length; i++) {
			const value = row[i];
			if (!Object.hasOwn(row, i) || !Number.isSafeInteger(value) || value < 0 || value >= target || value <= previous)
				throw new Error("Invalid reducer predecessor range/order/shape");
			previous = value;
			values.push(value);
		}
		rows.push(values.join(",") || "-");
	}
	return rows.join("/") || "~";
}

function graph(n, predecessors) {
	return Array.from({ length: n }, (_, target) => predecessors(target));
}

function examples() {
	return [
		["chain", graph(16, (i) => (i ? [i - 1] : []))],
		["diamond", [[], [0], [0], [0, 1, 2]]],
		["layered", graph(24, (i) => Array.from({ length: Math.floor(i / 6) * 6 }, (_, p) => p))],
		["dense", graph(20, (i) => Array.from({ length: i }, (_, p) => p))],
		["disconnected", graph(12, (i) => Array.from({ length: i % 4 }, (_, p) => i - (i % 4) + p))],
		["word32", graph(34, (i) => ({ 30: [0], 31: [0], 32: [0, 30, 31], 33: [0, 30, 31, 32] })[i] ?? [])],
		[
			"word64",
			graph(66, (i) => ({ 31: [0], 32: [0], 63: [0, 31, 32], 64: [31, 32, 63], 65: [0, 31, 32, 63, 64] })[i] ?? []),
		],
	];
}

function dagRows() {
	const rows = [];
	let id = 0;
	function add(kind, mask, input) {
		for (const budget of budgets) {
			const result = reduceDagDependenciesWithDiagnostics(input, { maxClosureBytes: budget });
			rows.push([
				id,
				kind,
				input.length,
				mask,
				budget,
				encode(input, input.length),
				encode(result.dependencies, input.length),
				result.diagnostics.strategy,
				result.diagnostics.closureBytes,
			]);
		}
		id++;
	}
	add("empty", -1, []);
	for (let n = 1; n <= 5; n++) {
		for (let mask = 0; mask < 2 ** ((n * (n - 1)) / 2); mask++) {
			let bit = 0;
			const input = graph(n, (target) => {
				const row = [];
				for (let p = 0; p < target; p++, bit++) if (mask & (1 << bit)) row.push(p);
				return row;
			});
			add("exhaustive", mask, input);
		}
	}
	for (const [kind, input] of examples()) add(kind, -1, input);
	return rows;
}

function memoryRows() {
	const rows = [];
	for (const n of [4, 31, 32, 33, 64, 512, 16_369, 16_370]) {
		const input = graph(n, (i) => (i === 3 ? [0, 1, 2] : i === 2 ? [0] : i ? [i - 1] : []));
		let sumBytes = 0;
		for (let i = 0; i < n; i++) sumBytes += 4 * Math.ceil(i / 32);
		for (const budget of budgets) {
			const result = reduceDagDependenciesWithDiagnostics(input, { maxClosureBytes: budget });
			rows.push([
				n,
				budget,
				sumBytes,
				result.diagnostics.strategy,
				result.diagnostics.closureBytes,
				encode(input, input.length),
				encode(result.dependencies, input.length),
			]);
		}
	}
	return rows;
}

function invalidRows() {
	const invalid = [
		["nonarray_graph", null, 0],
		["sparse_rows", new Array(2), 0],
		["nonarray_row", [[], {}], 0],
		["sparse_predecessors", [[], new Array(1)], 0],
		["duplicate", [[], [0, 0]], 0],
		["unsorted", [[], [], [1, 0]], 0],
		["future", [[], [2], []], 0],
		["self", [[0]], 0],
		["negative", [[], [-1]], 0],
		["fractional", [[], [0.5]], 0],
		["budget_negative", [[], [0]], -1],
		["budget_fractional", [[], [0]], 0.5],
		["budget_nan", [[], [0]], Number.NaN],
		["budget_infinity", [[], [0]], Number.POSITIVE_INFINITY],
		["budget_overcap", [[], [0]], 16_777_217],
	];
	return invalid.map(([name, input, budget]) => {
		try {
			reduceDagDependenciesWithDiagnostics(input, { maxClosureBytes: budget });
			return [name, 1, "none"];
		} catch (error) {
			return [name, 0, error.constructor.name];
		}
	});
}

function wplRows() {
	const source = ts.createSourceFile(
		"types.ts",
		readFileSync(join(ROOT, "packages/adaptorch-wpl/src/types.ts"), "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const declaration = source.statements.find(
		(node) => ts.isTypeAliasDeclaration(node) && node.name.text === "WorkPacketState",
	);
	if (!declaration || !ts.isUnionTypeNode(declaration.type) || source.parseDiagnostics.length) {
		throw new Error("WorkPacketState must be a parseable literal union");
	}
	const states = declaration.type.types.map((node) => {
		if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal) || !/^[A-Z_]+$/.test(node.literal.text)) {
			throw new Error("WorkPacketState contains a non-enum literal");
		}
		return node.literal.text;
	});
	if (states.length === 0 || new Set(states).size !== states.length)
		throw new Error("Empty or duplicate WorkPacketState");
	return states.flatMap((from) =>
		states.map((to) => [from, to, Number(canTransition(from, to)), Number(isTerminalState(from))]),
	);
}

function produceFixtures(directory) {
	const bundle = resolve(directory);
	const inputs = sourceDigests();
	const tables = [
		[["graph_id", "kind", "n", "mask", "budget", "predecessors", "reduced", "strategy", "closure_bytes"], dagRows()],
		[["n", "budget", "sum_bytes", "strategy", "closure_bytes", "predecessors", "reduced"], memoryRows()],
		[["case", "accepted", "error_class"], invalidRows()],
		[["from", "to", "allowed", "terminal"], wplRows()],
	];
	for (const [i, [header, rows]] of tables.entries()) {
		writeFileSync(join(bundle, FIXTURE_FILES[i]), `${[header, ...rows].map((row) => row.join("\t")).join("\n")}\n`, {
			flag: "wx",
		});
	}
	if (JSON.stringify(sourceDigests()) !== JSON.stringify(inputs))
		throw new Error("Sources changed during fixture export");
	return bundle;
}

export function exportFixtures(directory) {
	const bundle = resolve(directory);
	mkdirSync(bundle);
	// Bind disk bytes before the fresh process evaluates any producer imports.
	// Cached callers never produce fixtures; snapshots assume no ABA/hostile writer.
	const inputs = sourceDigests();
	const result = spawnSync(
		process.execPath,
		["--experimental-strip-types", fileURLToPath(import.meta.url), "--produce", bundle],
		{
			encoding: "utf8",
			timeout: 120_000,
			killSignal: "SIGKILL",
			maxBuffer: 4 * 1024 * 1024,
			env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
		},
	);
	if (result.error) throw new Error(`Fixture producer unavailable or failed: ${result.error.message}`);
	if (result.status !== 0)
		throw new Error(`Fixture producer failed (${result.status}, ${result.signal}): ${result.stdout}${result.stderr}`);
	if (JSON.stringify(sourceDigests()) !== JSON.stringify(inputs))
		throw new Error("Sources changed across fixture producer launch");
	if (result.stdout !== `PRODUCED ${bundle}\n`) throw new Error("Fixture producer did not return its required receipt");
	const fixtures = Object.fromEntries(FIXTURE_FILES.map((file) => [file, digestFile(join(bundle, file))]));
	writeFileSync(join(bundle, "manifest.json"), `${JSON.stringify({ version: 1, inputs, fixtures }, null, 2)}\n`, {
		flag: "wx",
	});
	return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length === 4 && process.argv[2] === "--produce") {
			console.log(`PRODUCED ${produceFixtures(process.argv[3])}`);
		} else if (process.argv.length === 3) {
			console.log(`EXPORTED ${exportFixtures(process.argv[2])}`);
		} else {
			throw new Error(
				"Usage: node --experimental-strip-types scripts/architecture/export-fixtures.mjs <new-bundle>",
			);
		}
	} catch (error) {
		console.error(`FAIL ${error.message}`);
		process.exitCode = 1;
	}
}
