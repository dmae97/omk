import { createAbortableStream } from "./abortable";

const LF = 0x0a;
const CR = 0x0d;
const decoder = new TextDecoder();

type JsonlChunkResult = {
	values: unknown[];
	error: unknown;
	read: number;
	done: boolean;
};

function hasBunJsonlParseChunk(): boolean {
	return typeof Bun !== "undefined" && typeof Bun.JSONL !== "undefined" && typeof Bun.JSONL.parseChunk === "function";
}

function parseJsonLine(lineBytes: Uint8Array): unknown {
	let end = lineBytes.length;
	if (end > 0 && lineBytes[end - 1] === CR) {
		end--;
	}
	const text = decoder.decode(lineBytes.subarray(0, end)).trim();
	if (text.length === 0) return undefined;
	return JSON.parse(text);
}

function parseJsonlChunkFallbackBytes(bytes: Uint8Array, beg = 0, end = bytes.length): JsonlChunkResult {
	const values: unknown[] = [];
	let lineStart = beg;

	for (let i = beg; i < end; i++) {
		if (bytes[i] !== LF) continue;
		const line = bytes.subarray(lineStart, i);
		try {
			const parsed = parseJsonLine(line);
			if (parsed !== undefined) values.push(parsed);
		} catch (error) {
			return { values, error, read: lineStart, done: false };
		}
		lineStart = i + 1;
	}

	if (lineStart >= end) {
		return { values, error: null, read: end, done: true };
	}

	const tail = bytes.subarray(lineStart, end);
	const tailText = decoder.decode(tail).trim();
	if (tailText.length === 0) {
		return { values, error: null, read: end, done: true };
	}
	try {
		values.push(JSON.parse(tailText));
		return { values, error: null, read: end, done: true };
	} catch {
		// In streaming mode this is usually a partial line/object.
		return { values, error: null, read: lineStart, done: false };
	}
}

function parseJsonlChunkFallbackString(buffer: string): JsonlChunkResult {
	const values: unknown[] = [];
	let lineStart = 0;

	for (let i = 0; i < buffer.length; i++) {
		if (buffer.charCodeAt(i) !== LF) continue;
		const rawLine = buffer.slice(lineStart, i);
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			try {
				values.push(JSON.parse(trimmed));
			} catch (error) {
				return { values, error, read: lineStart, done: false };
			}
		}
		lineStart = i + 1;
	}

	if (lineStart >= buffer.length) {
		return { values, error: null, read: buffer.length, done: true };
	}

	const tail = buffer.slice(lineStart).trim();
	if (tail.length === 0) {
		return { values, error: null, read: buffer.length, done: true };
	}
	try {
		values.push(JSON.parse(tail));
		return { values, error: null, read: buffer.length, done: true };
	} catch {
		return { values, error: null, read: lineStart, done: false };
	}
}

function parseJsonlChunkCompat(input: Uint8Array, beg?: number, end?: number): JsonlChunkResult;
function parseJsonlChunkCompat(input: string): JsonlChunkResult;
function parseJsonlChunkCompat(input: Uint8Array | string, beg?: number, end?: number): JsonlChunkResult {
	if (hasBunJsonlParseChunk()) {
		if (typeof input === "string") {
			const { values, error, read, done } = Bun.JSONL.parseChunk(input);
			return { values, error, read, done };
		}
		const start = beg ?? 0;
		const stop = end ?? input.length;
		const { values, error, read, done } = Bun.JSONL.parseChunk(input, start, stop);
		return { values, error, read, done };
	}

	if (typeof input === "string") {
		return parseJsonlChunkFallbackString(input);
	}
	return parseJsonlChunkFallbackBytes(input, beg, end);
}

export async function* readLines(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
	const buffer = new ConcatSink();
	const source = createAbortableStream(stream, signal);
	try {
		for await (const chunk of source) {
			for (const line of buffer.appendAndFlushLines(chunk)) {
				yield line;
			}
		}
		if (!buffer.isEmpty) {
			const tail = buffer.flush();
			if (tail) {
				buffer.clear();
				yield tail;
			}
		}
	} catch (err) {
		// Abort errors are expected — just stop the generator.
		if (signal?.aborted) return;
		throw err;
	}
}

export async function* readJsonl<T>(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<T> {
	const buffer = new ConcatSink();
	const source = createAbortableStream(stream, signal);
	try {
		for await (const chunk of source) {
			yield* buffer.pullJSONL<T>(chunk, 0, chunk.length);
		}
		if (!buffer.isEmpty) {
			const tail = buffer.flush();
			if (tail) {
				buffer.clear();
				const { values, error, done } = parseJsonlChunkCompat(tail, 0, tail.length);
				if (values.length > 0) {
					yield* values as T[];
				}
				if (error) throw error;
				if (!done) {
					throw new Error("JSONL stream ended unexpectedly");
				}
			}
		}
	} catch (err) {
		// Abort errors are expected — just stop the generator.
		if (signal?.aborted) return;
		throw err;
	}
}

// =============================================================================
// SSE (Server-Sent Events)
// =============================================================================

/** Byte lookup table: 1 = whitespace, 0 = not. */
const WS = new Uint8Array(256);
WS[0x09] = 1; // tab
WS[0x0a] = 1; // LF
WS[0x0d] = 1; // CR
WS[0x20] = 1; // space

const createPattern = (prefix: string) => {
	const pre = Buffer.from(prefix, "utf-8");
	return {
		strip(buf: Uint8Array): number | null {
			const n = pre.length;
			if (buf.length < n) return null;
			if (pre.equals(buf.subarray(0, n))) {
				return n;
			}
			return null;
		},
	};
};

const PAT_DATA = createPattern("data:");

const PAT_DONE = createPattern("[DONE]");

class ConcatSink {
	#space?: Buffer;
	#length = 0;

	#ensureCapacity(size: number): Buffer {
		const space = this.#space;
		if (space && space.length >= size) return space;
		const nextSize = space ? Math.max(size, space.length * 2) : size;
		const next = Buffer.allocUnsafe(nextSize);
		if (space && this.#length > 0) {
			space.copy(next, 0, 0, this.#length);
		}
		this.#space = next;
		return next;
	}

	append(chunk: Uint8Array) {
		const n = chunk.length;
		if (!n) return;
		const offset = this.#length;
		const space = this.#ensureCapacity(offset + n);
		space.set(chunk, offset);
		this.#length += n;
	}

	reset(chunk: Uint8Array) {
		const n = chunk.length;
		if (!n) {
			this.#length = 0;
			return;
		}
		const space = this.#ensureCapacity(n);
		space.set(chunk, 0);
		this.#length = n;
	}

	get isEmpty(): boolean {
		return this.#length === 0;
	}

	flush(): Uint8Array | undefined {
		if (!this.#length) return undefined;
		return this.#space!.subarray(0, this.#length);
	}

	clear() {
		this.#length = 0;
	}

	*appendAndFlushLines(chunk: Uint8Array) {
		let pos = 0;
		while (pos < chunk.length) {
			const nl = chunk.indexOf(LF, pos);
			if (nl === -1) {
				this.append(chunk.subarray(pos));
				return;
			}
			const suffix = chunk.subarray(pos, nl);
			pos = nl + 1;
			if (this.isEmpty) {
				yield suffix;
			} else {
				this.append(suffix);
				const payload = this.flush();
				if (payload) {
					yield payload;
					this.clear();
				}
			}
		}
	}
	*pullJSONL<T>(chunk: Uint8Array, beg: number, end: number) {
		if (this.isEmpty) {
			const { values, error, read, done } = parseJsonlChunkCompat(chunk, beg, end);
			if (values.length > 0) {
				yield* values as T[];
			}
			if (error) throw error;
			if (done) return;
			this.reset(chunk.subarray(read, end));
			return;
		}

		const offset = this.#length;
		const n = end - beg;
		const total = offset + n;
		const space = this.#ensureCapacity(total);
		space.set(chunk.subarray(beg, end), offset);
		this.#length = total;

		const { values, error, read, done } = parseJsonlChunkCompat(space.subarray(0, total), 0, total);
		if (values.length > 0) {
			yield* values as T[];
		}
		if (error) throw error;
		if (done) {
			this.#length = 0;
			return;
		}
		const rem = total - read;
		if (rem < total) {
			space.copyWithin(0, read, total);
		}
		this.#length = rem;
	}
}

const kDoneError = new Error("SSE stream done");

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
export async function* readSseJson<T>(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<T> {
	const lineBuffer = new ConcatSink();
	const jsonBuffer = new ConcatSink();

	// pipeThrough with { signal } makes the stream abort-aware: the pipe
	// cancels the source and errors the output when the signal fires,
	// so for-await-of exits cleanly without manual reader/listener management.
	stream = createAbortableStream(stream, signal);
	try {
		const processLine = function* (line: Uint8Array) {
			// Strip trailing spaces including \r.
			let end = line.length;
			while (end && WS[line[end - 1]]) {
				--end;
			}
			if (!end) return; // blank line

			const trimmed = end === line.length ? line : line.subarray(0, end);

			// Check "data:" prefix and optional space afterwards.
			let beg = PAT_DATA.strip(trimmed);
			if (beg === null) return;
			while (beg < end && WS[trimmed[beg]]) {
				++beg;
			}
			if (beg >= end) return;

			// Fast-path: the OpenAI-style done marker isn't JSON.
			const donePrefix = PAT_DONE.strip(trimmed.subarray(beg, end));
			if (donePrefix !== null && donePrefix === end - beg) {
				throw kDoneError;
			}

			yield* jsonBuffer.pullJSONL<T>(trimmed, beg, end);
		};
		for await (const chunk of stream) {
			for (const line of lineBuffer.appendAndFlushLines(chunk)) {
				yield* processLine(line);
			}
		}
		if (!lineBuffer.isEmpty) {
			const tail = lineBuffer.flush();
			if (tail) {
				lineBuffer.clear();
				yield* processLine(tail);
			}
		}
	} catch (err) {
		if (err === kDoneError) return;
		// Abort errors are expected — just stop the generator.
		if (signal?.aborted) return;
		throw err;
	}
	if (!jsonBuffer.isEmpty) {
		throw new Error("SSE stream ended unexpectedly");
	}
}

/**
 * Parse a complete JSONL string, skipping malformed lines instead of throwing.
 *
 * Uses `Bun.JSONL.parseChunk` internally. On parse errors, the malformed
 * region is skipped up to the next newline and parsing continues.
 *
 * @example
 * ```ts
 * const entries = parseJsonlLenient<MyType>(fileContents);
 * ```
 */
export function parseJsonlLenient<T>(buffer: string): T[] {
	let entries: T[] | undefined;

	while (buffer.length > 0) {
		const { values, error, read, done } = parseJsonlChunkCompat(buffer);
		if (values.length > 0) {
			const ext = values as T[];
			if (!entries) {
				entries = ext;
			} else {
				entries.push(...ext);
			}
		}
		if (error) {
			const nextNewline = buffer.indexOf("\n", read);
			if (nextNewline === -1) break;
			buffer = buffer.substring(nextNewline + 1);
			continue;
		}
		if (read === 0) break;
		buffer = buffer.substring(read);
		if (done) break;
	}
	return entries ?? [];
}
