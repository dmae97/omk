import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";

const id = "a".repeat(32);
const prefix =
	`{"kind":"accepted","requestId":"${id}","hostPid":7,"hostTicks":"99"}\n` +
	'{"kind":"ready","identity":{"pid":4242,"startTicks":"987654","namespace":"pid:[4026532000]","bootId":"0123abcd-0000-4000-8000-00000000beef"}}\n' +
	'{"kind":"committed"}\n';
const terminal = '{"kind":"finished","exitCode":0,"failure":null,"durationMs":5}\n';
let dir: string;
let path: string;
let head: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "native-head-"));
	path = join(dir, `${id}.jsonl`);
	head = join(dir, `${id}.head`);
	writeFileSync(path, prefix + terminal, { mode: 0o600 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Rust execution record committed prefix", () => {
	it("does not expose a complete terminal append until its durable head advances", () => {
		writeFileSync(head, `${Buffer.byteLength(prefix)}\n`, { mode: 0o600 });
		expect(readRustExecutionRecord(dir, id, 4096)?.terminal).toBeNull();
		writeFileSync(head, `${Buffer.byteLength(prefix + terminal)}\n`);
		expect(readRustExecutionRecord(dir, id, 4096)?.terminal).toMatchObject({ kind: "finished", failure: null });
	});
	it.each(["0\n", "-1\n", "9999999\n", "garbage\n", `${Buffer.byteLength(prefix) - 1}\n`])(
		"refuses an invalid head %j",
		(value) => {
			writeFileSync(head, value, { mode: 0o600 });
			expect(() => readRustExecutionRecord(dir, id, 4096)).toThrow(/integrity/);
		},
	);
	it("rejects a shared or symlinked commit marker", () => {
		writeFileSync(head, `${Buffer.byteLength(prefix)}\n`, { mode: 0o600 });
		chmodSync(head, 0o644);
		expect(() => readRustExecutionRecord(dir, id, 4096)).toThrow(/integrity/);
		rmSync(head);
		symlinkSync(path, head);
		expect(() => readRustExecutionRecord(dir, id, 4096)).toThrow(/integrity/);
	});
});
