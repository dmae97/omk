import { TextDecoderStream } from "node:stream/web";

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
export function createSplitterStream(delimiter: string): TransformStream<string, string> {
	let buf = "";
	return new TransformStream<string, string>({
		transform(chunk, controller) {
			buf = buf ? `${buf}${chunk}` : chunk;

			while (true) {
				const nl = buf.indexOf(delimiter);
				if (nl === -1) break;
				controller.enqueue(buf.slice(0, nl));
				buf = buf.slice(nl + delimiter.length);
			}
		},
		flush(controller) {
			if (buf) {
				controller.enqueue(buf);
			}
		},
	});
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
	return new TextDecoderStream("utf-8", { ignoreBOM: true }) as TransformStream<Uint8Array, string>;
}

/**
 * Read stream line-by-line
 *
 * @param delimiter Line delimiter (default: "\n")
 */
export function readLines(stream: ReadableStream<Uint8Array>, delimiter = "\n"): AsyncIterable<string> {
	return stream.pipeThrough(createTextDecoderStream()).pipeThrough(createSplitterStream(delimiter));
}

// =============================================================================
// SSE (Server-Sent Events)
// =============================================================================

/**
 * Parsed SSE event.
 */
export interface SseEvent {
	/** Event type (from `event:` field, default: "message") */
	event: string;
	/** Event data (from `data:` field(s), joined with newlines) */
	data: string;
	/** Event ID (from `id:` field) */
	id?: string;
	/** Retry interval in ms (from `retry:` field) */
	retry?: number;
}

/**
 * Parse a single SSE event block (lines between blank lines).
 * Returns null if the block contains no data.
 */
export function parseSseEvent(block: string): SseEvent | null {
	const lines = block.split("\n");
	let event = "message";
	const dataLines: string[] = [];
	let id: string | undefined;
	let retry: number | undefined;

	for (const line of lines) {
		// Comments start with ':'
		if (line.startsWith(":")) continue;

		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const field = line.slice(0, colonIdx);
		// Value starts after colon, with optional leading space trimmed
		let value = line.slice(colonIdx + 1);
		if (value.startsWith(" ")) value = value.slice(1);

		switch (field) {
			case "event":
				event = value;
				break;
			case "data":
				dataLines.push(value);
				break;
			case "id":
				id = value;
				break;
			case "retry": {
				const n = parseInt(value, 10);
				if (!Number.isNaN(n)) retry = n;
				break;
			}
		}
	}

	if (dataLines.length === 0) return null;

	return {
		event,
		data: dataLines.join("\n"),
		id,
		retry,
	};
}

/**
 * Read SSE events from a stream.
 *
 * Handles the SSE wire format:
 * - Events separated by blank lines
 * - Fields: event, data, id, retry
 * - Comments (lines starting with :) are ignored
 * - Multiple data: lines are joined with newlines
 *
 * @example
 * ```ts
 * for await (const event of readSseEvents(response.body)) {
 *   if (event.data === "[DONE]") break;
 *   const payload = JSON.parse(event.data);
 *   console.log(event.event, payload);
 * }
 * ```
 */
export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, undefined> {
	const blockLines: string[] = [];

	for await (const rawLine of readLines(stream)) {
		const line = rawLine.replace(/\r$/, "");
		if (line === "") {
			if (blockLines.length > 0) {
				const event = parseSseEvent(blockLines.join("\n"));
				if (event) yield event;
				blockLines.length = 0;
			}
			continue;
		}

		blockLines.push(line);
	}

	if (blockLines.length > 0) {
		const event = parseSseEvent(blockLines.join("\n"));
		if (event) yield event;
	}
}

/**
 * Read SSE data payloads from a stream, parsing JSON automatically.
 *
 * Convenience wrapper over readSseEvents that:
 * - Skips [DONE] markers
 * - Parses JSON data
 * - Optionally filters by event type
 *
 * @example
 * ```ts
 * for await (const data of readSseData<ChatChunk>(response.body)) {
 *   console.log(data.choices[0].delta);
 * }
 * ```
 */
export async function* readSseData<T = unknown>(
	stream: ReadableStream<Uint8Array>,
	eventType?: string,
): AsyncGenerator<T, void, undefined> {
	for await (const event of readSseEvents(stream)) {
		if (eventType && event.event !== eventType) continue;
		if (event.data === "[DONE]") continue;

		try {
			yield JSON.parse(event.data) as T;
		} catch {
			// Skip malformed JSON
		}
	}
}
