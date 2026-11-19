import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { canTransition } from "../../packages/adaptorch-wpl/src/state-machine.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const document = readFileSync(join(root, "packages/coding-agent/docs/runtime-architecture.md"), "utf8");

function diagram(heading) {
	const section = document.split(heading)[1];
	assert.ok(section, `missing architecture section: ${heading}`);
	const match = section.match(/```mermaid\n([\s\S]*?)```/u);
	assert.ok(match, `missing diagram: ${heading}`);
	return match[1];
}

function edges(source) {
	return [...source.matchAll(/\b(\w+)(?:\[[^\]]*\])?\s*-->\s*(\w+)/gu)].map((match) => [match[1], match[2]]);
}

function assertEdges(actual, expected) {
	assert.deepEqual(
		actual.map((edge) => edge.join(" -> ")).sort(),
		expected.map((edge) => edge.join(" -> ")).sort(),
	);
}

test("the package diagram matches direct workspace dependencies", () => {
	const graph = diagram("## Package boundaries");
	const labels = new Map([...graph.matchAll(/\b(\w+)\[([^\]]+)\]/gu)].map((match) => [match[1], match[2]]));
	const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
		.map((entry) => JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")));
	const names = new Set(packages.map((pkg) => pkg.name));
	assert.deepEqual([...labels.values()].sort(), [...names].sort());
	const expected = packages.flatMap((pkg) =>
		Object.keys(pkg.dependencies ?? {})
			.filter((name) => names.has(name))
			.map((name) => [pkg.name, name]),
	);
	assertEdges(
		edges(graph).map(([from, to]) => [labels.get(from), labels.get(to)]),
		expected,
	);
});

test("the WPL diagram matches every legal runtime transition and declared state", () => {
	const source = readFileSync(join(root, "packages/adaptorch-wpl/src/types.ts"), "utf8");
	const file = ts.createSourceFile("types.ts", source, ts.ScriptTarget.Latest, true);
	const alias = file.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === "WorkPacketState");
	assert.ok(alias && ts.isUnionTypeNode(alias.type), "WorkPacketState must be a literal union");
	const states = alias.type.types.map((node) => {
		assert.ok(ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal));
		return node.literal.text;
	});
	const actual = edges(diagram("### WPL packet lifecycle"));
	assert.deepEqual([...new Set(actual.flat())].sort(), [...states].sort());
	const expected = states.flatMap((from) => states.filter((to) => canTransition(from, to)).map((to) => [from, to]));
	assertEdges(actual, expected);
});

test("diagram parity rejects omitted, duplicated and invented transitions", () => {
	const expected = [["A", "B"]];
	assert.throws(() => assertEdges([], expected));
	assert.throws(() => assertEdges([...expected, ...expected], expected));
	assert.throws(() => assertEdges([["B", "A"]], expected));
});
