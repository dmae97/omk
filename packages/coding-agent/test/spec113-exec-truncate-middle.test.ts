import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childSubagentEnv } from "../examples/extensions/subagent/nesting.ts";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import { type BashOperations, createBashTool } from "../src/core/tools/bash.ts";
import { formatBashOutput } from "../src/core/tools/bash-output.ts";
import { OutputAccumulator, type OutputSnapshot } from "../src/core/tools/output-accumulator.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../src/core/tools/truncate.ts";

const artifacts = new Set<string>();
afterEach(() => {
	vi.unstubAllEnvs();
	for (const file of artifacts) rmSync(file, { force: true });
	artifacts.clear();
});

interface Run {
	snapshot: OutputSnapshot;
	acc: OutputAccumulator;
	text: string;
	details: ReturnType<typeof formatBashOutput>["details"];
}

async function run(input: string | Buffer, headTail: boolean, chunkSize = 4096): Promise<Run> {
	const acc = new OutputAccumulator({ tempFilePrefix: "omk-bash", headTail });
	const bytes = typeof input === "string" ? Buffer.from(input) : input;
	for (let i = 0; i < bytes.length; i += chunkSize) acc.append(bytes.subarray(i, i + chunkSize));
	acc.finish();
	const snapshot = acc.snapshot({ persistIfTruncated: true });
	await acc.closeTempFile();
	if (snapshot.fullOutputPath) artifacts.add(snapshot.fullOutputPath);
	const { text, details } = formatBashOutput(snapshot, acc.getLastLineBytes());
	return { snapshot, acc, text, details };
}

const lines = (n: number, make = (i: number) => `line ${i}`) =>
	`${Array.from({ length: n }, (_, i) => make(i + 1)).join("\n")}\n`;
const FIXTURES: Record<string, string> = {
	small: "hello\nworld\n",
	lines3000: lines(3000),
	oneLine200k: "x".repeat(200 * 1024),
};
// sha256 of JSON {text, details} with the temp path replaced, taken with the code at 9617e1effb / 3a4e730f4a.
const GOLDEN: Record<string, string> = {
	small: "db22f76246db6f99959c9e81709594ade0a30bb262b6eb2dd719cbabda90a1c8",
	lines3000: "00870146f104f42284df06d627bc4b8ea4d47c1dd3291887ddd52f34aa283e37",
	oneLine200k: "f4ca406fd8d742ecbaf0a8419b253a47809504c4df184c25b2679920028a72fc",
};
function digest(r: Run): string {
	const path = r.snapshot.fullOutputPath ?? "<none>";
	const ser = JSON.stringify({ text: r.text, details: r.details }).split(path).join("<PATH>");
	return createHash("sha256").update(ser).digest("hex");
}
const bytesOf = (s: string) => Buffer.byteLength(s, "utf-8");
const lineCount = (s: string) => (s.length === 0 ? 0 : s.split("\n").length - (s.endsWith("\n") ? 1 : 0));
function markerOf(content: string): string {
	const m = content.split("\n").find((l) => l.startsWith("[... omitted "));
	if (!m) throw new Error("no marker");
	return m;
}
/** `tail` is as shown (truncateTail drops the final "\n", like the off arm); `tailRaw` adds it back. */
function split(content: string, input?: string): { head: string; tail: string; tailRaw: string; marker: string } {
	const marker = markerOf(content);
	const at = content.indexOf(`${marker}\n`);
	const tail = content.slice(at + marker.length + 1);
	const tailRaw = input?.endsWith("\n") && tail.length > 0 && !tail.endsWith("\n") ? `${tail}\n` : tail;
	return { head: content.slice(0, at), marker, tail, tailRaw };
}

describe("spec 113: OMK_EXEC_TRUNCATE_MIDDLE", () => {
	it("1. flag off is byte-identical to the baseline for 3 fixtures", async () => {
		for (const [name, input] of Object.entries(FIXTURES)) {
			const r = await run(input, false);
			expect(digest(r), name).toBe(GOLDEN[name]);
			expect(r.snapshot.truncation.strategy).toBeUndefined();
		}
	});

	it("2. on, under limits: identical to off (no marker, no temp file)", async () => {
		const input = lines(100);
		const off = await run(input, false);
		const on = await run(input, true);
		expect(on.text).toBe(off.text);
		expect(on.details).toEqual(off.details);
		expect(on.snapshot.fullOutputPath).toBeUndefined();
		expect(on.text).not.toContain("[... omitted");
	});

	it("3. on, 5000 short lines: first 999 lines, marker, last lines within limits", async () => {
		const input = lines(5000);
		const r = await run(input, true);
		const { head, tail, tailRaw } = split(r.snapshot.content, input);
		expect(head).toBe(lines(999));
		expect(input.endsWith(tailRaw)).toBe(true);
		expect(lineCount(r.snapshot.content)).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
		expect(bytesOf(r.snapshot.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		const t = r.snapshot.truncation;
		expect(t.strategy).toBe("head-tail");
		expect(t.headLines).toBe(999);
		expect(t.omittedLines).toBe(5000 - 999 - lineCount(tail));
		expect(r.text).toContain(`[Showing lines 1-999 and ${5000 - lineCount(tail) + 1}-5000 of 5000 (50.0KB limit).`);
	});

	it("4. on, byte-limited (500 x 1KB lines): head <= floor((51200 - M)/2), exact omitted bytes", async () => {
		const input = lines(500, (i) => `${String(i).padStart(5, "0")}${"y".repeat(1018)}`);
		const r = await run(input, true);
		const { head, marker, tailRaw: tail } = split(r.snapshot.content, input);
		const M = bytesOf(marker) + 1;
		expect(bytesOf(head)).toBeLessThanOrEqual(Math.floor((DEFAULT_MAX_BYTES - M) / 2));
		expect(bytesOf(r.snapshot.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(r.snapshot.truncation.omittedBytes).toBe(bytesOf(input) - bytesOf(head) - bytesOf(tail));
		expect(r.snapshot.truncation.truncatedBy).toBe("bytes");
	});

	it("5. on, single 200KB line: code-point prefix, marker says inside line 1", async () => {
		const input = "z".repeat(200 * 1024);
		const r = await run(input, true);
		const t = r.snapshot.truncation;
		expect(markerOf(r.snapshot.content)).toContain("inside line 1");
		expect(t.omittedLines).toBe(0);
		expect(t.headLines).toBe(1);
		expect(bytesOf(r.snapshot.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(r.text).toContain("[Showing lines 1-1 and 1-1 of 1");
	});

	it("6. on, just over the limit (51,300 bytes): no byte shown twice", async () => {
		const input = lines(513, (i) => `${String(i).padStart(4, "0")}${"q".repeat(95)}`);
		expect(bytesOf(input)).toBe(51_300);
		const r = await run(input, true);
		const { head, tailRaw: tail } = split(r.snapshot.content, input);
		expect(input.startsWith(head)).toBe(true);
		expect(input.endsWith(tail)).toBe(true);
		expect(bytesOf(head) + bytesOf(tail)).toBeLessThanOrEqual(bytesOf(input));
		const kept = new Set([...head.split("\n"), ...tail.split("\n")].filter(Boolean));
		expect(kept.size).toBe(lineCount(head) + lineCount(tail));
	});

	it("7. UTF-8: 3/4-byte chars split across chunk borders keep valid text", async () => {
		const unit = "한글😀ab\n";
		const input = Buffer.from(unit.repeat(8000));
		for (let offset = 0; offset <= 3; offset++) {
			const acc = new OutputAccumulator({ tempFilePrefix: "omk-bash", headTail: true });
			acc.append(input.subarray(0, offset));
			for (let i = offset; i < input.length; i += 4097) acc.append(input.subarray(i, i + 4097));
			acc.finish();
			const s = acc.snapshot();
			expect(s.content).not.toContain("\uFFFD");
			expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s.content)).toBe(false);
			expect(Buffer.from(s.content, "utf-8").toString("utf-8")).toBe(s.content);
		}
		const single = Buffer.from("가😀".repeat(30_000));
		for (let offset = 0; offset <= 3; offset++) {
			const acc = new OutputAccumulator({ headTail: true });
			acc.append(single.subarray(0, offset));
			for (let i = offset; i < single.length; i += 1001) acc.append(single.subarray(i, i + 1001));
			acc.finish();
			const c = acc.snapshot().content;
			expect(c).not.toContain("\uFFFD");
			expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(c)).toBe(false);
		}
	});

	it("8. streaming: head frozen mid-stream, final equals one-shot", async () => {
		const input = Buffer.from(lines(6000));
		const acc = new OutputAccumulator({ headTail: true });
		let firstHead: string | undefined;
		let lastTail = "";
		for (let i = 0; i < input.length; i += 2048) {
			acc.append(input.subarray(i, i + 2048));
			const s = acc.snapshot();
			if (!s.truncation.truncated) continue;
			const { head, tail } = split(s.content);
			firstHead ??= head;
			expect(head).toBe(firstHead);
			expect(tail).not.toBe(lastTail);
			lastTail = tail;
		}
		acc.finish();
		const final = acc.snapshot();
		const oneShot = new OutputAccumulator({ headTail: true });
		oneShot.append(input);
		oneShot.finish();
		const one = oneShot.snapshot();
		for (const p of [final.fullOutputPath, one.fullOutputPath]) if (p) artifacts.add(p);
		await acc.closeTempFile();
		await oneShot.closeTempFile();
		const norm = (s: OutputSnapshot) => s.content.split(s.fullOutputPath ?? "<none>").join("<PATH>");
		expect(norm(final)).toBe(norm(one));
	});

	it("9. truncated and truncatedBy are equal off and on", async () => {
		const fixtures = { ...FIXTURES, l5000: lines(5000), kb: lines(500, () => "k".repeat(1023)) };
		for (const input of Object.values(fixtures)) {
			const off = (await run(input, false)).snapshot.truncation;
			const on = (await run(input, true)).snapshot.truncation;
			expect(on.truncated).toBe(off.truncated);
			expect(on.truncatedBy).toBe(off.truncatedBy);
			expect(on.totalLines).toBe(off.totalLines);
			expect(on.totalBytes).toBe(off.totalBytes);
		}
	});

	it.skipIf(process.platform === "win32")("10. temp file is the raw bytes, mode 0600, in both arms", async () => {
		const input = Buffer.concat([Buffer.from(lines(3000)), Buffer.from([0xff, 0xfe, 0x0a])]);
		for (const headTail of [false, true]) {
			const r = await run(input, headTail, 777);
			const path = r.snapshot.fullOutputPath!;
			expect(readFileSync(path).equals(input)).toBe(true);
			expect(statSync(path).mode & 0o777).toBe(0o600);
		}
	});

	it("11. marker numbers match a brute-force count from the temp file", async () => {
		const input = lines(4321, (i) => `row-${i}-${"m".repeat(i % 50)}`);
		const r = await run(input, true);
		const full = readFileSync(r.snapshot.fullOutputPath!, "utf-8");
		const { head, marker, tailRaw: tail } = split(r.snapshot.content, full);
		const a = lineCount(head);
		const N = lineCount(full);
		const b = N - lineCount(tail) + 1;
		const L = b - a - 1;
		const S = bytesOf(full) - bytesOf(head) - bytesOf(tail);
		const kb = (n: number) => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`);
		expect(full.startsWith(head) && full.endsWith(tail)).toBe(true);
		expect(marker).toBe(
			`[... omitted ${L} lines (${kb(S)}) of ${N} lines (${kb(bytesOf(full))}) between line ${a} and line ${b}. Full output: ${r.snapshot.fullOutputPath} (use read with offset/limit to see the middle) ...]`,
		);
		// The accumulator always opens the temp file once a limit is passed, so the
		// "Full output could not be saved." text is a defensive fallback only.
	});

	it("12. head ending mid-line puts the marker on its own line", async () => {
		const input = `${"w".repeat(120_000)}\n${lines(10)}`;
		const r = await run(input, true);
		const parts = r.snapshot.content.split("\n");
		expect(parts[0]).toMatch(/^w+$/);
		expect(parts[1].startsWith("[... omitted ")).toBe(true);
		expect(bytesOf(r.snapshot.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it.skipIf(process.platform === "win32")("13. RTK applied output is unchanged with the flag on", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-113-rtk-"));
		try {
			writeFileSync(
				join(dir, "rtk"),
				"#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>process.stdout.write('Tests: 120 passed\\n'));\n",
				{ mode: 0o700 },
			);
			chmodSync(join(dir, "rtk"), 0o700);
			vi.stubEnv("OMK_RTK_OUTPUT", "1");
			vi.stubEnv("OMK_RTK_PATH", join(dir, "rtk"));
			const raw = `${Array.from({ length: 30 }, (_, i) => ` ✓ test/case-${i}.test.ts (4 tests)`).join("\n")}\n Test Files 30 passed (30)\n Tests 120 passed (120)\n`;
			const command = "node node_modules/vitest/dist/cli.js --run test/example.test.ts";
			const texts: string[] = [];
			for (const flag of ["0", "1"]) {
				vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", flag);
				const exec = vi.fn<BashOperations["exec"]>(async (_c, _cwd, { onData }) => {
					onData(Buffer.from(raw));
					return { exitCode: 0 };
				});
				const result = await createBashTool(dir, { operations: { exec } }).execute("call", { command });
				const text = result.content[0].type === "text" ? result.content[0].text : "";
				const path = text.match(/Full output: ([^\]\n]+)/)?.[1];
				if (path) artifacts.add(path);
				expect(result.details).toMatchObject({ outputFilter: { status: "applied" } });
				texts.push(text.replace(/Full output: [^\]\n]+/, "Full output: <PATH>"));
			}
			expect(texts[1]).toBe(texts[0]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("14. env: worker inherits the flag; flag read per call; description unchanged", async () => {
		vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", "1");
		// The subagent extension spawns workers with subagentWorkerEnv(childSubagentEnv(process.env), ...).
		const workerEnv = subagentWorkerEnv(childSubagentEnv(process.env), "0", "lead-113");
		expect(workerEnv.OMK_EXEC_TRUNCATE_MIDDLE).toBe("1");
		const child = spawnSync(
			process.execPath,
			["-e", "process.stdout.write(process.env.OMK_EXEC_TRUNCATE_MIDDLE ?? 'unset')"],
			{
				env: workerEnv,
				encoding: "utf-8",
			},
		);
		expect(child.stdout).toBe("1");

		const big = lines(5000);
		const exec = vi.fn<BashOperations["exec"]>(async (_c, _cwd, { onData }) => {
			onData(Buffer.from(big));
			return { exitCode: 0 };
		});
		const bash = createBashTool(process.cwd(), { operations: { exec } });
		const call = async () => {
			const r = await bash.execute("call", { command: "seq 5000" });
			const text = r.content[0].type === "text" ? r.content[0].text : "";
			const path = text.match(/Full output: ([^\]\n]+)/)?.[1];
			if (path) artifacts.add(path);
			return text;
		};
		const onText = await call();
		expect(onText).toContain("[... omitted ");
		expect(onText.startsWith("line 1\n")).toBe(true);
		const descOn = bash.description;
		vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", "0");
		const offText = await call();
		expect(offText).not.toContain("[... omitted ");
		expect(createBashTool(process.cwd(), { operations: { exec } }).description).toBe(descOn);
		expect(descOn).toContain("truncated to last 2000 lines or 50KB");
	});

	it("14b. default on: unset/empty shows head+tail; 0/false/off restore tail-only", async () => {
		const big = lines(5000);
		const exec = vi.fn<BashOperations["exec"]>(async (_c, _cwd, { onData }) => {
			onData(Buffer.from(big));
			return { exitCode: 0 };
		});
		const bash = createBashTool(process.cwd(), { operations: { exec } });
		const call = async () => {
			const r = await bash.execute("call", { command: "seq 5000" });
			const text = r.content[0].type === "text" ? r.content[0].text : "";
			const path = text.match(/Full output: ([^\]\n]+)/)?.[1];
			if (path) artifacts.add(path);
			return text;
		};
		vi.unstubAllEnvs();
		delete process.env.OMK_EXEC_TRUNCATE_MIDDLE;
		expect(await call()).toContain("[... omitted ");
		vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", "");
		expect(await call()).toContain("[... omitted ");
		for (const flag of ["0", "false", "off"]) {
			vi.stubEnv("OMK_EXEC_TRUNCATE_MIDDLE", flag);
			expect(await call()).not.toContain("[... omitted ");
		}
	});

	it("15. memory: 50MB streamed keeps retained text <= head budget + 4 x maxBytes", () => {
		const acc = new OutputAccumulator({ headTail: true });
		const block = Buffer.from(lines(1000, (i) => `${i}${"r".repeat(60)}`));
		let fed = 0;
		while (fed < 50 * 1024 * 1024) {
			acc.append(block);
			fed += block.length;
			const internal = acc as unknown as { head: { text: string }; tailText: string };
			expect(bytesOf(internal.head.text) + bytesOf(internal.tailText)).toBeLessThanOrEqual(
				Math.floor(DEFAULT_MAX_BYTES / 2) + 4 * DEFAULT_MAX_BYTES,
			);
		}
		acc.finish();
		const s = acc.snapshot();
		expect(bytesOf(s.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});
});
