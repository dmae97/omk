import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { nanoid } from "nanoid";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_COLUMN } from "./tools/truncate";

export interface OutputResult {
	output: string;
	truncated: boolean;
	fullOutputPath?: string;
}

export interface OutputSinkOptions {
	allocateFilePath?: () => string;
	spillThreshold?: number;
	maxColumn?: number;
	onLine?: (line: string) => void;
	onChunk?: (chunk: string) => void;
}

function defaultFilePathAllocator(): string {
	return join(tmpdir(), `omp-${nanoid()}.log`);
}

/**
 * Line-buffered output sink with file spill support.
 *
 * Uses a single string buffer with line position tracking.
 * When memory limit exceeded, spills ~half to file in one batch operation.
 */
export class OutputSink {
	private buffer = "";
	private lineEnds: number[] = []; // String index after each \n

	private fileSink?: Bun.FileSink;
	private filePath?: string;

	private readonly allocateFilePath: () => string;
	private readonly spillThreshold: number;
	private readonly maxColumn: number;
	private readonly onLine?: (line: string) => void;
	private readonly onChunk?: (chunk: string) => void;

	constructor(options?: OutputSinkOptions) {
		const {
			allocateFilePath = defaultFilePathAllocator,
			spillThreshold = DEFAULT_MAX_BYTES,
			maxColumn = DEFAULT_MAX_COLUMN,
			onLine,
			onChunk,
		} = options ?? {};

		this.allocateFilePath = allocateFilePath;
		this.spillThreshold = spillThreshold;
		this.maxColumn = maxColumn;
		this.onLine = onLine;
		this.onChunk = onChunk;
	}

	private pushLine(line: string, term?: string): void {
		while (line.length > this.maxColumn) {
			this.pushLine(line.slice(0, this.maxColumn), "--\n");
			line = line.slice(this.maxColumn);
		}

		this.buffer += line;
		if (term) {
			this.buffer += term;
		}

		this.lineEnds.push(this.buffer.length);
		this.onLine?.(line);

		if (this.buffer.length > this.spillThreshold) {
			this.spillHalf();
		}
	}

	private pushChunk(line: string): void {
		this.onChunk?.(line);
		this.pushLine(line);
	}

	private getFileSink(): Bun.FileSink {
		if (!this.fileSink) {
			const filePath = this.allocateFilePath();
			this.filePath = filePath;
			this.fileSink = Bun.file(filePath).writer();
		}
		return this.fileSink;
	}

	private spillHalf(): void {
		const target = this.buffer.length >>> 1;

		// Binary search: first line ending >= target
		let lo = 0;
		let hi = this.lineEnds.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (this.lineEnds[mid] < target) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}

		// Clamp: evict at least 1 line, keep at least 1 line
		const splitIdx = Math.max(1, Math.min(lo, this.lineEnds.length - 1));
		const splitPos = this.lineEnds[splitIdx - 1];

		// Write evicted portion to file
		this.getFileSink().write(this.buffer.slice(0, splitPos));

		// Truncate buffer, shift line positions
		this.buffer = this.buffer.slice(splitPos);
		const remaining = this.lineEnds.length - splitIdx;
		for (let i = 0; i < remaining; i++) {
			this.lineEnds[i] = this.lineEnds[i + splitIdx] - splitPos;
		}
		this.lineEnds.length = remaining;
	}

	createWritable(): WritableStream<Uint8Array> {
		const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
		let buf = "";

		const flushLines = () => {
			let start = 0;
			while (true) {
				const nl = buf.indexOf("\n", start);
				if (nl === -1) break;
				this.pushChunk(buf.slice(start, nl + 1));
				start = nl + 1;
			}
			buf = buf.slice(start);
		};

		const finalize = () => {
			buf += sanitizeText(decoder.decode());
			flushLines();
			buf = buf.trimEnd();
			if (buf) {
				this.pushChunk(`${buf}\n`);
			}
		};

		return new WritableStream<Uint8Array>({
			write: (chunk) => {
				buf += sanitizeText(decoder.decode(chunk, { stream: true }));
				flushLines();
			},
			close: finalize,
			abort: finalize,
		});
	}

	createStringWritable(): WritableStream<string> {
		let buf = "";

		const flushLines = () => {
			let start = 0;
			while (true) {
				const nl = buf.indexOf("\n", start);
				if (nl === -1) break;
				this.pushChunk(buf.slice(start, nl + 1));
				start = nl + 1;
			}
			buf = buf.slice(start);
		};

		const finalize = () => {
			flushLines();
			buf = buf.trimEnd();
			if (buf) {
				this.pushChunk(`${buf}\n`);
			}
		};

		return new WritableStream<string>({
			write: (chunk) => {
				buf += sanitizeText(chunk);
				flushLines();
			},
			close: finalize,
			abort: finalize,
		});
	}

	async close(): Promise<void> {
		await this.fileSink?.end();
	}

	dump(annotation?: string): OutputResult {
		let output = this.buffer;
		if (annotation) {
			output += `\n${annotation}\n`;
		}
		if (!this.filePath) {
			return { output, truncated: false };
		}
		this.fileSink!.write(this.buffer);
		this.fileSink!.flush();
		return {
			output,
			truncated: true,
			fullOutputPath: this.filePath,
		};
	}
}
