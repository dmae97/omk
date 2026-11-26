import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("native/omk-providers/tests/fixtures/anthropic-vision.json", root), "utf8"));
test("vision oracle is independent, synthetic and source pinned", () => {
	assert.equal(fixture.schema, "omk.anthropic.vision.v1");
	assert.equal(fixture.cases.length, 50);
	assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, 50);
	for (const [path, digest] of Object.entries(fixture.source)) {
		assert.equal(createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex"), digest, path);
	}
	for (const entry of fixture.cases) {
		assert.equal(entry.request.url, "https://synthetic.invalid/v1/messages");
		assert.equal(entry.request.headers["x-api-key"], "faux-key");
		assert.equal(entry.request.headers.authorization, undefined);
		assert.equal(entry.input.model, "synthetic-anthropic-vision");
		JSON.parse(entry.request.body);
	}
	const body = (id) => JSON.parse(fixture.cases.find((entry) => entry.id === id).request.body);
	assert.equal(body("png-limit").messages[0].content[0].type, "image");
	assert.match(body("png-wide").messages[0].content[0].text, /1901x1/);
	const tool = body("tool-only-image").messages[1].content[0].content;
	assert.equal(tool[0].text, "(see attached image)");
	assert.equal(tool[1].type, "image");
});
test("fresh Node SDK recording matches without rewriting", () => {
	const run = spawnSync(process.execPath, ["scripts/record-anthropic-vision-fixtures.mjs", "--check"], {
		cwd: root, encoding: "utf8", timeout: 45_000,
	});
	assert.equal(run.error, undefined);
	assert.equal(run.status, 0, run.stderr || run.stdout);
});
