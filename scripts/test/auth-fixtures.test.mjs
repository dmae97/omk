import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const retained = [
	"native/omk-providers/Cargo.toml", "native/omk-providers/Cargo.lock",
	"native/omk-providers/THIRD-PARTY-NOTICES.md",
	...['anthropic', 'anthropic-json', 'anthropic-history', 'anthropic-tool-history', 'anthropic-content', 'anthropic-vision', 'auth'].map(name => `native/omk-providers/tests/fixtures/${name}.json`),
];
test("real Node authentication oracle remains fresh and ignores inherited credentials", () => {
	const before = retained.map(read);
	const run = spawnSync(process.execPath, ["scripts/record-auth-fixtures.mjs", "--check"], {
		cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 40_000,
		env: { ...process.env, ANTHROPIC_API_KEY: "ambient-not-allowed", ANTHROPIC_OAUTH_TOKEN: "ambient-not-allowed", SYN_KEY: "ambient-not-allowed" },
	});
	assert.equal(run.status, 0, run.stdout + run.stderr);
	assert.match(run.stdout, /52 independent auth cases/);
	assert.deepEqual(retained.map(read), before);
});
test("Node stored-key and unreadable-store boundaries cannot silently select another account", () => {
	const corpus = JSON.parse(read("native/omk-providers/tests/fixtures/auth.json"));
	const result = id => corpus.cases.find(row => row.id === id).expected;
	assert.deepEqual(result("stored-unresolved-no-fallback"), { key: null, blocked: false });
	assert.deepEqual(result("stored-empty-stops-fallback"), { key: "", blocked: false });
	assert.deepEqual(result("unreadable-no-substitution"), { key: null, blocked: true });
	assert.deepEqual(result("malformed-no-substitution"), { key: null, blocked: true });
	assert.deepEqual(result("runtime-over-unreadable"), { key: "faux-runtime", blocked: false });
	assert.deepEqual(result("fallback-disabled"), { key: null, blocked: false });
	assert.deepEqual(result("runtime-not-interpolated"), { key: "$SYN_KEY", blocked: false });
	assert.ok(!JSON.stringify(corpus).includes("ambient-not-allowed"));
});
