import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ProcessTerminal } from "../src/terminal.ts";
import { TerminalOutput, writeTerminalRaw } from "../src/terminal-output.ts";

const sink = () =>
	new Writable({
		write(_chunk, _encoding, callback) {
			callback();
		},
	});

const readLog = (path: string) =>
	readFileSync(path, "utf8")
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));

describe("OMK_TUI_RESIZE_LOG", () => {
	let dir = "";
	let logPath = "";
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "omk-resize-log-"));
		logPath = join(dir, "resize.jsonl");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("logs the omk-side UTF-8 byte offset and old/new size before the resize handler runs", () => {
		const output = new TerminalOutput(sink(), "", logPath);
		let size = { cols: 120, rows: 40 };
		const seen: number[] = [];
		const onResize = output.withResizeLog(
			() => seen.push(readLog(logPath).length),
			() => size,
		);
		output.write("\x1b[?2026h한글🙂\n\x1b[?2026l");
		size = { cols: 120, rows: 80 };
		onResize();
		output.write("next\n");
		size = { cols: 100, rows: 24 };
		onResize();

		const first = Buffer.byteLength("\x1b[?2026h한글🙂\n\x1b[?2026l");
		const lines = readLog(logPath);
		assert.equal(lines.length, 2);
		assert.deepEqual(
			lines.map(({ bytes, cols, rows, prevCols, prevRows }) => ({ bytes, cols, rows, prevCols, prevRows })),
			[
				{ bytes: first, cols: 120, rows: 80, prevCols: 120, prevRows: 40 },
				{ bytes: first + 5, cols: 100, rows: 24, prevCols: 120, prevRows: 80 },
			],
		);
		assert.ok(lines[0].t <= lines[1].t, "t is monotonic");
		assert.deepEqual(seen, [1, 2], "the line is on disk before the handler renders");
	});

	it("appends a final line with the total bytes on stop", () => {
		const output = new TerminalOutput(sink(), "", logPath);
		output.write("abc");
		output.write("한");
		output.stop();
		assert.deepEqual(readLog(logPath), [{ final: true, bytes: 3 + 3 }]);
	});

	it("writes the final line on process exit when stop never ran, once", () => {
		const moduleUrl = new URL("../src/terminal-output.ts", import.meta.url).href;
		const script = [
			`const { TerminalOutput } = await import(${JSON.stringify(moduleUrl)});`,
			"const { Writable } = await import('node:stream');",
			"const output = new TerminalOutput(new Writable({ write(_c, _e, cb) { cb(); } }), '', process.argv[1]);",
			"output.write('abc');",
			"if (process.argv[2] === 'stop') output.stop();",
			"process.exit(129);",
		].join("\n");
		for (const mode of ["exit", "stop"]) {
			rmSync(logPath, { force: true });
			const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, logPath, mode], {
				encoding: "utf8",
				cwd: fileURLToPath(new URL(".", import.meta.url)),
			});
			assert.equal(child.status, 129, child.stderr);
			assert.deepEqual(readLog(logPath), [{ final: true, bytes: 3 }], `mode ${mode}`);
		}
	});

	it("is read from the environment by ProcessTerminal, and stop writes the final line", () => {
		const previous = process.env.OMK_TUI_RESIZE_LOG;
		process.env.OMK_TUI_RESIZE_LOG = logPath;
		try {
			const terminal = new ProcessTerminal(sink());
			terminal.write("hello");
			terminal.stop();
		} finally {
			if (previous === undefined) delete process.env.OMK_TUI_RESIZE_LOG;
			else process.env.OMK_TUI_RESIZE_LOG = previous;
		}
		const lines = readLog(logPath);
		assert.deepEqual(lines.at(-1), { final: true, bytes: lines.at(-1).bytes });
		assert.ok(lines.at(-1).bytes >= 5, "counts everything written, including stop's own escape sequences");
	});

	it("costs nothing when unset: the handler is returned as is and no file is written", () => {
		const output = new TerminalOutput(sink(), "", "");
		const onResize = () => {};
		assert.equal(
			output.withResizeLog(onResize, () => ({ cols: 1, rows: 1 })),
			onResize,
		);
		output.write("x");
		output.stop();
		assert.equal(existsSync(logPath), false);
	});

	it("counts raw writes from outside the render path (BEL, OSC 52) in the logged byte offset", () => {
		const received: string[] = [];
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				received.push(String(chunk));
				callback();
			},
		});
		const output = new TerminalOutput(stream, "", logPath);
		const onResize = output.withResizeLog(
			() => {},
			() => ({ cols: 80, rows: 24 }),
		);
		output.write("frame\n");
		writeTerminalRaw("\u0007");
		writeTerminalRaw("\x1b]52;c;aGk=\x07");
		onResize();
		const raw = Buffer.byteLength("frame\n\u0007\x1b]52;c;aGk=\x07");
		assert.equal(readLog(logPath)[0].bytes, raw);
		assert.equal(output.snapshot().submittedBytes, raw);
		assert.deepEqual(
			received,
			["frame\n", "\u0007", "\x1b]52;c;aGk=\x07"],
			"raw writes go to the TUI's stream, in order",
		);

		output.stop();
		const original = process.stdout.write;
		const stdout: string[] = [];
		process.stdout.write = ((chunk: string) => {
			stdout.push(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			writeTerminalRaw("\u0007");
		} finally {
			process.stdout.write = original;
		}
		assert.deepEqual(stdout, ["\u0007"], "without a running TUI the write goes to stdout");
		assert.equal(received.length, 3);
	});
});
