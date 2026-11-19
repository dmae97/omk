import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyBundle, verifyTree } from "../check-provider-dependencies.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const manifest = read("native/omk-providers/Cargo.toml");
const lock = read("native/omk-providers/Cargo.lock");
const review = read("specs/120-rust-core/k1-dependency-review.json");
const notices = read("native/omk-providers/THIRD-PARTY-NOTICES.md");
const approval = JSON.parse(read("specs/120-rust-core/k1-adoption.json"));

test("B1 guard rejects transitive, feature, license and review drift", () => {
	assert.doesNotThrow(() => verifyBundle(manifest, lock, review, notices, approval));
	for (const candidate of [manifest.replace('"ring"', '"aws_lc_rs"'), `${manifest}\n[dev-dependencies]\n`, manifest.replace('=1.54.1', '=1.54.2')])
		assert.throws(() => verifyBundle(candidate, lock, review, notices, approval), /manifest/);
	assert.throws(() => verifyBundle(manifest, lock.replace('version = "1.54.1"', 'version = "1.54.2"'), review, notices, approval), /lock/);
	assert.throws(() => verifyBundle(manifest, lock, `${review} `, notices, approval), /digest/);
	assert.throws(() => verifyBundle(manifest, lock, review, `${notices} `, approval), /digest/);
});

test("effective graph guard rejects missing edges and enabled features", () => {
	const expected = { nodes: [
		{ package: "omk-k1-dependency-review@0.0.0", features: [], dependencies: [{ package: "x@1.0.0" }] },
		{ package: "x@1.0.0", features: ["std"], dependencies: [] },
	] };
	const tree = "0omk-providers v0.0.0 (local)|features=|license=MIT\n1x v1.0.0|features=std|license=MIT\n";
	assert.doesNotThrow(() => verifyTree(tree, expected));
	assert.throws(() => verifyTree(tree.replace("features=std", "features=std,tls"), expected), /features/);
	assert.throws(() => verifyTree(tree.split("\n")[0], expected), /package/);
});

test("Node recorder is stable, offline and independent of ambient auth/header configuration", () => {
	const before = read("native/omk-providers/tests/fixtures/anthropic.json");
	const run = spawnSync(process.execPath, ["scripts/record-provider-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "synthetic-unused", ANTHROPIC_CUSTOM_HEADERS: "authorization: synthetic-unused" },
	});
	assert.equal(run.status, 0, run.stdout + run.stderr);
	assert.equal(read("native/omk-providers/tests/fixtures/anthropic.json"), before);
	const fixture = JSON.parse(before);
	assert.equal(fixture.cases.length, 16);
	assert.deepEqual(fixture.cases.find((c) => c.id === "unicode").events, fixture.cases.find((c) => c.id === "bytewise").events);
	assert.match(fixture.cases.find((c) => c.id === "crlf").result.errorMessage, /Unexpected end of JSON input/);
	assert.equal(fixture.cases.find((c) => c.id === "cancel").result.stopReason, "aborted");
	assert.equal(fixture.cases.find((c) => c.id === "cancel-mid").result.stopReason, "aborted");
	assert.deepEqual(fixture.cases.find((c) => c.id === "unicode").events, fixture.cases.find((c) => c.id === "crlf-intact").events);
});
