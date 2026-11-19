import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inventory, normalizeJsonl, parseJson, privacyScan, validateManifest } from "../fixtures/contract-fixture-utils.mjs";
import { recordRpc } from "../fixtures/contract-rpc-recording.mjs";

const fixtures = fileURLToPath(new URL("../../native/omk-contract/tests/fixtures/", import.meta.url));
const rows = () => readFileSync(join(fixtures, "rpc-transcript.jsonl"), "utf8").trimEnd().split("\n").map(parseJson);

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
