import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import stripAnsi from "strip-ansi";
import { sanitizeBinaryOutput } from "../utils/shell";
import { truncateTail } from "./tools/truncate";

interface OutputFileSink {
	write(data: string): number | Promise<number>;
	end(): void;
}

export function createSanitizer(): TransformStream<Uint8Array, string> {
	const decoder = new TextDecoder();
	const sanitizeText = (text: string) => sanitizeBinaryOutput(stripAnsi(text)).replace(/\r/g, "");
	return new TransformStream({
		transform(chunk, controller) {
			const text = sanitizeText(decoder.decode(chunk, { stream: true }));
			if (text) {
				controller.enqueue(text);
			}
		},
		flush(controller) {
			const text = sanitizeText(decoder.decode());
			if (text) {
				controller.enqueue(text);
			}
		},
	});
}

export async function pumpStream(readable: ReadableStream<Uint8Array>, writer: WritableStreamDefaultWriter<string>) {
	const reader = readable.pipeThrough(createSanitizer()).getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			await writer.write(value);
		}
	} finally {
		reader.releaseLock();
	}
}

export function createOutputSink(
	spillThreshold: number,
	maxBuffer: number,
	onChunk?: (text: string) => void,
): WritableStream<string> & {
	dump: (annotation?: string) => { output: string; truncated: boolean; fullOutputPath?: string };
} {
	const chunks: Array<{ text: string; bytes: number }> = [];
	let chunkBytes = 0;
	let totalBytes = 0;
	let fullOutputPath: string | undefined;
	let fullOutputStream: OutputFileSink | undefined;

	const sink = new WritableStream<string>({
		write(text) {
			const bytes = Buffer.byteLength(text, "utf-8");
			totalBytes += bytes;

			if (totalBytes > spillThreshold && !fullOutputPath) {
				fullOutputPath = join(tmpdir(), `omp-${nanoid()}.buffer`);
				const stream = Bun.file(fullOutputPath).writer();
				for (const chunk of chunks) {
					stream.write(chunk.text);
				}
				fullOutputStream = stream;
			}
			fullOutputStream?.write(text);

			chunks.push({ text, bytes });
			chunkBytes += bytes;
			while (chunkBytes > maxBuffer && chunks.length > 1) {
				const removed = chunks.shift();
				if (removed) {
					chunkBytes -= removed.bytes;
				}
			}

			onChunk?.(text);
		},
		close() {
			fullOutputStream?.end();
		},
	});

	return Object.assign(sink, {
		dump(annotation?: string) {
			if (annotation) {
				const text = `\n\n${annotation}`;
				chunks.push({ text, bytes: Buffer.byteLength(text, "utf-8") });
			}
			const full = chunks.map((chunk) => chunk.text).join("");
			const { content, truncated } = truncateTail(full);
			return { output: truncated ? content : full, truncated, fullOutputPath };
		},
	});
}
