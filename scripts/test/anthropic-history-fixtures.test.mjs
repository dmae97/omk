import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const preserved = [
	"native/omk-providers/tests/fixtures/anthropic.json",
	"native/omk-providers/tests/fixtures/anthropic-json.json",
	"native/omk-providers/tests/fixtures/anthropic-history.json",
	"native/omk-providers/Cargo.toml", "native/omk-providers/Cargo.lock",
	"native/omk-contract/tests/fixtures/manifest.json",
];

test("text history oracle is fresh, ignores inherited auth, and preserves existing fixtures and locks", () => {
	const before = preserved.map(read);
	const result = spawnSync(process.execPath, ["scripts/record-anthropic-history-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "synthetic-unused", ANTHROPIC_AUTH_TOKEN: "synthetic-unused", ANTHROPIC_CUSTOM_HEADERS: "authorization: synthetic-unused" },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /12 text-history requests/);
	assert.deepEqual(preserved.map(read), before);
});

test("Node records native request shapes and ECMAScript blank filtering without trimming text", () => {
	const fixture = JSON.parse(read("native/omk-providers/tests/fixtures/anthropic-history.json"));
	const messages = (id) => JSON.parse(fixture.cases.find((row) => row.id === id).request.body).messages;
	assert.deepEqual(messages("two-turn"), [
		{ role: "user", content: "First" },
		{ role: "assistant", content: [{ type: "text", text: "Reply" }] },
		{ role: "user", content: "Next" },
	]);
	assert.deepEqual(messages("all-blank"), []);
	assert.equal(messages("blank-assistant").length, 2);
	assert.equal(messages("next-line-is-text")[0].content, "\u0085");
	assert.equal(messages("trim-preserves-content")[0].content[0].text, " \tReply\r\n ");
	assert.equal(messages("consecutive-roles").length, 5);
	assert.equal(messages("js-whitespace").length, 1);
});
