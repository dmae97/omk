import { errorMonitor } from "node:events";
import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";

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

	constructor(stream: Writable, log = "") {
		this.stream = stream;
		this.logPath = writeLogPath(log);
	}

	write(data: string, log = false): void {
		if (!this.observing) {
			this.stream.on("drain", this.onDrain);
			this.stream.on(errorMonitor, this.onError);
			this.observing = true;
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
		this.stream.off("drain", this.onDrain);
		this.stream.off(errorMonitor, this.onError);
		this.observing = false;
	}
}
