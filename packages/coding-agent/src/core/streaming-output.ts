import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { nanoid } from "nanoid";
import { DEFAULT_MAX_BYTES } from "./tools/truncate";

export interface OutputResult {
	output: string;
	truncated: boolean;
	/** Filesystem path to full output (for RPC backwards compatibility) */
	fullOutputPath?: string;
	/** Artifact ID for internal URL access (artifact://<id>) */
	artifactId?: string;
}

/**
 * Function to save content as an artifact.
 * Returns the artifact ID.
 */
export type ArtifactSaver = (content: string) => Promise<string>;

export interface OutputSinkOptions {
	allocateFilePath?: () => string;
	spillThreshold?: number;
	maxColumn?: number;
	onChunk?: (chunk: string) => void;
	/** Function to save full output as artifact when truncated */
	saveArtifact?: ArtifactSaver;
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

	readonly #allocateFilePath: () => string;
	readonly #spillThreshold: number;
	readonly #onChunk?: (chunk: string) => void;
	readonly #saveArtifact?: ArtifactSaver;

	constructor(options?: OutputSinkOptions) {
		const {
			allocateFilePath = defaultFilePathAllocator,
			spillThreshold = DEFAULT_MAX_BYTES,
			onChunk,
			saveArtifact,
		} = options ?? {};

		this.#allocateFilePath = allocateFilePath;
		this.#spillThreshold = spillThreshold;
		this.#onChunk = onChunk;
		this.#saveArtifact = saveArtifact;
	}

	async #pushSanitized(data: string): Promise<void> {
		this.#onChunk?.(data);

		const bufferOverflow = data.length + this.#buffer.length > this.#spillThreshold;
		const overflow = this.#file || bufferOverflow;

		const sink = overflow ? await this.#fileSink() : null;

		this.#buffer += data;
		await sink?.write(data);

		if (bufferOverflow) {
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
		const dec = new TextDecoder("utf-8", { ignoreBOM: true });
		const finalize = async () => {
			await this.push(dec.decode());
		};

		return new WritableStream<Uint8Array | string>({
			write: async (chunk) => {
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

	async dump(notice?: string): Promise<OutputResult> {
		const noticeLine = notice ? `[${notice}]\n` : "";

		if (this.#file) {
			await this.#file.sink.end();

			// Save to artifact if saver is provided
			let artifactId: string | undefined;
			if (this.#saveArtifact) {
				try {
					const fullContent = await Bun.file(this.#file.path).text();
					artifactId = await this.#saveArtifact(fullContent);
				} catch {
					// Artifact save failed, continue without it
				}
			}

			return {
				output: `${noticeLine}...${this.#buffer}`,
				truncated: true,
				fullOutputPath: this.#file.path,
				artifactId,
			};
		} else {
			return { output: `${noticeLine}${this.#buffer}`, truncated: false };
		}
	}
}
