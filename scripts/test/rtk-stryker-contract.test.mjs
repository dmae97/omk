import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

test("mutation tooling remains pinned, development-only and outside ordinary checks", () => {
	const manifest = json("package.json");
	for (const name of ["@stryker-mutator/core", "@stryker-mutator/vitest-runner"]) {
		assert.equal(manifest.devDependencies[name], "10.0.0");
		assert.equal(manifest.dependencies?.[name], undefined);
	}
	assert.equal(manifest.scripts["test:mutation"], "stryker run stryker.config.json");
	assert.equal(manifest.scripts["test:mutation:dry"], "stryker run stryker.config.json --dryRunOnly");
	assert.doesNotMatch(manifest.scripts.test, /stryker|mutation/);
	assert.doesNotMatch(manifest.scripts.check, /stryker|mutation/);
	assert.equal(manifest.overrides["@stryker-mutator/core"]["typed-rest-client"].qs, "6.16.0");
});

test("mutation execution keeps a small local sandbox and no remote reporters", () => {
	const config = json("stryker.config.json");
	assert.deepEqual(config.mutate, [
		"packages/coding-agent/src/core/prompt-settlement.ts",
		"packages/coding-agent/src/core/session-prompt-lifecycle.ts",
	]);
	assert.deepEqual(config.plugins, ["@stryker-mutator/vitest-runner"]);
	assert.equal(config.testRunner, "vitest");
	assert.equal(config.concurrency, 1);
	assert.equal(config.inPlace, undefined);
	assert.deepEqual(config.reporters, ["clear-text", "json", "html"]);
	assert.equal(config.thresholds, undefined);
	assert.match(config.jsonReporter.fileName, /^\.omk\/runs\/stryker\//);
	assert.match(config.htmlReporter.fileName, /^\.omk\/runs\/stryker\//);
});
