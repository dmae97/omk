import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { projectOpenTuiLock } from "../stage-opentui-runtime.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const lock = read("../../package-lock.json");
const version = read("../../packages/coding-agent/package.json").optionalDependencies["@opentui/core"];

for (const [target, packageName] of [
	["linux-x64", "@opentui/core-linux-x64"],
	["linux-arm64", "@opentui/core-linux-arm64"],
	["darwin-x64", "@opentui/core-darwin-x64"],
	["darwin-arm64", "@opentui/core-darwin-arm64"],
	["windows-x64", "@opentui/core-win32-x64"],
	["windows-arm64", "@opentui/core-win32-arm64"],
]) {
	test(`projects locked OpenTUI packages for ${target}`, () => {
		const projected = projectOpenTuiLock(lock, version, target);
		assert.deepEqual(projected.packages[""].dependencies, { "@opentui/core": version, [packageName]: version });
		for (const [key, value] of Object.entries(projected.packages)) {
			if (key === "") continue;
			assert.deepEqual(value, lock.packages[key]);
			assert.ok(value.integrity, key);
		}
		assert.equal(projected.packages["node_modules/@opentui/core/node_modules/diff"].version, "9.0.0");
		assert.ok(projected.packages["node_modules/web-tree-sitter"].integrity);
		assert.equal(projected.packages["node_modules/omk-ai"], undefined);
	});
}

test("rejects unknown targets, stale pins and missing native integrity", () => {
	assert.throws(() => projectOpenTuiLock(lock, version, "linux-ia32"), /Unsupported OpenTUI target/);
	assert.throws(() => projectOpenTuiLock(lock, "0.0.0", "linux-x64"), /pin differs/);
	const damaged = structuredClone(lock);
	delete damaged.packages["node_modules/@opentui/core-linux-x64"].integrity;
	assert.throws(() => projectOpenTuiLock(damaged, version, "linux-x64"), /Missing locked archive/);
});
