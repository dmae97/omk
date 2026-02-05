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

const LF = 0x0a;

export async function* readLines(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
	const buffer = new ConcatSink();
	const source = signal ? stream.pipeThrough(new TransformStream(), { signal }) : stream;
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
	const source = signal ? stream.pipeThrough(new TransformStream(), { signal }) : stream;
	try {
		const yieldBuffer: T[] = [];
		for await (const chunk of source) {
			buffer.appendAndConsume(chunk, 0, chunk.length, (payload, beg, end) => {
				const { values, error, read, done } = Bun.JSONL.parseChunk(payload, beg, end);
				if (values.length > 0) {
					yieldBuffer.push(...(values as T[]));
				}
				if (error) throw error;
				if (done) return 0;
				return end - read;
			});
			if (yieldBuffer.length > 0) {
				yield* yieldBuffer;
				yieldBuffer.length = 0;
			}
		}
		if (!buffer.isEmpty) {
			const tail = buffer.flush();
			if (tail) {
				buffer.clear();
				const { values, error, done } = Bun.JSONL.parseChunk(tail, 0, tail.length);
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

class Bitmap {
	private bits: Uint32Array;
	constructor(n: number) {
		this.bits = new Uint32Array((n + 31) >>> 5);
	}

	set(i: number, value: boolean) {
		const index = i >>> 5;
		const mask = 1 << (i & 31);
		if (value) {
			this.bits[index] |= mask;
		} else {
			this.bits[index] &= ~mask;
		}
	}
	get(i: number) {
		const index = i >>> 5;
		const mask = 1 << (i & 31);
		const word = this.bits[index];
		return word !== undefined && (word & mask) !== 0;
	}
}

const WHITESPACE = new Bitmap(256);
for (let i = 0; i <= 0x7f; i++) {
	const c = String.fromCharCode(i);
	switch (c) {
		case " ":
		case "\t":
		case "\n":
		case "\r":
			WHITESPACE.set(i, true);
			break;
		default:
			WHITESPACE.set(i, !c.trim());
			break;
	}
}

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

	appendAndConsume(
		chunk: Uint8Array,
		beg: number,
		end: number,
		// (slice) => [remaining length]
		consumer: (payload: Uint8Array, beg: number, end: number) => number,
	) {
		if (this.isEmpty) {
			const rem = consumer(chunk, beg, end);
			if (!rem) return;
			this.reset(chunk.subarray(end - rem, end));
			return;
		}

		const offset = this.#length;
		const n = end - beg;
		const total = offset + n;
		const space = this.#ensureCapacity(total);
		space.set(chunk.subarray(beg, end), offset);
		this.#length = total;
		const rem = consumer(space.subarray(0, total), 0, total);
		if (!rem) {
			this.#length = 0;
			return;
		}
		if (rem < total) {
			space.copyWithin(0, total - rem, total);
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
	stream = signal ? stream.pipeThrough(new TransformStream(), { signal }) : stream;
	try {
		const yieldBuffer: T[] = [];
		const processLine = (line: Uint8Array) => {
			// Strip trailing spaces including \r.
			let end = line.length;
			while (end && WHITESPACE.get(line[end - 1])) {
				--end;
			}
			if (!end) return; // blank line

			const trimmed = end === line.length ? line : line.subarray(0, end);

			// Check "data:" prefix and optional space afterwards.
			let beg = PAT_DATA.strip(trimmed);
			if (beg === null) return;
			while (beg < end && WHITESPACE.get(trimmed[beg])) {
				++beg;
			}
			if (beg >= end) return;

			jsonBuffer.appendAndConsume(trimmed, beg, end, (payload, beg, end) => {
				const { values, error, read, done } = Bun.JSONL.parseChunk(payload, beg, end);
				if (values.length > 0) {
					yieldBuffer.push(...(values as T[]));
				}
				if (error) {
					if (PAT_DONE.strip(payload.subarray(beg, end))) {
						throw kDoneError;
					}
					throw error;
				}
				if (done) return 0;
				return end - read;
			});
		};
		for await (const chunk of stream) {
			for (const line of lineBuffer.appendAndFlushLines(chunk)) {
				processLine(line);
				if (yieldBuffer.length > 0) {
					yield* yieldBuffer;
					yieldBuffer.length = 0;
				}
			}
		}
		if (!lineBuffer.isEmpty) {
			const tail = lineBuffer.flush();
			if (tail) {
				lineBuffer.clear();
				processLine(tail);
				if (yieldBuffer.length > 0) {
					yield* yieldBuffer;
					yieldBuffer.length = 0;
				}
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
		const { values, error, read, done } = Bun.JSONL.parseChunk(buffer);
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
