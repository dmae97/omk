import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRustBundle } from "../contracts/artifacts.mjs";
import { COMPAT_TABLE, checkCompatTable, renderCompatTable } from "../contracts/compat-table.mjs";

let cached;
const bundle = () => (cached ??= readRustBundle());

test("the Node core compatibility table is regenerated from the Rust crate without a diff", () => {
	const text = renderCompatTable(bundle().compat);
	assert.equal(readFileSync(COMPAT_TABLE, "utf8"), text);
	assert.match(text, /^\/\/ Generated from native\/omk-contract\/src\/compat\.rs\. Do not edit\./);
	assert.equal(renderCompatTable(bundle().compat), text);
});

test("a hand edit of the generated table fails the drift check", () => {
	const dir = mkdtempSync(join(tmpdir(), "omk-compat-drift-"));
	const path = join(dir, "pi-compat.ts");
	try {
		const text = renderCompatTable(bundle().compat);
		writeFileSync(path, text);
		checkCompatTable(path, text);
		writeFileSync(path, text.replace('"ai-oauth"', '"ai"'));
		assert.throws(() => checkCompatTable(path, text), /compatibility table drift/);
		rmSync(path);
		assert.throws(() => checkCompatTable(path, text), /missing/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Rust table values, not template text, decide the generated aliases and hint", () => {
	const compat = structuredClone(bundle().compat);
	compat.aliases = compat.aliases.map(([specifier, target]) =>
		specifier.endsWith("/pi-tui") ? [specifier, "coding-agent"] : [specifier, target],
	);
	compat.hint = " (changed hint)";
	const text = renderCompatTable(compat);
	assert.match(text, /`\$\{namespace\}\/pi-tui`, "coding-agent"/);
	assert.match(text, /" \(changed hint\)"/);
});

test("alias tables the namespace form cannot express and unsafe values fail closed", () => {
	for (const mutate of [
		(c) => (c.aliases = c.aliases.slice(1)),
		(c) => (c.aliases[0] = [c.aliases[0][0], "unknown-target"]),
		(c) => (c.aliases[0] = [`${c.aliases[0][0]}"`, c.aliases[0][1]]),
		(c) => (c.classifierNamespaces = ["mariozechner|.*"]),
		(c) => (c.legacyPackages = []),
		(c) => (c.dialects = ["omk"]),
		(c) => (c.hint = 7),
	]) {
		const compat = structuredClone(bundle().compat);
		mutate(compat);
		assert.throws(() => renderCompatTable(compat), /compatibility table/);
	}
});
