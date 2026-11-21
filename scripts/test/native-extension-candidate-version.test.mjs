import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { digest, inputs, PACKAGES, prepare } from "../native-extension-artifact-candidate.mjs";

// A pre-commit hook in a linked worktree exports that worktree's GIT_DIR. `git init` with it inherited
// writes core.bare=true into the shared repository config, so this file and its children run without it.
for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];

test("artifact candidates cover all eight public lockstep packages", () => {
	assert.deepEqual([...PACKAGES].sort(), [
		"adaptorch-wpl", "agent", "ai", "book-to-skill", "coding-agent", "protocol", "speak-like-you-eat", "tui",
	]);
});

function fixture(t, version, change = () => {}) {
	const root = mkdtempSync(join(tmpdir(), "omk-candidate-version-"));
	const previous = process.env.OMK_ARTIFACT_WORK_ROOT;
	process.env.OMK_ARTIFACT_WORK_ROOT = root;
	t.after(() => {
		if (previous === undefined) delete process.env.OMK_ARTIFACT_WORK_ROOT;
		else process.env.OMK_ARTIFACT_WORK_ROOT = previous;
		rmSync(root, { recursive: true, force: true });
	});
	const source = join(root, "source");
	mkdirSync(source);
	execFileSync("git", ["init", "--quiet", source]);
	const manifests = Object.fromEntries(PACKAGES.map((dir) => [dir, {
		name: dir === "coding-agent" ? "open-multi-agent-kit" : dir === "agent" ? "omk-agent-core" : `omk-${dir}`,
		version, license: "MIT",
	}]));
	// Stop at the real build boundary; never compile the workspace or publish a package.
	const manifest = { name: "candidate-fixture", private: true, version, scripts: { build: "node -e 'process.exit(73)'" } };
	const lock = { name: manifest.name, version, lockfileVersion: 3, packages: {
		"": { name: manifest.name, version },
		...Object.fromEntries(PACKAGES.map((dir) => [`packages/${dir}`, structuredClone(manifests[dir])])),
	} };
	change({ manifest, manifests, lock });
	const put = (path, value) => writeFileSync(join(source, path), `${JSON.stringify(value)}\n`);
	put("package.json", manifest);
	put("package-lock.json", lock);
	for (const dir of PACKAGES) {
		mkdirSync(join(source, "packages", dir), { recursive: true });
		put(`packages/${dir}/package.json`, manifests[dir]);
	}
	return { source, work: join(root, "work"), frozen: digest(inputs(source)) };
}

for (const version of ["1.5.10", "1.5.11", "2.0.0"]) {
	test(`a frozen lockstep ${version} candidate reaches the build boundary`, (t) => {
		const { source, work, frozen } = fixture(t, version);
		assert.throws(() => prepare(source, work, frozen), /candidate-build failed \(73\)/);
		const receipt = JSON.parse(readFileSync(join(work, "candidate-build.command.json"), "utf8"));
		assert.equal(receipt.status, 73);
	});
}

for (const [name, replacement] of [
	["version", { version: "1.5.10" }],
	["name", { name: "substitute" }],
	["license", { license: "GPL-3.0" }],
	["lifecycle", { scripts: { prepare: "exit 91" } }],
]) {
	test(`rejects build-time ${name} drift before packing`, (t) => {
		const { source, work, frozen } = fixture(t, "1.5.11", ({ manifest }) => {
			const code = `const fs = require("node:fs"); const path = "packages/ai/package.json"; const pkg = JSON.parse(fs.readFileSync(path)); Object.assign(pkg, ${JSON.stringify(replacement)}); fs.writeFileSync(path, JSON.stringify(pkg)); fs.mkdirSync("packages/ai/dist"); fs.writeFileSync("packages/ai/dist/index.js", "export {};\\n");`;
			manifest.scripts.build = `node -e '${code}'`;
		});
		assert.throws(() => prepare(source, work, frozen), /^AssertionError \[ERR_ASSERTION\]: (?:unreviewed local candidate manifest|unexpected lifecycle)/);
		assert.equal(JSON.parse(readFileSync(join(work, "candidate-build.command.json"), "utf8")).status, 0);
		assert.equal(existsSync(join(work, "pack-ai.command.json")), false);
	});
}

const rejections = [
	["root lock version", ({ lock }) => { lock.version = "1.5.9"; }],
	["root lock package version", ({ lock }) => { lock.packages[""].version = "1.5.9"; }],
	["missing version", ({ manifest, manifests, lock }) => {
		delete manifest.version; delete lock.version; delete lock.packages[""].version;
		for (const dir of PACKAGES) { delete manifests[dir].version; delete lock.packages[`packages/${dir}`].version; }
	}],
	["missing locked workspace", ({ lock }) => { delete lock.packages["packages/ai"]; }],
	["locked workspace name", ({ lock }) => { lock.packages["packages/ai"].name = "substitute"; }],
	["locked workspace version", ({ lock }) => { lock.packages["packages/ai"].version = "1.5.9"; }],
	["package name", ({ manifests }) => { manifests.ai.name = "substitute"; }],
	["package license", ({ manifests }) => { manifests.ai.license = "GPL-3.0"; }],
	...(["preinstall", "install", "postinstall", "prepare"].map((hook) => [hook, ({ manifests }) => {
		manifests.ai.scripts = { [hook]: "node -e 'process.exit(91)'" };
	}])),
];
for (const [name, change] of rejections) {
	test(`rejects ${name} before any build or pack command`, (t) => {
		const { source, work, frozen } = fixture(t, "1.5.10", change);
		assert.throws(() => prepare(source, work, frozen), /^AssertionError \[ERR_ASSERTION\]: (?:unreviewed|unexpected)/);
		assert.equal(existsSync(join(work, "npm-version.command.json")), false);
	});
}

test("mixed package versions fail before running any build", (t) => {
	const { source, work, frozen } = fixture(t, "1.5.11", ({ manifests, lock }) => {
		for (const dir of PACKAGES) {
			manifests[dir].version = "1.5.10";
			lock.packages[`packages/${dir}`].version = "1.5.10";
		}
	});
	assert.throws(() => prepare(source, work, frozen), /^AssertionError \[ERR_ASSERTION\]: unreviewed local candidate manifest/);
	assert.equal(existsSync(join(work, "npm-version.command.json")), false);
});
