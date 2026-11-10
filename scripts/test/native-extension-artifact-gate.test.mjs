import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { assertFiles, assertLocked, assertNoLinksOutside, assertPackage, assertWork, auditMembers, checkCandidate, copyNpmCache, digest, fileDigest, isolatedEnv } from "../native-extension-artifact-candidate.mjs";
import { validateBunReceipt } from "../native-extension-artifact-bun.mjs";
import { validateReceipts } from "../native-extension-artifact-gate.mjs";

const roots = [];
function fixture() {
	const root = mkdtempSync("/mnt/omkdata/tmp/opencode/artifact-unit-");
	roots.push(root);
	return root;
}
function put(root, path, bytes = "candidate") {
	const target = join(root, path);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, bytes);
	return { path, sha256: fileDigest(target) };
}
function completeEvidence() {
	const work = fixture();
	const common = { status: "pass", candidate: "a".repeat(64), outputs: "b".repeat(64) };
	const environment = { HOME: join(work, "consumer/runs/sdk/home"), agentDir: join(work, "consumer/runs/sdk/agent"), cwd: join(work, "consumer/runs/sdk/project") };
	const cases = ["native", "missing", "installed", "default-omitted", "compat-explicit"].map((name) => ({ name, status: "pass", environment, events: [{ event: "tool", runtime: { bun: "1.4.4", main: "/$bunfs/root/cli.js" } }] }));
	const source = { ...common, groups: ["phase1", "native-loader", "cli-sdk", "doctor", "preservation", "atelier", "root-check"].map((name) => ({ name, status: "pass", command: "observed test command", exitCode: 0, logs: [{ path: "source.log", sha256: "c".repeat(64) }] })) };
	return { work, candidate: common.candidate, outputs: common.outputs, stages: { node: { ...common, environment, cases, sdk: { events: [{ event: "sdk", reload: true }] } }, bun: { ...common, compiled: true, cases, namespaceStartup: true, worker: { sha256: "c".repeat(64) }, entry: { sha256: "c".repeat(64) }, binary: { sha256: "c".repeat(64) }, archive: { sha256: "c".repeat(64) }, assets: [{ path: "asset", sha256: "c".repeat(64) }] }, types: { ...common, declarationResolutions: [{ path: "installed.d.ts" }] }, source } };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("rejects an unsafe or reused work root without writing", () => {
	const root = fixture();
	assert.throws(() => assertWork(process.cwd(), process.cwd(), true), /external|unsafe/);
	assert.throws(() => assertWork(root, process.cwd(), true), /fresh|exist/);
	assert.throws(() => assertWork("/tmp/unapproved-artifact", process.cwd(), true), /approved|unsafe/);
});
test("rejects source identity changes even at the same HEAD", () => {
	const root = fixture();
	const input = put(root, "src/entry.ts");
	assertFiles(root, [input]);
	writeFileSync(join(root, input.path), "different dirty source");
	assert.throws(() => assertFiles(root, [input]), /digest|changed/);
});
test("rejects stale emitted dist bytes", () => {
	const root = fixture();
	const output = put(root, "dist/cli.js", "fresh native CLI");
	writeFileSync(join(root, output.path), "old same-version CLI");
	assert.throws(() => assertFiles(root, [output]), /digest|changed/);
});
test("rejects traversal in a receipt file path", () => {
	assert.throws(() => assertFiles(fixture(), [{ path: "../outside", sha256: "a".repeat(64) }]), /outside|unsafe/);
});
test("rejects dependency symlinks writing back to the source checkout", () => {
	const root = fixture();
	mkdirSync(join(root, "node_modules"));
	symlinkSync(process.cwd(), join(root, "node_modules", "source"));
	assert.throws(() => assertNoLinksOutside(root), /link|outside/);
});
test("permits candidate-contained workspace links", () => {
	const root = fixture();
	mkdirSync(join(root, "packages", "ai"), { recursive: true });
	mkdirSync(join(root, "node_modules"));
	symlinkSync("../packages/ai", join(root, "node_modules", "omk-ai"));
	assertNoLinksOutside(root);
});
test("scrubs inherited credentials, source loaders and module lookup variables", () => {
	const root = fixture();
	const env = isolatedEnv(root, { PATH: "/usr/bin", HOME: "/private/home", NODE_PATH: "/repo/node_modules", NODE_OPTIONS: "--import /repo/loader.mjs", OPENAI_API_KEY: "fixture-secret", PI_PROVIDER: "live", npm_config_prefix: "/global" });
	assert.equal(env.HOME, join(root, "home"));
	assert.equal(env.OMK_CODING_AGENT_DIR, join(root, "agent"));
	for (const key of ["NODE_PATH", "NODE_OPTIONS", "OPENAI_API_KEY", "PI_PROVIDER", "npm_config_prefix"]) assert.equal(env[key], undefined);
});
test("starts real npm with isolated user and global configuration", () => {
	const root = fixture();
	mkdirSync(join(root, "home"));
	const result = spawnSync("npm", ["--version"], { cwd: root, env: isolatedEnv(root), encoding: "utf8", timeout: 10_000 });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
test("copies the explicit npm cache without reading or changing the caller's home cache", () => {
	for (const key of ["NPM_CONFIG_CACHE", "npm_config_cache"]) {
		const root = fixture();
		const cache = join(root, "configured-cache");
		put(cache, "_cacache/content-v2/fixture", "cached locked package");
		const work = join(root, "work");
		mkdirSync(work);
		copyNpmCache(work, { HOME: join(root, "missing-home"), [key]: cache });
		assert.equal(readFileSync(join(work, "npm-cache/_cacache/content-v2/fixture"), "utf8"), "cached locked package");
		writeFileSync(join(work, "npm-cache/_cacache/content-v2/fixture"), "owned copy");
		assert.equal(readFileSync(join(cache, "_cacache/content-v2/fixture"), "utf8"), "cached locked package");
	}
});
test("rejects an installed package with same version but registry bytes", () => {
	const root = fixture();
	const pkg = join(root, "node_modules", "omk-ai");
	const files = [put(pkg, "package.json", JSON.stringify({ name: "omk-ai", version: "1.5.10" })), put(pkg, "dist/index.js")];
	const expected = { name: "omk-ai", version: "1.5.10", files };
	assertPackage(pkg, expected, root);
	writeFileSync(join(pkg, "dist/index.js"), "registry replacement");
	assert.throws(() => assertPackage(pkg, expected, root), /digest|identity/);
});
test("rejects workspace/source aliases even with identical package bytes", () => {
	const root = fixture();
	const pkg = join(root, "candidate", "packages", "ai");
	const files = [put(pkg, "package.json", JSON.stringify({ name: "omk-ai", version: "1.5.10" }))];
	mkdirSync(join(root, "consumer"));
	assert.throws(() => assertPackage(pkg, { name: "omk-ai", version: "1.5.10", files }, join(root, "consumer")), /outside|installed/);
});
test("halts resolution of unreviewed or upgraded third-party packages", () => {
	const locked = { packages: { "node_modules/example": { version: "1.0.0", resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz", integrity: "sha512-fixture" } } };
	assertLocked(locked, locked, []);
	const unknown = structuredClone(locked);
	unknown.packages["node_modules/example"].version = "1.0.1";
	assert.throws(() => assertLocked(unknown, locked, []), /review|locked/);
});
test("rejects nested same-version registry internal resolutions before install", () => {
	const lock = { packages: { "node_modules/open-multi-agent-kit/node_modules/omk-ai": { version: "1.5.10", resolved: "https://registry.npmjs.org/omk-ai/-/omk-ai-1.5.10.tgz" } } };
	assert.throws(() => assertLocked(lock, { packages: {} }, [{ name: "omk-ai", path: "/owned/omk-ai.tgz", version: "1.5.10" }]), /internal|tarball/);
});
test("rejects private, traversal and linked tarball members", () => {
	for (const member of ["package/.env", "package/.omk/agent/sessions/private.json", "package/../../outside", "/outside", "package/docs/corpus/private.md"]) assert.throws(() => auditMembers([member], ["-rw-r--r-- fixture"]), /private|unsafe|public/);
	assert.throws(() => auditMembers(["package/dist/index.js"], ["lrwxrwxrwx fixture"]), /link|type/);
	auditMembers(["package/package.json", "package/LICENSE", "package/dist/index.js"], ["-rw-r--r-- fixture"]);
});
test("permits session implementation modules only when bound to public source", () => {
	const members = ["package/dist/harness/session/jsonl-labels.js", "package/dist/harness/session/jsonl-labels.d.ts.map"];
	const types = members.map(() => "-rw-r--r-- fixture");
	auditMembers(members, types, ["src/harness/session/jsonl-labels.ts"]);
	assert.throws(() => auditMembers(members, types), /private|session/);
	for (const path of ["package/dist/harness/session/private.jsonl", "package/dist/harness/session/auth.json", "package/sessions/private.jsonl", "package/dist/harness/session/untracked.js"]) {
		assert.throws(() => auditMembers([path], ["-rw-r--r-- fixture"], ["src/harness/session/jsonl-labels.ts"]), /private|session/);
	}
});
test("missing stage receipts never become artifact acceptance", () => {
	assert.throws(() => validateReceipts({ candidate: "a".repeat(64), outputs: "b".repeat(64), stages: {} }), /missing|receipt/);
});
test("mismatched candidates and leaked runtime environments fail acceptance", () => {
	const stage = { status: "pass", candidate: "wrong", outputs: "b".repeat(64), environment: { NODE_PATH: "/source" } };
	assert.throws(() => validateReceipts({ candidate: "a".repeat(64), outputs: "b".repeat(64), stages: { node: stage, bun: stage, types: stage, source: stage } }), /candidate|environment/);
});
test("a version-only fake binary cannot satisfy compiled behavior", () => {
	assert.throws(() => validateBunReceipt({ status: "pass", version: "1.5.10", binary: { sha256: "a".repeat(64) }, cases: [] }), /compiled|behavior|matrix/);
});
test("compiled evidence requires normal namespace startup and worker assets", () => {
	const receipt = completeEvidence().stages.bun;
	receipt.namespaceStartup = false;
	assert.throws(() => validateBunReceipt(receipt), /namespace/);
	receipt.namespaceStartup = true;
	receipt.worker = {};
	assert.throws(() => validateBunReceipt(receipt), /worker/);
});
test("stable digest binds ordered file records rather than package versions", () => {
	assert.notEqual(digest([{ path: "entry.ts", sha256: "old" }]), digest([{ path: "entry.ts", sha256: "new" }]));
	const root = fixture();
	const row = put(root, "fixture.txt");
	assert.equal(row.sha256, digest(readFileSync(join(root, row.path))));
});
test("complete structural receipts are accepted without claiming an artifact run", () => {
	validateReceipts(completeEvidence());
});
test("a leaked original HOME fails even when all candidate hashes match", () => {
	const evidence = completeEvidence();
	evidence.stages.node.environment = { ...evidence.stages.node.environment, HOME: "/private/operator-home" };
	assert.throws(() => validateReceipts(evidence), /environment|outside/);
});
test("a leaked source loader fails independently of candidate identity", () => {
	const evidence = completeEvidence();
	evidence.stages.node.environment.NODE_OPTIONS = "--import /source/tsx.mjs";
	assert.throws(() => validateReceipts(evidence), /environment/);
});
test("a failed preservation gate cannot become all-six success", () => {
	const evidence = completeEvidence();
	evidence.stages.source.groups.find((row) => row.name === "preservation").exitCode = 1;
	assert.throws(() => validateReceipts(evidence), /preservation/);
});
test("an omitted-dialect native default control cannot be replaced by version smoke", () => {
	const evidence = completeEvidence();
	evidence.stages.node.cases = evidence.stages.node.cases.filter((row) => row.name !== "default-omitted");
	assert.throws(() => validateReceipts(evidence), /matrix/);
});
test("wrong dist identity fails independently of a correct source digest", () => {
	const evidence = completeEvidence();
	evidence.stages.types.outputs = "d".repeat(64);
	assert.throws(() => validateReceipts(evidence), /output/);
});
test("wrong source checkout origin is rejected before reading or building it", () => {
	const work = fixture();
	put(work, "candidate.json", JSON.stringify({ source: "/unrelated/source-checkout", work, snapshot: join(work, "candidate") }));
	assert.throws(() => checkCandidate(work), /wrong source checkout origin/);
});
test("missing installed declaration evidence cannot be filled by runtime success", () => {
	const evidence = completeEvidence();
	evidence.stages.types.declarationResolutions = [];
	assert.throws(() => validateReceipts(evidence), /installed types/);
});
