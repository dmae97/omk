import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const preserved = [
	"native/omk-providers/tests/fixtures/anthropic.json",
	"native/omk-providers/tests/fixtures/anthropic-json.json",
	"native/omk-providers/tests/fixtures/anthropic-history.json",
	"native/omk-providers/tests/fixtures/anthropic-tool-history.json",
	"native/omk-providers/Cargo.toml", "native/omk-providers/Cargo.lock",
	"native/omk-contract/tests/fixtures/manifest.json",
];
test("tool history oracle is fresh, ignores inherited credentials and preserves prior corpora", () => {
	const before = preserved.map(read);
	const run = spawnSync(process.execPath, ["scripts/record-anthropic-tool-history-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "synthetic-unused", ANTHROPIC_AUTH_TOKEN: "synthetic-unused", ANTHROPIC_CUSTOM_HEADERS: "authorization: synthetic-unused" },
	});
	assert.equal(run.status, 0, run.stdout + run.stderr);
	assert.match(run.stdout, /25 tool-history requests/);
	assert.deepEqual(preserved.map(read), before);
});
test("Node tool history preserves repairs, grouping, thinking and argument key order", () => {
	const fixture = JSON.parse(read("native/omk-providers/tests/fixtures/anthropic-tool-history.json"));
	const body = (id) => fixture.cases.find((row) => row.id === id).request.body;
	const messages = (id) => JSON.parse(body(id)).messages;
	assert.equal(messages("parallel-tools")[1].content.length, 2);
	assert.equal(messages("missing-at-eof")[1].content.length, 2);
	assert.equal(messages("missing-one-result")[1].content[1].content, "No result provided");
	assert.equal(messages("missing-one-result")[1].content[1].is_error, true);
	assert.equal(messages("error-assistant").length, 1);
	assert.equal(messages("aborted-assistant").length, 1);
	assert.equal(messages("orphan-results").length, 1);
	assert.equal(messages("trim-result-id")[1].content[0].tool_use_id, "call_1");
	assert.equal(messages("same-model-id-unchanged")[0].content[0].id, "call|🌍");
	assert.equal(messages("multiblock-error-result")[1].content[0].content, "First\n\nLast\n🌏");
	assert.equal(messages("signed-thinking")[0].content[0].type, "thinking");
	assert.equal(messages("unsigned-thinking")[0].content[0].type, "text");
	assert.equal(messages("blank-signature")[0].content[0].type, "text");
	assert.equal(messages("empty-thinking").length, 1);
	assert.equal(messages("redacted-thinking")[0].content[0].type, "redacted_thinking");
	assert.ok(body("argument-key-order").includes('"input":{"2":2,"10":10,"z":1,"a":{"second":'));
});
