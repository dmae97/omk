#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFiles, assertPackage, checkCandidate, contained, digest, fileDigest, inputs, installConsumer, isolatedEnv, prepare, readJson, run, writeJson } from "./native-extension-artifact-candidate.mjs";
import { runBun, validateBunReceipt } from "./native-extension-artifact-bun.mjs";

export const CASES = ["native", "missing", "installed", "compat-omitted", "compat-explicit"];
const SOURCE_GROUPS = ["phase1", "native-loader", "cli-sdk", "doctor", "preservation", "atelier", "root-check"];
const source = resolve(fileURLToPath(new URL("..", import.meta.url)));
const guardSource = `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';
const candidate = JSON.parse(readFileSync(process.env.NATIVE_ARTIFACT_MANIFEST, 'utf8'));
const prefix = realpathSync(process.env.NATIVE_ARTIFACT_PREFIX);
let attempts = 0; const observed = new Map();
const deny = () => { attempts++; throw new Error('unexpected artifact network request'); };
globalThis.fetch = deny; net.Socket.prototype.connect = deny; tls.connect = deny;
http.request = deny; http.get = deny; https.request = deny; https.get = deny;
registerHooks({ load(url, context, next) {
 if (url.startsWith('file:')) {
  const path = realpathSync(fileURLToPath(url)); let root = dirname(path);
  while (root !== dirname(root)) {
   const manifest = join(root, 'package.json');
   if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const expected = candidate.tarballs.find(row => row.name === pkg.name);
    if (expected) {
     assert(root.startsWith(prefix + '/'), 'source/workspace alias instead of installed artifact');
     assert.equal(pkg.version, expected.version, 'internal package version');
     const row = expected.files.find(row => row.path === relative(root, path));
     assert(row, 'unknown loaded internal package file');
     const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
     assert.equal(sha256, row.sha256, 'substituted internal package bytes');
     observed.set(path, { name: pkg.name, version: pkg.version, root, path, sha256 }); break;
    }
    break;
   }
   root = dirname(root);
  }
 }
 return next(url, context);
} });
process.on('exit', () => writeFileSync(process.env.NATIVE_ARTIFACT_GUARD, JSON.stringify({ attempts, observed: [...observed.values()], environment: { HOME: process.env.HOME, agentDir: process.env.OMK_CODING_AGENT_DIR, cwd: process.cwd(), NODE_PATH: process.env.NODE_PATH ?? null, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null } })));
`;

function caseTree(work, base, name, candidate) {
	const root = join(base, name);
	assert(!existsSync(root), "runtime case directory must be fresh");
	for (const path of [root, join(root, "home"), join(root, "agent"), join(root, "project", ".git")]) mkdirSync(path, { recursive: true });
	const cwd = join(root, "project");
	writeJson(join(root, "agent", "settings.json"), { packages: [], quietStartup: true, compaction: { enabled: false } });
	copyFileSync(join(candidate.snapshot, "scripts/fixtures/native-extension-artifact-extension.ts"), join(cwd, "extension.ts"));
	const legacy = 'import { Key } from "@earendil-works/pi-tui"; export const identity = Key.escape ? "compatibility-alias" : "wrong";';
	let route = name.startsWith("compat-") || name === "missing" ? legacy : 'export const identity = "native";';
	if (name === "installed") {
		const nm = join(cwd, "node_modules");
		const pi = join(nm, "@earendil-works", "pi-ai");
		mkdirSync(pi, { recursive: true });
		writeJson(join(pi, "package.json"), { name: "@earendil-works/pi-ai", version: "0.0.0-artifact-fixture", type: "module", exports: { ".": "./index.mjs", "./identity": "./index.mjs", "./cjs": "./index.cjs" } });
		writeFileSync(join(pi, "index.mjs"), 'export const identity = "installed-esm-subpath";');
		writeFileSync(join(pi, "index.cjs"), 'exports.identity = "installed-cjs";');
		for (const [helper, code] of [["fixture-esm", 'export {identity} from "@earendil-works/pi-ai/identity";'], ["fixture-cjs", 'module.exports = require("@earendil-works/pi-ai/cjs");']]) {
			mkdirSync(join(nm, helper));
			writeJson(join(nm, helper, "package.json"), { name: helper, main: helper.endsWith("esm") ? "index.mjs" : "index.cjs" });
			writeFileSync(join(nm, helper, helper.endsWith("esm") ? "index.mjs" : "index.cjs"), code);
		}
		route = 'import { identity as esm } from "fixture-esm"; import {createRequire} from "node:module"; const require = createRequire(import.meta.url); export const identity = esm + ":" + require("fixture-cjs").identity;';
	}
	writeFileSync(join(cwd, "route.mjs"), route);
	writeFileSync(join(cwd, "route.mjs"), `\nexport function lateIdentity() { return ${name === "installed" ? 'require("fixture-cjs").identity' : "identity"}; }\n`, { flag: "a" });
	writeFileSync(join(cwd, "cache-control.ts"), 'import { Key } from "@earendil-works/pi-tui"; export default api => api.registerCommand(Key.escape, {handler: async () => {}});');
	const env = { ...isolatedEnv(root), NATIVE_ARTIFACT_RECEIPT: join(root, "events.jsonl"), NATIVE_ARTIFACT_MANIFEST: join(work, "candidate.json"), NATIVE_ARTIFACT_PREFIX: join(work, "consumer"), NATIVE_ARTIFACT_GUARD: join(root, "guard.json") };
	return { root, cwd, env };
}
function eventsAt(path) { return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []; }
function checkBehavior(result, events, name, compiled) {
	if (name === "missing") {
		assert.equal(result.status, 1, "missing legacy import must fail normal startup");
		assert.match(result.stderr, /Failed to load extension[\s\S]*@earendil-works\/pi-tui/);
		assert.doesNotMatch(result.stderr, /Unknown option|No models available|No API key/);
		assert(!events.some((event) => event.event === "factory"), "failed import evaluated the factory");
		return;
	}
	assert.equal(result.status, 0, `real artifact execution failed: ${result.stderr}`);
	assert.match(result.stdout, /offline artifact complete/);
	const identity = name.startsWith("compat-") ? "compatibility-alias" : name === "installed" ? "installed-esm-subpath:installed-cjs" : "native";
	assert(events.some((event) => event.event === "factory" && event.namespace === true && event.identity === identity && event.subpaths.length === 3), "missing namespace/subpath behavior");
	assert(events.some((event) => event.event === "tool" && event.input === 41 && event.result === 42 && event.identity === identity && event.provider === "native-artifact-fixture"), "missing actual tool/provider result");
	assert(events.some((event) => event.event === "provider" && event.completed === true), "missing deterministic provider completion");
	assert(events.some((event) => event.event === "start" && event.trusted === true), "missing lifecycle startup");
	assert(events.some((event) => event.event === "shutdown" && event.reason === "quit"), "missing lifecycle shutdown");
	assert(events.some((event) => event.event === "cache-order" && event.order.join() === "omk,omk+pi,omk,omk+pi,omk"), "cache-order controls missing");
	const network = events.filter((event) => event.event === "network");
	assert(network.length > 0 && network.every((event) => event.attempts === 0), "network evidence missing or request attempted");
	assert(events.some((event) => event.event === "tool" && event.lateIdentity === (name === "installed" ? "installed-cjs" : identity)), "delayed transitive identity missing");
	if (compiled) assert(events.some((event) => event.event === "tool" && event.runtime.bun && /\$bunfs|~BUN|%7EBUN/.test(event.runtime.main)), "not the actual compiled production runtime");
}
export function runMatrix(work, executable, compiled = false) {
	const candidate = checkCandidate(work);
	const base = compiled ? join(work, "bun-runtime") : join(work, "consumer", "runs");
	mkdirSync(base);
	const guard = join(work, "node-guard.mjs");
	if (!compiled) writeFileSync(guard, guardSource, { flag: "wx" });
	const cases = CASES.map((name) => {
		const fixture = caseTree(work, base, name, candidate);
		const flags = name === "compat-omitted" ? [] : ["--package-manifest-dialect", name === "compat-explicit" ? "omk+pi" : "omk"];
		const args = ["-p", "--no-session", "--no-extensions", "--no-builtin-tools", "-e", join(fixture.cwd, "extension.ts"), "--model", "native-artifact-fixture/offline", ...flags, "run the offline fixture"];
		const result = run(compiled ? executable : process.execPath, compiled ? args : ["--import", guard, executable, ...args], fixture.cwd, work, `${compiled ? "bun" : "node"}-${name}`, { env: fixture.env, allowFailure: true });
		const events = eventsAt(fixture.env.NATIVE_ARTIFACT_RECEIPT);
		checkBehavior(result, events, name, compiled);
		const observed = compiled ? null : readJson(fixture.env.NATIVE_ARTIFACT_GUARD);
		if (observed) assert.equal(observed.attempts, 0, "runtime network attempt");
		return { name, status: "pass", command: result, events, observed, environment: observed?.environment ?? events.find((event) => event.event === "environment"), receipt: { path: fixture.env.NATIVE_ARTIFACT_RECEIPT, sha256: existsSync(fixture.env.NATIVE_ARTIFACT_RECEIPT) ? fileDigest(fixture.env.NATIVE_ARTIFACT_RECEIPT) : null } };
	});
	return cases;
}
function nodeStage(work) {
	const { candidate, prefix, resolved } = installConsumer(work);
	const cases = runMatrix(work, join(prefix, "node_modules/open-multi-agent-kit/dist/cli.js"));
	const fixture = caseTree(work, join(prefix, "runs"), "sdk", candidate);
	copyFileSync(join(candidate.snapshot, "scripts/fixtures/native-extension-consumer.mjs"), join(fixture.cwd, "consumer.mjs"));
	const result = run(process.execPath, ["--import", join(work, "node-guard.mjs"), join(fixture.cwd, "consumer.mjs")], fixture.cwd, work, "node-sdk", { env: fixture.env });
	const events = eventsAt(fixture.env.NATIVE_ARTIFACT_RECEIPT);
	assert(events.some((event) => event.event === "sdk" && event.injectedLoader && event.reload && event.replacement), "public SDK injection/reload/cwd replacement not observed");
	assert.equal(events.filter((event) => event.event === "tool" && event.result === 42).length, 4, "SDK must execute tools before/after reload and cwd/session replacement");
	assert(events.some((event) => event.event === "owner" && event.path === join(fixture.cwd, "extension.ts")), "SDK provider owner missing");
	const observed = readJson(fixture.env.NATIVE_ARTIFACT_GUARD);
	assert.equal(observed.attempts, 0);
	assert(events.some((event) => event.event === "network") && events.filter((event) => event.event === "network").every((event) => event.attempts === 0), "SDK fixture network evidence missing or nonzero");
	assert.equal(new Set(observed.observed.map((row) => row.name)).size, 7, "all seven public roots must resolve from installed bytes");
	const receipt = { status: "pass", candidate: candidate.candidate, outputs: candidate.outputsDigest, cases, resolved, sdk: { result, events, observed }, environment: observed.environment };
	checkCandidate(work); writeJson(join(work, "node.json"), receipt); return receipt;
}
function typesStage(work) {
	const candidate = checkCandidate(work);
	const prefix = readJson(join(work, "installed.json")).prefix;
	assert.equal(prefix, join(work, "consumer"), "installed consumer prefix mismatch");
	const path = join(prefix, "api-consumer.ts");
	copyFileSync(join(candidate.snapshot, "scripts/fixtures/native-extension-api-consumer.ts"), path);
	const config = { compilerOptions: { strict: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2023", types: ["node"], typeRoots: [join(candidate.snapshot, "node_modules/@types")], traceResolution: true }, files: [path] };
	writeJson(join(prefix, "tsconfig.json"), config);
	const result = run(process.execPath, [join(candidate.snapshot, "node_modules/typescript/lib/tsc.js"), "-p", join(prefix, "tsconfig.json")], prefix, work, "installed-types");
	assert(!/"(?:paths|baseUrl)"/.test(JSON.stringify(config)), "source type aliases forbidden");
	const internalResolutions = [...result.stdout.matchAll(/Module name '(open-multi-agent-kit|omk-(?:ai|agent-core|tui|protocol|adaptorch-wpl|book-to-skill))[^']*' was successfully resolved to '([^']+)'/g)];
	assert(internalResolutions.length > 0, "installed declaration resolution evidence missing");
	for (const match of internalResolutions) contained(realpathSync(prefix), realpathSync(match[2]));
	const compiler = join(candidate.snapshot, "node_modules/typescript/lib/tsc.js");
	const receipt = { status: "pass", candidate: candidate.candidate, outputs: candidate.outputsDigest, result, config, compiler: { path: compiler, sha256: fileDigest(compiler), version: readJson(join(candidate.snapshot, "node_modules/typescript/package.json")).version }, declarationResolutions: internalResolutions.map((match) => ({ name: match[1], path: match[2], sha256: fileDigest(match[2]) })) };
	checkCandidate(work); writeJson(join(work, "types.json"), receipt); return receipt;
}
export function validateReceipts(evidence) {
	for (const name of ["node", "bun", "types", "source"]) {
		const stage = evidence.stages[name]; assert(stage, `missing ${name} receipt`);
		assert.equal(stage.candidate, evidence.candidate, "receipt candidate mismatch");
		assert.equal(stage.outputs, evidence.outputs, "receipt output candidate mismatch");
		assert.equal(stage.status, "pass", `failed ${name} receipt`);
		assert(!stage.environment?.NODE_PATH && !stage.environment?.NODE_OPTIONS, "leaked runtime environment");
	}
	const environments = [evidence.stages.node.environment, ...[...evidence.stages.node.cases, ...evidence.stages.bun.cases].filter((row) => row.name !== "missing").map((row) => row.environment)];
	for (const env of environments) {
		assert(env?.HOME && env.agentDir && env.cwd && !env.NODE_PATH && !env.NODE_OPTIONS, "missing or leaked runtime environment");
		for (const path of [env.HOME, env.agentDir, env.cwd]) contained(evidence.work, resolve(path));
		assert(dirname(env.HOME) === dirname(env.agentDir) && env.cwd === join(dirname(env.HOME), "project"), "runtime environment is not case-isolated");
	}
	for (const name of CASES) assert(evidence.stages.node.cases?.some((row) => row.name === name && row.status === "pass"), `missing node matrix ${name}`);
	assert(evidence.stages.node.sdk?.events.some((row) => row.event === "sdk" && row.reload), "missing public SDK receipt");
	validateBunReceipt(evidence.stages.bun);
	assert(evidence.stages.types.declarationResolutions?.length > 0, "missing installed types receipt");
	for (const name of SOURCE_GROUPS) assert(evidence.stages.source.groups?.some((row) => row.name === name && row.status === "pass" && row.command && row.exitCode === 0 && row.logs?.length > 0), `missing source/preservation receipt: ${name}`);
}
function verify(work) {
	const candidate = checkCandidate(work);
	const stages = Object.fromEntries(["node", "bun", "types", "source"].map((name) => [name, readJson(join(work, `${name}.json`))]));
	validateReceipts({ work, candidate: candidate.candidate, outputs: candidate.outputsDigest, stages });
	for (const row of stages.node.resolved) assertPackage(row.path, candidate.tarballs.find((item) => item.name === row.name), join(work, "consumer"));
	assert.equal(fileDigest(stages.bun.binary.path), stages.bun.binary.sha256, "binary changed");
	for (const row of [stages.bun.entry, stages.bun.worker, stages.bun.registration, stages.bun.archive]) assert.equal(fileDigest(row.path), row.sha256, "compiled input/archive changed");
	assertFiles(work, stages.bun.assets);
	for (const row of stages.types.declarationResolutions) assert.equal(fileDigest(row.path), row.sha256, "declaration changed");
	for (const group of stages.source.groups) for (const log of group.logs) assert.equal(fileDigest(contained(work, resolve(work, log.path))), log.sha256, "source log changed");
	for (const row of [...stages.node.cases, ...stages.bun.cases]) {
		if (row.receipt.sha256) assert.equal(fileDigest(contained(work, row.receipt.path)), row.receipt.sha256, "runtime receipt changed");
		for (const log of row.command.logs) assert.equal(fileDigest(contained(work, resolve(work, log.path))), log.sha256, "runtime log changed");
	}
	return { status: "pass", candidate: candidate.candidate, outputs: candidate.outputsDigest, activation: "not-authorized", broadRequirements: "blocked-separate-gates" };
}
export function main(argv) {
	const [command, ...args] = argv;
	assert(["fingerprint", "prepare", "node", "bun", "types", "verify"].includes(command), "use fingerprint|prepare|node|bun|types|verify --work ROOT [--frozen-inputs SHA256]");
	if (command === "fingerprint") { assert.equal(args.length, 0); return { status: "fingerprint-only", candidate: digest(inputs(source)) }; }
	const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
	assert(args.length % 2 === 0 && Object.keys(options).length === args.length / 2 && Object.keys(options).every((key) => ["--work", "--frozen-inputs"].includes(key)), "invalid or repeated artifact arguments");
	const work = options["--work"];
	assert(work && process.env.OMK_NATIVE_ARTIFACT_ROOT === work, "--work must match explicit OMK_NATIVE_ARTIFACT_ROOT");
	if (command === "prepare") return prepare(source, work, options["--frozen-inputs"]);
	if (command === "node") return nodeStage(work);
	if (command === "bun") return runBun(work, runMatrix);
	if (command === "types") return typesStage(work);
	return verify(work);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try { const result = main(process.argv.slice(2)); console.log(JSON.stringify({ status: result.status ?? "prepared", candidate: result.candidate, activation: "not-authorized" })); }
	catch (error) { console.error(error.stack); process.exitCode = 1; }
}
