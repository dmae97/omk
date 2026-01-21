import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { nanoid } from "nanoid";
import { DEFAULT_MAX_BYTES } from "./tools/truncate";

export interface OutputResult {
	output: string;
	truncated: boolean;
	fullOutputPath?: string;
}

export interface OutputSinkOptions {
	allocateFilePath?: () => string;
	spillThreshold?: number;
	maxColumn?: number;
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
	#buffer = "";
	#file?: {
		path: string;
		sink: Bun.FileSink;
	};
	#bytesWritten: number = 0;

	readonly #allocateFilePath: () => string;
	readonly #spillThreshold: number;
	readonly #onChunk?: (chunk: string) => void;

	constructor(options?: OutputSinkOptions) {
		const {
			allocateFilePath = defaultFilePathAllocator,
			spillThreshold = DEFAULT_MAX_BYTES,
			onChunk,
		} = options ?? {};

		this.#allocateFilePath = allocateFilePath;
		this.#spillThreshold = spillThreshold;
		this.#onChunk = onChunk;
	}

	async #pushSanitized(data: string): Promise<void> {
		this.#onChunk?.(data);
		const dataBytes = Buffer.byteLength(data);
		const overflow = dataBytes + this.#bytesWritten > this.#spillThreshold || this.#file != null;

		const sink = overflow ? await this.#fileSink() : null;

		this.#buffer += data;
		await sink?.write(data);

		if (this.#buffer.length > this.#spillThreshold) {
			this.#buffer = this.#buffer.slice(-this.#spillThreshold);
		}
	}

	async #fileSink(): Promise<Bun.FileSink> {
		if (!this.#file) {
			const filePath = this.#allocateFilePath();
			this.#file = {
				path: filePath,
				sink: Bun.file(filePath).writer(),
			};
			await this.#file.sink.write(this.#buffer);
		}
		return this.#file.sink;
	}

	async push(chunk: string): Promise<void> {
		chunk = sanitizeText(chunk);
		await this.#pushSanitized(chunk);
	}

	createInput(): WritableStream<Uint8Array | string> {
		let decoder: TextDecoder | undefined;
		let finalize = async () => {};

		return new WritableStream<Uint8Array | string>({
			write: async (chunk) => {
				if (typeof chunk === "string") {
					await this.push(chunk);
				} else {
					if (!decoder) {
						const dec = new TextDecoder("utf-8", { ignoreBOM: true });
						decoder = dec;
						finalize = async () => {
							await this.push(dec.decode());
						};
					}
					await this.push(decoder.decode(chunk, { stream: true }));
				}
			},
			close: finalize,
			abort: finalize,
		});
	}

	async dump(notice?: string): Promise<OutputResult> {
		const noticeLine = notice ? `[${notice}]\n` : "";

		if (this.#file) {
			await this.#file.sink.end();
			return { output: `${noticeLine}...${this.#buffer}`, truncated: true, fullOutputPath: this.#file.path };
		} else {
			return { output: `${noticeLine}${this.#buffer}`, truncated: false };
		}
	}
}
