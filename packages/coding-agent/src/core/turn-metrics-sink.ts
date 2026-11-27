import fs from "node:fs";
import path from "node:path";
import { buildTurnMetricRecord, type TurnMetricInput } from "./turn-metrics-record.ts";

/** Rotate once the active file passes this size. */
export const DEFAULT_MAX_METRICS_BYTES = 8 * 1024 * 1024;

export interface TurnMetricsSinkOptions {
	readonly dir: string;
	readonly maxBytes?: number;
	readonly fileName?: string;
}

/**
 * Append-only JSONL sink. Writes are synchronous and best-effort: metrics must
 * never be the reason a turn fails, so every filesystem error is swallowed and
 * counted instead of thrown.
 */
export class TurnMetricsSink {
	private readonly filePath: string;
	private readonly maxBytes: number;
	private dropped = 0;
	private written = 0;
	private rotationFailures = 0;

	constructor(options: TurnMetricsSinkOptions) {
		this.filePath = path.join(options.dir, options.fileName ?? "turns.jsonl");
		this.maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_MAX_METRICS_BYTES);
	}

	get path(): string {
		return this.filePath;
	}

	/** Records written successfully this process. */
	get writtenCount(): number {
		return this.written;
	}

	/** Records lost to a filesystem error this process. */
	get droppedCount(): number {
		return this.dropped;
	}

	/** Records dropped because a required size-bound rotation failed. */
	get rotationFailureCount(): number {
		return this.rotationFailures;
	}

	/** Append one turn. Returns `true` when the line reached disk. */
	record(input: TurnMetricInput): boolean {
		let line: string;
		try {
			line = `${JSON.stringify(buildTurnMetricRecord(input))}\n`;
		} catch {
			this.dropped++;
			return false;
		}
		const bytes = Buffer.byteLength(line, "utf8");
		if (bytes > this.maxBytes) {
			this.dropped++;
			return false;
		}
		try {
			fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
			if (!this.rotateIfNeeded(bytes)) return false;
			fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
			this.written++;
			return true;
		} catch {
			this.dropped++;
			return false;
		}
	}

	private rotateIfNeeded(incomingBytes: number): boolean {
		let size: number;
		try {
			size = fs.statSync(this.filePath).size;
		} catch {
			return true; // No file yet.
		}
		if (size + incomingBytes <= this.maxBytes) return true;
		try {
			// Single generation: the previous file is replaced, so disk use stays bounded at 2x.
			fs.renameSync(this.filePath, `${this.filePath}.1`);
			return true;
		} catch {
			// Enforce maxBytes cap: drop incoming metric and count failure without breaking coding turns.
			this.rotationFailures++;
			this.dropped++;
			return false;
		}
	}
}
