import { sanitizeText } from "@oh-my-pi/pi-utils";
import { DEFAULT_MAX_BYTES } from "../tools/truncate";

export interface OutputSummary {
	output: string;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	/** Artifact ID for internal URL access (artifact://<id>) when truncated */
	artifactId?: string;
}

export interface OutputSinkOptions {
	artifactPath?: string;
	artifactId?: string;
	spillThreshold?: number;
	onChunk?: (chunk: string) => void;
}

function countNewlines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) count += 1;
	}
	return count;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return countNewlines(text) + 1;
}

function truncateStringToBytesFromEnd(text: string, maxBytes: number): { text: string; bytes: number } {
	const buf = Buffer.from(text, "utf-8");
	if (buf.length <= maxBytes) {
		return { text, bytes: buf.length };
	}

	let start = buf.length - maxBytes;
	while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
		start++;
	}

	const sliced = buf.subarray(start).toString("utf-8");
	return { text: sliced, bytes: Buffer.byteLength(sliced, "utf-8") };
}

/**
 * Line-buffered output sink with file spill support.
 *
 * Uses a single string buffer with line position tracking.
 * When memory limit exceeded, spills ~half to file in one batch operation.
 */
export class OutputSink {
	#buffer = "";
	#bufferBytes = 0;
	#totalLines = 0;
	#totalBytes = 0;
	#sawData = false;
	#truncated = false;
	#file?: {
		path: string;
		artifactId?: string;
		sink: Bun.FileSink;
	};
	readonly #artifactPath?: string;
	readonly #artifactId?: string;
	readonly #spillThreshold: number;
	readonly #onChunk?: (chunk: string) => void;

	constructor(options?: OutputSinkOptions) {
		const { artifactPath, artifactId, spillThreshold = DEFAULT_MAX_BYTES, onChunk } = options ?? {};

		this.#artifactPath = artifactPath;
		this.#artifactId = artifactId;
		this.#spillThreshold = spillThreshold;
		this.#onChunk = onChunk;
	}

	async #pushSanitized(data: string): Promise<void> {
		this.#onChunk?.(data);

		const dataBytes = Buffer.byteLength(data, "utf-8");
		this.#totalBytes += dataBytes;
		if (data.length > 0) {
			this.#sawData = true;
			this.#totalLines += countNewlines(data);
		}

		const bufferOverflow = this.#bufferBytes + dataBytes > this.#spillThreshold;
		const overflow = this.#file || bufferOverflow;
		const sink = overflow ? await this.#fileSink() : null;

		this.#buffer += data;
		this.#bufferBytes += dataBytes;
		await sink?.write(data);

		if (bufferOverflow) {
			this.#truncated = true;
			const trimmed = truncateStringToBytesFromEnd(this.#buffer, this.#spillThreshold);
			this.#buffer = trimmed.text;
			this.#bufferBytes = trimmed.bytes;
		}
		if (this.#file) {
			this.#truncated = true;
		}
	}

	async #fileSink(): Promise<Bun.FileSink | null> {
		if (!this.#artifactPath) return null;
		if (!this.#file) {
			try {
				this.#file = {
					path: this.#artifactPath,
					artifactId: this.#artifactId,
					sink: Bun.file(this.#artifactPath).writer(),
				};
				await this.#file.sink.write(this.#buffer);
			} catch {
				try {
					await this.#file?.sink?.end();
				} catch {}
				this.#file = undefined;
				return null;
			}
		}
		return this.#file.sink;
	}

	async push(chunk: string): Promise<void> {
		chunk = sanitizeText(chunk);
		await this.#pushSanitized(chunk);
	}

	createInput(): WritableStream<Uint8Array | string> {
		const dec = new TextDecoder("utf-8", { ignoreBOM: true });
		const finalize = async () => {
			await this.push(dec.decode());
		};

		return new WritableStream({
			write: async chunk => {
				if (typeof chunk === "string") {
					await this.push(chunk);
				} else {
					await this.push(dec.decode(chunk, { stream: true }));
				}
			},
			close: finalize,
			abort: finalize,
		});
	}

	async dump(notice?: string): Promise<OutputSummary> {
		const noticeLine = notice ? `[${notice}]\n` : "";
		const outputLines = countLines(this.#buffer);
		const outputBytes = this.#bufferBytes;
		const totalLines = this.#sawData ? this.#totalLines + 1 : 0;
		const totalBytes = this.#totalBytes;

		if (this.#file) {
			await this.#file.sink.end();
		}

		return {
			output: `${noticeLine}${this.#buffer}`,
			truncated: this.#truncated,
			totalLines,
			totalBytes,
			outputLines,
			outputBytes,
			artifactId: this.#file?.artifactId,
		};
	}
}
