import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRecordingWorkDir, inventory, normalizeJsonl, parseJson, privacyScan, validateManifest } from "../fixtures/contract-fixture-utils.mjs";
import { recordRpc } from "../fixtures/contract-rpc-recording.mjs";

const fixtures = fileURLToPath(new URL("../../native/omk-contract/tests/fixtures/", import.meta.url));
const rows = () => readFileSync(join(fixtures, "rpc-transcript.jsonl"), "utf8").trimEnd().split("\n").map(parseJson);

test("the repository check compares fresh contracts after native toolchain setup", () => {
	const { scripts } = parseJson(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
	assert.equal(scripts["check:contracts"], "node scripts/check-contract-drift.mjs && node scripts/check-capability-matrix.mjs && node scripts/record-contract-fixtures.mjs --check");
	const native = scripts.check.indexOf("npm run check:native");
	const contracts = scripts.check.indexOf("npm run check:contracts");
	assert.ok(native >= 0 && contracts > native);
	assert.ok(contracts < scripts.check.indexOf("npm run check:constitution"));
});

test("RPC fixtures preserve numeric prompt_settled durationMs", () => {
	const settled = rows().filter((row) => row.direction === "out").map((row) => row.message).filter((row) => row.type === "prompt_settled");
	assert.equal(settled.length, 2);
	for (const row of settled) {
		assert.equal(typeof row.durationMs, "number");
		assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0);
	}
});

test("RPC recorder waits for the first actual response before sending a prompt", () => {
	const transcript = rows();
	const state = transcript.findIndex((row) => row.direction === "out" && row.message.type === "response" && row.message.id === "state-1");
	const prompt = transcript.findIndex((row) => row.direction === "in" && row.message.type === "prompt");
	assert.ok(state >= 0 && prompt > state, "outgoing get_state must not satisfy its own response wait");
});

test("normalization changes typed durations without changing synthetic text", () => {
	const source = { type: "prompt_settled", durationMs: 12.125, note: '"durationMs":99' };
	assert.deepEqual(parseJson(normalizeJsonl(JSON.stringify(source), [])), { ...source, durationMs: 0 });
	assert.throws(() => normalizeJsonl('{"type":"prompt_settled","durationMs":"<ms>"}', []), /durationMs/);
	assert.throws(() => normalizeJsonl('{"type":"prompt_settled","durationMs":-1}', []), /durationMs/);
	assert.throws(() => normalizeJsonl('{', []), /invalid fixture JSON/);
	const observed = { systemPrompt: "docs /synthetic/package", systemPromptCacheBoundary: 2372, usage: { input: 1236, totalTokens: 1255 } };
	assert.deepEqual(parseJson(normalizeJsonl(JSON.stringify(observed), [["/synthetic/package", "<pkg>"]])), {
		...observed, systemPrompt: "docs <pkg>",
	}, "path normalization must not rewrite observed cache offsets or token usage");
});

test("manifest rejects changed hashes, missing files, unexpected files and duplicate paths", () => {
	const dir = mkdtempSync(join(tmpdir(), "contract-manifest-test-"));
	try {
		writeFileSync(join(dir, "one.json"), "{}");
		const manifest = { schema: "omk.contract.fixtures.v2", files: inventory(dir) };
		const save = () => writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
		save();
		validateManifest(dir);
		writeFileSync(join(dir, "extra.json"), "{}");
		assert.throws(() => validateManifest(dir), /digest mismatch/);
		rmSync(join(dir, "extra.json"));
		writeFileSync(join(dir, "one.json"), "[]");
		assert.throws(() => validateManifest(dir), /digest mismatch/);
		rmSync(join(dir, "one.json"));
		assert.throws(() => validateManifest(dir), /digest mismatch/);
		manifest.files.push(manifest.files[0]); save();
		assert.throws(() => validateManifest(dir), /duplicate/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("privacy scan rejects credential fields and path leaks before publication", () => {
	const dir = mkdtempSync(join(tmpdir(), "contract-privacy-test-"));
	try {
		writeFileSync(join(dir, "record.json"), '{"password":"synthetic-denial-test"}');
		assert.throws(() => privacyScan(dir), /credential field/);
		writeFileSync(join(dir, "record.json"), '{"cwd":"/home/synthetic/path"}');
		assert.throws(() => privacyScan(dir), /private path/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sending a command cannot satisfy its own RPC response wait", async () => {
	await assert.rejects(recordRpc(process.execPath, ["-e", "process.stdin.resume()"], { timeoutMs: 100 }), /RPC timeout/);
});

test("RPC spawn failure is handled without unhandled stream errors", async () => {
	await assert.rejects(recordRpc("/missing/contract-fixture-node", [], { timeoutMs: 1000 }), /spawn failed|stdin failed/);
});

test("RPC rejection is not mistaken for an acknowledgement", async () => {
	const code = `process.stdin.once('data', () => process.stdout.write(JSON.stringify({type:'response',id:'state-1',command:'get_state',success:false,error:'synthetic'})+'\\n'));`;
	await assert.rejects(recordRpc(process.execPath, ["-e", code], { timeoutMs: 1000 }), /command rejected/);
});

const successfulDriver = `
const readline = require('node:readline');
let count = 0;
const lines = readline.createInterface({input:process.stdin});
lines.on('line', text => {
 const command = JSON.parse(text);
 process.stdout.write(JSON.stringify({type:'response',command:command.type,id:command.id,success:true})+'\\n');
 if (command.type === 'prompt') {
  count++;
  const row = Buffer.from(JSON.stringify({type:'prompt_settled',durationMs:count,text:'한글'})+'\\n');
  process.stdout.write(row.subarray(0,row.length-4));
  process.stdout.write(row.subarray(row.length-4));
 }
});
`;

test("successful transcript distinguishes directions and drains UTF-8 before close", async () => {
	const transcript = await recordRpc(process.execPath, ["-e", successfulDriver], { timeoutMs: 2000 });
	assert.equal(transcript.filter((row) => row.direction === "in").length, 4);
	assert.equal(transcript.filter((row) => row.message.type === "prompt_settled").length, 2);
	assert.equal(transcript.find((row) => row.message.text)?.message.text, "한글");
});

test("nonzero exit invalidates an otherwise complete transcript", async () => {
	await assert.rejects(recordRpc(process.execPath, ["-e", successfulDriver + "\nlines.on('close',()=>process.exit(7));"], { timeoutMs: 2000 }), /unsuccessfully/);
});

test("recording paths preserve the reviewed input widths and reject roots that cannot fit", () => {
	const parent = mkdtempSync(join(tmpdir(), "c0-"));
	try {
		for (const root of [parent, join(parent, "nested")]) {
			mkdirSync(root, { recursive: true });
			const work = createRecordingWorkDir(root);
			assert.equal(work.length, 45);
			assert.equal(join(work, "tmp").length, 49);
			assert.equal(join(work, "tmp", "omk-g0-123456", "pkg").length, 67);
			assert.equal(work.startsWith(root), true);
			rmSync(work, { recursive: true });
			const rpcWork = createRecordingWorkDir(root, 44);
			assert.equal(join(rpcWork, "p").length, 46);
			assert.equal(rpcWork.startsWith(root), true);
			rmSync(rpcWork, { recursive: true });
		}
		const before = readdirSync(parent);
		assert.throws(() => createRecordingWorkDir(join(parent, "x".repeat(50))), /shorter absolute temporary root/);
		assert.throws(() => createRecordingWorkDir("relative"), /shorter absolute temporary root/);
		assert.deepEqual(readdirSync(parent), before, "invalid roots must fail before creating a directory");
	} finally { rmSync(parent, { recursive: true, force: true }); }
});

test("fresh contract recordings match unchanged goldens across temporary-root lengths", { timeout: 180_000 }, () => {
	const parent = mkdtempSync(join(tmpdir(), "c0-"));
	const before = { files: inventory(fixtures), manifest: readFileSync(join(fixtures, "manifest.json"), "utf8") };
	try {
		for (const root of [parent, join(parent, "nested")]) {
			mkdirSync(root, { recursive: true });
			const env = { HOME: join(parent, "home"), TMPDIR: root, TEMP: root, TMP: root };
			for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
			const result = spawnSync(process.execPath, ["scripts/record-contract-fixtures.mjs", "--check"], {
				cwd: new URL("../../", import.meta.url), env, encoding: "utf8", timeout: 80_000, maxBuffer: 16 * 1024 * 1024,
			});
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.match(result.stdout, /10 fixtures match a fresh recording/);
		}
	} finally {
		rmSync(parent, { recursive: true, force: true });
		assert.deepEqual(inventory(fixtures), before.files, "recording checks must not rewrite goldens");
		assert.equal(readFileSync(join(fixtures, "manifest.json"), "utf8"), before.manifest);
	}
});
