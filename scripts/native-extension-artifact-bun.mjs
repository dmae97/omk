import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertFiles, assertNoLinksOutside, CASES, checkCandidate, FAILING_CASES, digest, fileDigest, readJson, run, tree, writeJson } from "./native-extension-artifact-candidate.mjs";

export function validateBunReceipt(receipt) {
	assert(receipt.compiled === true, "actual compiled behavior required, not a version-only executable");
	for (const name of CASES) assert(receipt.cases?.some((row) => row.name === name && row.status === "pass"), `missing compiled matrix ${name}`);
	assert(receipt.namespaceStartup === true && receipt.worker?.sha256 && receipt.entry?.sha256, "namespace startup/worker assets missing");
	assert(receipt.binary?.sha256 && receipt.archive?.sha256 && receipt.assets?.length > 0, "compiled binary/assets receipt missing");
	for (const row of receipt.cases.filter((item) => !FAILING_CASES.has(item.name))) assert(row.events.some((event) => event.event === "tool" && event.runtime.bun && /\$bunfs|~BUN|%7EBUN/.test(event.runtime.main)), "compiled runtime behavior not observed");
}
export function runBun(work, matrix) {
	const candidate = checkCandidate(work);
	assert(readJson(join(work, "node.json")).status === "pass", "packaged Node gate must pass first");
	const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
	assert(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"].includes(host), `host binary preparation unsupported without download: ${host}`);
	const pkg = join(candidate.snapshot, "packages/coding-agent");
	const entry = join(pkg, "dist/bun/cli.js");
	const worker = join(pkg, "src/utils/image-resize-worker.ts");
	const registration = join(pkg, "dist/bun/register-bundled-coding-agent.js");
	assert.match(readFileSync(entry, "utf8"), /register-bundled-coding-agent/);
	assert.match(readFileSync(registration, "utf8"), /registerBundledCodingAgentNamespace/);
	const clipboard = host.startsWith("linux-") ? `clipboard-${host}-gnu` : `clipboard-${host}`;
	for (const path of [`node_modules/@mariozechner/${clipboard}`, "node_modules/@mariozechner/clipboard", "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"]) assert(existsSync(join(candidate.snapshot, path)), `host pack prerequisite missing: ${path}; no dependency/platform download authorized`);
	const output = join(work, "binary-build");
	assert(!existsSync(output), "binary build --out must be new and exclusively owned; build script deletes it");
	assert(process.platform === "linux", "offline host compiler network isolation is not implemented for this host");
	const offline = ["--user", "--map-current-user", "--net", "--"];
	run("unshare", [...offline, "true"], candidate.snapshot, work, "bun-offline-preflight");
	const tool = run("bun", ["--version"], candidate.snapshot, work, "bun-version").stdout.trim();
	const build = run("unshare", [...offline, "bash", "scripts/build-binaries.sh", "--skip-install", "--skip-deps", "--skip-build", "--platform", host, "--out", output], candidate.snapshot, work, "bun-build");
	const runtime = join(work, "binary-runtime");
	assert(!existsSync(runtime), "binary runtime must be fresh");
	mkdirSync(runtime);
	const archive = join(output, `omk-${host}.tar.gz`);
	run("tar", ["-xzf", archive, "--no-same-owner", "-C", runtime], runtime, work, "bun-extract");
	const executable = join(runtime, "omk/omk");
	const magic = readFileSync(executable).subarray(0, 4).toString("hex");
	assert(host.startsWith("linux-") ? magic === "7f454c46" : ["cffaedfe", "feedfacf", "cafebabe"].includes(magic), "not a host compiled executable");
	assertNoLinksOutside(runtime);
	const assets = tree(runtime, true).map((row) => ({ ...row, path: `binary-runtime/${row.path}` }));
	for (const path of ["omk/package.json", "omk/photon_rs_bg.wasm", "omk/README.md"]) assert(assets.some((row) => row.path === `binary-runtime/${path}`), `missing copied binary asset ${path}`);
	const cases = matrix(work, executable, true);
	const node = readJson(join(work, "node.json"));
	for (const row of cases.filter((item) => !FAILING_CASES.has(item.name))) {
		const tools = (events) => events.filter((item) => item.event === "tool").map(({ input, result, identity, provider }) => ({ input, result, identity, provider }));
		assert.deepEqual(tools(row.events), tools(node.cases.find((item) => item.name === row.name).events), "compiled/Node deterministic tool receipt differs");
	}
	const receipt = { status: "pass", candidate: candidate.candidate, outputs: candidate.outputsDigest, compiled: true, host, tool, namespaceStartup: true,
		entry: { path: entry, sha256: fileDigest(entry) }, worker: { path: worker, sha256: fileDigest(worker) }, registration: { path: registration, sha256: fileDigest(registration) },
		binary: { path: executable, sha256: fileDigest(executable) }, archive: { path: archive, sha256: fileDigest(archive) }, assets, assetsDigest: digest(assets), build, cases };
	validateBunReceipt(receipt); assertFiles(work, assets); checkCandidate(work);
	writeJson(join(work, "bun.json"), receipt);
	return receipt;
}
