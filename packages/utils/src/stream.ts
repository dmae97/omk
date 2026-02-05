import { ArrayBufferSink } from "bun";

/**
 * Sanitize binary output for display/storage.
 * Removes characters that crash string-width or cause display issues:
 * - Control characters (except tab, newline, carriage return)
 * - Lone surrogates
 * - Characters with undefined code points
 */
export function sanitizeBinaryOutput(str: string): string {
	// Use Array.from to properly iterate over code points (not code units)
	// This handles surrogate pairs correctly and catches edge cases where
	// codePointAt() might return undefined
	return Array.from(str)
		.filter(char => {
			// Filter out characters that cause string-width to crash
			// This includes:
			// - Lone surrogates (already filtered by Array.from)
			// - Control chars except \t \n \r
			// - Characters with undefined code points

			const code = char.codePointAt(0);

			// Skip if code point is undefined (edge case with invalid strings)
			if (code === undefined) return false;

			// Allow tab, newline, carriage return
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;

			// Filter out control characters (0x00-0x1F, except 0x09, 0x0a, 0x0x0d)
			if (code <= 0x1f) return false;

			return true;
		})
		.join("");
}

/**
 * Sanitize text output: strip ANSI codes, remove binary garbage, normalize line endings.
 */
export function sanitizeText(text: string): string {
	return sanitizeBinaryOutput(Bun.stripANSI(text)).replace(/\r/g, "");
}

/**
 * Create a transform stream that splits lines.
 */
export function createSplitterStream<T>(options: {
	newLine?: boolean;
	mapFn: (chunk: Uint8Array) => T;
}): TransformStream<Uint8Array, T> {
	const { newLine = false, mapFn } = options;
	const LF = 0x0a;
	const sink = new Bun.ArrayBufferSink();
	sink.start({ asUint8Array: true, stream: true, highWaterMark: 4096 });
	let pending = false; // whether the sink has unflushed data

	return new TransformStream<Uint8Array, T>({
		transform(chunk, ctrl) {
			let pos = 0;

			while (pos < chunk.length) {
				const nl = chunk.indexOf(LF, pos);
				if (nl === -1) {
					sink.write(chunk.subarray(pos));
					pending = true;
					break;
				}

				const slice = chunk.subarray(pos, newLine ? nl + 1 : nl);

				if (pending) {
					if (slice.length > 0) sink.write(slice);
					ctrl.enqueue(mapFn(sink.flush() as Uint8Array));
					pending = false;
				} else {
					ctrl.enqueue(mapFn(slice));
				}
				pos = nl + 1;
			}
		},
		flush(ctrl) {
			if (pending) {
				const tail = sink.end() as Uint8Array;
				if (tail.length > 0) ctrl.enqueue(mapFn(tail));
			}
		},
	});
}

export function createTextLineSplitter(sanitize = false): TransformStream<Uint8Array, string> {
	const dec = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
	if (sanitize) {
		return createSplitterStream({ mapFn: chunk => sanitizeText(dec.decode(chunk)) });
	}
	return createSplitterStream({ mapFn: dec.decode.bind(dec) });
}

/**
 * Create a transform stream that sanitizes text.
 */
export function createSanitizerStream(): TransformStream<string, string> {
	return new TransformStream<string, string>({
		transform(chunk, controller) {
			controller.enqueue(sanitizeText(chunk));
		},
	});
}

/**
 * Create a transform stream that decodes text.
 */
export function createTextDecoderStream(): TransformStream<Uint8Array, string> {
	return new TextDecoderStream() as TransformStream<Uint8Array, string>;
}

// =============================================================================
// SSE (Server-Sent Events)
// =============================================================================

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;

// "data:" = [0x64, 0x61, 0x74, 0x61, 0x3a]
const DATA_0 = 0x64; // d
const DATA_1 = 0x61; // a
const DATA_2 = 0x74; // t
const DATA_3 = 0x61; // a
const DATA_4 = 0x3a; // :

// "[DONE]" = [0x5b, 0x44, 0x4f, 0x4e, 0x45, 0x5d]
const DONE = Uint8Array.from([0x5b, 0x44, 0x4f, 0x4e, 0x45, 0x5d]);

function isDone(buf: Uint8Array, start: number, end: number): boolean {
	if (end - start !== 6) return false;
	for (let i = 0; i < 6; i++) {
		if (buf[start + i] !== DONE[i]) return false;
	}
	return true;
}

/**
 * Stream parsed JSON objects from SSE `data:` lines.
 *
 * @example
 * ```ts
 * for await (const obj of readSseJson(response.body!)) {
 *   console.log(obj);
 * }
 * ```
 */
export async function* readSseJson<T>(
	stream: ReadableStream<Uint8Array>,
	abortSignal?: AbortSignal,
): AsyncGenerator<T> {
	const sink = new ArrayBufferSink();
	sink.start({ asUint8Array: true, stream: true, highWaterMark: 4096 });
	let pending = false;

	const cleanup = () => {
		stream.cancel(abortSignal?.reason ?? new Error("Request aborted"));
	};
	abortSignal?.addEventListener("abort", cleanup, { once: true });

	try {
		for await (const chunk of stream) {
			let pos = 0;
			while (pos < chunk.length) {
				const nl = chunk.indexOf(LF, pos);
				if (nl === -1) {
					sink.write(chunk.subarray(pos));
					pending = true;
					break;
				}

				let line: Uint8Array;
				if (pending) {
					if (nl > pos) sink.write(chunk.subarray(pos, nl));
					line = sink.flush() as Uint8Array;
					pending = false;
				} else {
					line = chunk.subarray(pos, nl);
				}
				pos = nl + 1;

				// Strip trailing CR, skip blank/short lines.
				const len = line.length > 0 && line[line.length - 1] === CR ? line.length - 1 : line.length;
				if (len < 6) continue; // "data:" + at least 1 byte

				// Check "data:" prefix.
				if (
					line[0] !== DATA_0 ||
					line[1] !== DATA_1 ||
					line[2] !== DATA_2 ||
					line[3] !== DATA_3 ||
					line[4] !== DATA_4
				)
					continue;

				// Payload start — skip optional space after colon.
				const pStart = line[5] === SPACE ? 6 : 5;
				if (pStart >= len) continue;
				if (isDone(line, pStart, len)) return;

				// Build payload + \n for JSONL.parse.
				const pLen = len - pStart;
				const buf = new Uint8Array(pLen + 1);
				buf.set(line.subarray(pStart, len));
				buf[pLen] = LF;

				const [parsed] = Bun.JSONL.parse(buf);
				if (parsed !== undefined) yield parsed as T;
			}
		}
	} finally {
		abortSignal?.removeEventListener("abort", cleanup);
	}

	// Trailing line without final newline.
	if (pending) {
		const tail = sink.end() as Uint8Array;
		const len = tail.length > 0 && tail[tail.length - 1] === CR ? tail.length - 1 : tail.length;
		if (
			len >= 6 &&
			tail[0] === DATA_0 &&
			tail[1] === DATA_1 &&
			tail[2] === DATA_2 &&
			tail[3] === DATA_3 &&
			tail[4] === DATA_4
		) {
			const pStart = tail[5] === SPACE ? 6 : 5;
			if (pStart < len && !isDone(tail, pStart, len)) {
				const pLen = len - pStart;
				const buf = new Uint8Array(pLen + 1);
				buf.set(tail.subarray(pStart, len));
				buf[pLen] = LF;
				const [parsed] = Bun.JSONL.parse(buf);
				if (parsed !== undefined) yield parsed as T;
			}
		}
	}
}
