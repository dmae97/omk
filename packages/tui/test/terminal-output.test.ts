import assert from "node:assert/strict";
import { errorMonitor, once } from "node:events";
import { Writable } from "node:stream";
import { describe, it, mock } from "node:test";
import { ProcessTerminal } from "../src/terminal.ts";

function slowTerminal() {
	const chunks: string[] = [];
	const callbacks: ((error?: Error | null) => void)[] = [];
	const sink = new Writable({
		highWaterMark: 1,
		write(chunk, _encoding, callback) {
			chunks.push(String(chunk));
			callbacks.push(callback);
		},
	});
	const terminal = new ProcessTerminal(sink);
	assert.equal(typeof terminal.getOutputStats, "function");
	return {
		terminal,
		sink,
		chunks,
		callbacks,
		flush: () => {
			while (callbacks.length) callbacks.shift()?.();
		},
	};
}

describe("ProcessTerminal output observations", () => {
	it("counts UTF-8 bytes, observes false/drain, and never retransmits accepted frames", async () => {
		const { terminal, sink, chunks, flush } = slowTerminal();
		const first = "\x1b[?2026h한글🙂\x1b[?2026l";
		const second = "\x1b[?2026hnext\x1b[?2026l";
		terminal.write(first);
		terminal.write(second);
		const pending = terminal.getOutputStats();
		assert.equal(pending.writeCalls, 2);
		assert.equal(pending.submittedBytes, Buffer.byteLength(first + second));
		assert.equal(pending.writeFalseCount, 2);
		assert.equal(pending.backpressured, true);
		assert.equal(pending.peakWritableLength, Buffer.byteLength(first + second));
		const drained = once(sink, "drain");
		flush();
		await drained;
		assert.deepEqual(chunks, [first, second]);
		assert.equal(terminal.getOutputStats().drainCount, 1);
		assert.equal(terminal.getOutputStats().writableLength, 0);
		assert.equal(terminal.getOutputStats().backpressured, false);
		assert.equal(JSON.stringify(terminal.getOutputStats()).includes("한글"), false);
		terminal.stop();
		flush();
		sink.destroy();
	});

	it("observes cursor, clear, title and progress writes as well as paint and restoration", () => {
		const { terminal, sink, chunks, flush } = slowTerminal();
		terminal.moveBy(2);
		terminal.moveBy(-1);
		terminal.moveBy(0);
		terminal.hideCursor();
		terminal.showCursor();
		terminal.clearLine();
		terminal.clearFromCursor();
		terminal.clearScreen();
		terminal.setTitle("safe-title");
		terminal.setProgress(true);
		terminal.setProgress(false);
		terminal.write("paint");
		terminal.stop();
		flush();
		assert.equal(terminal.getOutputStats().writeCalls, chunks.length);
		assert.equal(terminal.getOutputStats().submittedBytes, Buffer.byteLength(chunks.join("")));
		assert.ok(chunks.includes("\x1b[?2004l"));
		assert.ok(chunks.includes("\x1b]0;safe-title\x07"));
		assert.equal(sink.listenerCount("drain"), 0);
		assert.equal(sink.listenerCount(errorMonitor), 0);
		sink.destroy();
	});

	it("observes async stdout errors without consuming the normal error event", async () => {
		const { terminal, sink, callbacks } = slowTerminal();
		const errors: Error[] = [];
		sink.on("error", (error) => errors.push(error));
		terminal.write("sensitive data must not be retained in stats");
		const closed = new Promise<void>((resolve) => sink.once("close", resolve));
		callbacks.shift()?.(new Error("EPIPE"));
		await closed;
		assert.equal(errors.length, 1);
		assert.equal(terminal.getOutputStats().errorCount, 1);
		assert.equal(JSON.stringify(terminal.getOutputStats()).includes("sensitive"), false);
		terminal.stop();
	});

	it("rethrows synchronous write failures and removes its listeners on stop", () => {
		const { terminal, sink, flush } = slowTerminal();
		const error = new Error("write failed");
		const patched = mock.method(sink, "write", () => {
			throw error;
		});
		assert.throws(
			() => terminal.write("data"),
			(actual) => actual === error,
		);
		assert.equal(terminal.getOutputStats().errorCount, 1);
		patched.mock.restore();
		terminal.stop();
		flush();
		assert.equal(sink.listenerCount(errorMonitor), 0);
		sink.destroy();
	});
});
