import { errorMonitor } from "node:events";
import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { TerminalResizeLog } from "./terminal-resize-log.ts";

export interface TerminalOutputStats {
	readonly writeCalls: number;
	/** Bytes offered to write, not a claim that the terminal displayed them. */
	readonly submittedBytes: number;
	readonly writeFalseCount: number;
	readonly drainCount: number;
	readonly errorCount: number;
	readonly peakWritableLength: number;
	readonly writableLength: number;
	readonly backpressured: boolean;
}

function writeLogPath(value: string): string {
	if (!value) return "";
	try {
		if (statSync(value).isDirectory()) {
			const now = new Date();
			const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
			return join(value, `tui-${ts}-${process.pid}.log`);
		}
	} catch {
		// A non-existing path is a filename, matching the existing debug-log contract.
	}
	return value;
}

/** The TerminalOutput of the running TUI: set on its first write, cleared by stop. */
let activeOutput: TerminalOutput | undefined;

/**
 * Raw terminal bytes written from outside the render path (completion BEL,
 * OSC 52 clipboard). While a TUI is writing they go through its
 * TerminalOutput, so output stats and the OMK_TUI_RESIZE_LOG byte offsets
 * count them; otherwise straight to stdout. May throw like stream.write.
 */
export function writeTerminalRaw(data: string): void {
	if (activeOutput) activeOutput.write(data);
	else process.stdout.write(data);
}

/**
 * Final resize-log lines still owed at process exit, for exits that skip stop
 * (a dead tty's EIO goes straight to process.exit). One exit listener serves
 * every TerminalOutput; stop removes its own entry, the next write re-adds it.
 */
const finalOnExit = new Set<() => void>();
let exitHooked = false;

/** Metadata-only observation. No paint queue, retries, or interception of error handling. */
export class TerminalOutput {
	private readonly stream: Writable;
	private readonly logPath: string;
	private observing = false;
	private readonly counters = {
		writeCalls: 0,
		submittedBytes: 0,
		writeFalseCount: 0,
		drainCount: 0,
		errorCount: 0,
		peakWritableLength: 0,
	};
	private readonly onDrain = () => {
		this.counters.drainCount++;
	};
	private readonly onError = () => {
		this.counters.errorCount++;
	};

	private readonly resizeLog: TerminalResizeLog | undefined;

	constructor(stream: Writable, log = "", resizeLog = process.env.OMK_TUI_RESIZE_LOG || "") {
		this.stream = stream;
		this.logPath = writeLogPath(log);
		this.resizeLog = resizeLog ? new TerminalResizeLog(resizeLog) : undefined;
		if (this.resizeLog) this.owesFinal();
	}

	private readonly finalLine = () => this.resizeLog?.final(this.counters.submittedBytes);

	private owesFinal(): void {
		finalOnExit.add(this.finalLine);
		if (exitHooked) return;
		exitHooked = true;
		process.once("exit", () => {
			for (const finalLine of finalOnExit) finalLine();
		});
	}

	/**
	 * Wraps a resize handler so each resize first logs the bytes written so far
	 * (OMK_TUI_RESIZE_LOG, see terminal-resize-log.ts). Returns the handler
	 * itself when the log is off, so an unset variable costs nothing per event.
	 */
	withResizeLog(onResize: () => void, size: () => { cols: number; rows: number }): () => void {
		const log = this.resizeLog;
		if (!log) return onResize;
		let prev = size();
		return () => {
			const next = size();
			log.resize(this.counters.submittedBytes, next.cols, next.rows, prev.cols, prev.rows);
			prev = next;
			onResize();
		};
	}

	write(data: string, log = false): void {
		if (!this.observing) {
			this.stream.on("drain", this.onDrain);
			this.stream.on(errorMonitor, this.onError);
			this.observing = true;
			activeOutput = this;
			if (this.resizeLog) this.owesFinal();
		}
		this.counters.writeCalls++;
		this.counters.submittedBytes += Buffer.byteLength(data, "utf8");
		try {
			// false still accepts the write. Never resend it.
			if (!this.stream.write(data)) this.counters.writeFalseCount++;
		} catch (error) {
			this.counters.errorCount++;
			throw error;
		}
		this.counters.peakWritableLength = Math.max(this.counters.peakWritableLength, this.stream.writableLength);
		if (log && this.logPath) {
			try {
				appendFileSync(this.logPath, data, { encoding: "utf8" });
			} catch {
				/* Explicit raw debug logging remains best-effort. */
			}
		}
	}

	snapshot(): TerminalOutputStats {
		return {
			...this.counters,
			writableLength: this.stream.writableLength,
			backpressured: this.stream.writableNeedDrain,
		};
	}

	stop(): void {
		this.finalLine();
		finalOnExit.delete(this.finalLine);
		this.stream.off("drain", this.onDrain);
		this.stream.off(errorMonitor, this.onError);
		this.observing = false;
		if (activeOutput === this) activeOutput = undefined;
	}
}
