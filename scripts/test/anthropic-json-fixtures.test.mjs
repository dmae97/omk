import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inventory } from "../fixtures/contract-fixture-utils.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const corpus = () => JSON.parse(read("native/omk-providers/tests/fixtures/anthropic-json.json"));

test("JSON oracle is fresh under isolated auth and leaves the original provider and K0 corpora unchanged", () => {
	const provider = read("native/omk-providers/tests/fixtures/anthropic.json");
	const own = read("native/omk-providers/tests/fixtures/anthropic-json.json");
	const directory = fileURLToPath(new URL("../../native/omk-contract/tests/fixtures/", import.meta.url));
	const before = inventory(directory);
	const manifest = read("native/omk-contract/tests/fixtures/manifest.json");
	const result = spawnSync(process.execPath, ["scripts/record-anthropic-json-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "synthetic-unused", ANTHROPIC_AUTH_TOKEN: "synthetic-unused", ANTHROPIC_CUSTOM_HEADERS: "authorization: synthetic-unused" },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /331 JSON observations, 17 streams/);
	assert.equal(read("native/omk-providers/tests/fixtures/anthropic.json"), provider);
	assert.equal(read("native/omk-providers/tests/fixtures/anthropic-json.json"), own);
	assert.deepEqual(inventory(directory), before);
	assert.equal(read("native/omk-contract/tests/fixtures/manifest.json"), manifest);
});

test("captured Node semantics include repair order, partial prefixes, nullish fallback and prototype keys", () => {
	const fixture = corpus();
	assert.equal(fixture.schema, "omk.anthropic.json.v1");
	assert.equal(fixture.values.length, 331);
	const value = (input) => fixture.values.find((row) => row.input === input);
	assert.deepEqual(value("nu").streaming, {});
	assert.equal(value("null").streaming, null);
	assert.equal(value("tr").streaming, true);
	assert.equal(value("12e").streaming, 12);
	assert.deepEqual(value("\uFEFFnu").streaming, {});
	const stream = (id) => fixture.streams.find((row) => row.id === id);
	assert.deepEqual(stream("repair-tool").toolArguments[1].arguments, {});
	assert.deepEqual(stream("repair-tool").result.content[0].arguments, { path: "A\\H", text: "col1\tcol2" });
	for (const id of ["eof-tool", "cancel-tool", "error-tool"])
		assert.deepEqual(stream(id).result.content[0].arguments, { path: "part" });
	assert.equal(stream("cancel-tool").result.stopReason, "aborted");
	assert.deepEqual(stream("prototype-key").result.content[0].arguments, { safe: 1 });
	assert.equal(({}).polluted, undefined);
	assert.equal(stream("raw-sse-invalid").result.stopReason, "error");
});

test("copied MIT parser attribution ships separately without changing the B1 notice digest", () => {
	const notice = read("native/omk-providers/PARTIAL-JSON-NOTICE.md");
	assert.ok(notice.includes(read("node_modules/partial-json/LICENSE").trim()));
	assert.match(notice, /partial-json.*0\.1\.7/);
	assert.match(notice, /promplate\/partial-json-parser-js/);
});
