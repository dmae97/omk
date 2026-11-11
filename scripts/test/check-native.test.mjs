import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { nativeCrates, nativeSteps, runNativeChecks } from "../check-native.mjs";

test("every crate under native/ gets fmt, clippy with warnings denied and tests, locked", () => {
	const crates = nativeCrates();
	const dirs = readdirSync(new URL("../../native/", import.meta.url), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	assert.deepEqual(
		crates.map((c) => c.split("/").at(-2)),
		dirs,
	);
	const steps = nativeSteps(crates);
	assert.equal(steps.length, crates.length * 3);
	for (const args of steps) assert.ok(args.includes("--manifest-path"));
	assert.ok(steps.filter((a) => a[0] === "clippy").every((a) => a.includes("--locked") && a.at(-1) === "warnings"));
	assert.ok(steps.filter((a) => a[0] === "test").every((a) => a.includes("--locked")));
});

test("npm run check provisions the toolchain sequentially before the parallel node tests call cargo", () => {
	const { scripts } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
	const native = scripts.check.indexOf("npm run check:native");
	assert.ok(native >= 0, "check runs check:native");
	assert.ok(native < scripts.check.indexOf("npm run check:constitution"), "check:native runs before check:constitution");
});

test("a missing cargo fails instead of skipping", () => {
	const failures = runNativeChecks({ cargo: "omk-cargo-that-does-not-exist", quiet: true });
	assert.equal(failures.length, 1);
	assert.match(failures[0], /cargo not found/);
});
