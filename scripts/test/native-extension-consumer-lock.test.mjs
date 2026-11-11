import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { assertLocked, consumerLock, isolatedEnv } from "../native-extension-artifact-candidate.mjs";

const roots = [];
function fixture() {
	const root = mkdtempSync("/mnt/omkdata/tmp/opencode/consumer-lock-unit-");
	roots.push(root);
	return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function candidate(root) {
	return {
		tarballs: [{ name: "omk-ai", version: "1.5.10", dir: "ai", path: join(root, "omk-ai.tgz") }],
		reviewedLock: { lockfileVersion: 3, packages: {
			"": { name: "workspace", workspaces: ["packages/*"], devDependencies: { compiler: "1" } },
			"packages/ai": { name: "omk-ai", version: "1.5.10", dependencies: { "fixture-dependency": "^1.0.0" }, devDependencies: { compiler: "1" } },
			"node_modules/omk-ai": { resolved: "packages/ai", link: true },
			"node_modules/fixture-dependency": { version: "1.0.0", resolved: "https://registry.npmjs.org/fixture-dependency/-/fixture-dependency-1.0.0.tgz", integrity: "sha512-fixture" },
		} },
	};
}
function manifest(c) {
	return { name: "native-artifact-consumer", private: true, type: "module", dependencies: Object.fromEntries(c.tarballs.map((row) => [row.name, `file:${row.path}`])) };
}
test("seeds exact consumer identities without mutating the reviewed workspace lock", () => {
	const c = candidate(fixture());
	const before = structuredClone(c);
	c.reviewedLock.packages["packages/ai/node_modules/@fixture/nested"] = { version: "2.0.0", resolved: "https://registry.npmjs.org/nested.tgz", integrity: "sha512-nested", optional: true };
	c.reviewedLock.packages["packages/ai/examples/demo"] = { name: "example", version: "1.5.10" };
	const lock = consumerLock(c, manifest(c));
	assertLocked(lock, c.reviewedLock, c.tarballs);
	assert.deepEqual(lock.packages["node_modules/fixture-dependency"], before.reviewedLock.packages["node_modules/fixture-dependency"]);
	assert.deepEqual(lock.packages["node_modules/omk-ai/node_modules/@fixture/nested"], c.reviewedLock.packages["packages/ai/node_modules/@fixture/nested"]);
	assert.equal(lock.packages["node_modules/omk-ai"].resolved, `file:${c.tarballs[0].path}`);
	assert.equal(lock.packages["node_modules/omk-ai"].devDependencies, undefined);
	assert(!Object.keys(lock.packages).some((path) => path.startsWith("packages/") || path.includes("examples")));
	assert(!Object.values(lock.packages).some((row) => row.link));
	lock.packages["node_modules/fixture-dependency"].version = "changed";
	assert.equal(c.reviewedLock.packages["node_modules/fixture-dependency"].version, "1.0.0");
});
test("rejects missing or stale workspace identities before writing an install lock", () => {
	for (const kind of ["missing", "name", "version"]) {
		const c = candidate(fixture());
		if (kind === "missing") delete c.reviewedLock.packages["packages/ai"];
		else c.reviewedLock.packages["packages/ai"][kind] = "wrong";
		assert.throws(() => consumerLock(c, manifest(c)), /workspace.*identity/);
	}
});
test("real npm installs a cached locked dependency without registry metadata or lifecycle scripts", () => {
	const root = fixture();
	const env = isolatedEnv(root);
	function run(command, args, cwd = root) {
		const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 30_000 });
		assert.equal(result.status, 0, `${command}: ${result.error?.message ?? result.stderr}`);
		return result;
	}
	const c = candidate(root);
	for (const name of ["fixture-dependency", "omk-ai"]) {
		const dir = join(root, name);
		mkdirSync(join(dir, "package"), { recursive: true });
		const pkg = name === "omk-ai" ? c.reviewedLock.packages["packages/ai"] : { name, version: "1.0.0", scripts: { install: "node -e 'process.exit(91)'" } };
		writeFileSync(join(dir, "package/package.json"), JSON.stringify(pkg));
		writeFileSync(join(dir, "package/index.js"), "module.exports = 42;\n");
		run("tar", ["-czf", join(root, `${name}.tgz`), "-C", dir, "package"]);
	}
	const dependency = c.reviewedLock.packages["node_modules/fixture-dependency"];
	dependency.integrity = `sha512-${createHash("sha512").update(readFileSync(join(root, "fixture-dependency.tgz"))).digest("base64")}`;
	run("npm", ["cache", "add", join(root, "fixture-dependency.tgz"), "--ignore-scripts", "--offline"]);
	const unresolved = join(root, "unresolved");
	mkdirSync(unresolved);
	const pkg = manifest(c);
	writeFileSync(join(unresolved, "package.json"), JSON.stringify(pkg));
	const control = spawnSync("npm", ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false"], { cwd: unresolved, env, encoding: "utf8", timeout: 30_000 });
	assert.equal(control.error, undefined);
	assert.notEqual(control.status, 0);
	assert.match(control.stderr, /ENOTCACHED/);
	const prefix = join(root, "consumer");
	mkdirSync(prefix);
	writeFileSync(join(prefix, "package.json"), JSON.stringify(pkg));
	writeFileSync(join(prefix, "package-lock.json"), JSON.stringify(consumerLock(c, pkg)));
	run("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", "--omit=dev"], prefix);
	assertLocked(JSON.parse(readFileSync(join(prefix, "node_modules/.package-lock.json"))), c.reviewedLock, c.tarballs, prefix);
	assert.equal(run(process.execPath, ["-e", "console.log(require('fixture-dependency'))"], prefix).stdout.trim(), "42");
});
