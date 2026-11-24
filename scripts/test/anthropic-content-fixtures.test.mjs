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
	"native/omk-providers/tests/fixtures/anthropic-content.json",
	"native/omk-providers/Cargo.toml", "native/omk-providers/Cargo.lock",
	"native/omk-contract/tests/fixtures/manifest.json",
];
test("content oracle is fresh, credential-isolated and preserves every existing corpus", () => {
	const before = preserved.map(read);
	const run = spawnSync(process.execPath, ["scripts/record-anthropic-content-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "synthetic-unused", ANTHROPIC_AUTH_TOKEN: "synthetic-unused", ANTHROPIC_CUSTOM_HEADERS: "authorization: synthetic-unused" },
	});
	assert.equal(run.status, 0, run.stdout + run.stderr);
	assert.match(run.stdout, /26 content requests/);
	assert.deepEqual(preserved.map(read), before);
});
test("Node distinguishes user arrays from joined tool text and downgrades images before blank filtering", () => {
	const fixture = JSON.parse(read("native/omk-providers/tests/fixtures/anthropic-content.json"));
	const messages = (id) => JSON.parse(fixture.cases.find((row) => row.id === id).request.body).messages;
	const userPlaceholder = "(image omitted: model does not support images)";
	const toolPlaceholder = "(tool image omitted: model does not support images)";
	assert.equal(messages("user-empty-array").length, 1);
	assert.equal(messages("user-blank-array").length, 1);
	assert.deepEqual(messages("user-text-array")[0].content.map((b) => b.text), ["First 한글", "Second 🌏"]);
	assert.deepEqual(messages("user-ecma-whitespace")[0].content, [{ type: "text", text: "\u0085" }]);
	assert.deepEqual(messages("user-adjacent-images")[0].content, [{ type: "text", text: userPlaceholder }]);
	assert.equal(messages("user-placeholder-before")[0].content.length, 1);
	assert.equal(messages("user-placeholder-after")[0].content.length, 2);
	assert.equal(messages("user-blank-between-images")[0].content.length, 2);
	assert.equal(messages("user-mime-data-ignored")[0].content[0].text, userPlaceholder);
	assert.equal(messages("tool-empty-array")[1].content[0].content, "");
	assert.equal(messages("tool-blank-array")[1].content[0].content, "\n \t\n\uFEFF");
	assert.equal(messages("tool-text-array")[1].content[0].content, "First\n\nLast 한글");
	assert.equal(messages("tool-adjacent-images")[1].content[0].content, toolPlaceholder);
	assert.equal(messages("tool-placeholder-before")[1].content[0].content, toolPlaceholder);
	assert.equal(messages("tool-placeholder-after")[1].content[0].content, `${toolPlaceholder}\n${toolPlaceholder}`);
	assert.equal(messages("tool-blank-between-images")[1].content[0].content, `${toolPlaceholder}\n\n${toolPlaceholder}`);
	assert.equal(messages("tool-grouped-images")[1].content.length, 2);
	assert.equal(messages("array-interrupts-tool")[1].content[0].content, "No result provided");
	assert.equal(messages("blank-array-separates-results").length, 4);
	assert.equal(messages("orphan-image").length, 1);
	assert.equal(messages("failed-assistant-image").length, 1);
	for (const row of fixture.cases) assert.ok(!row.request.body.includes('"type":"image"'));
});
