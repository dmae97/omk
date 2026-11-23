import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Serialize a single strict JSONL record.
 *
 * Framing is LF-only. Payload strings may contain other Unicode separators such as
 * U+2028 and U+2029. Clients must split records on `\n` only.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Attach an LF-only JSONL reader to a stream.
 *
 * This intentionally does not use Node readline. Readline splits on additional
 * Unicode separators that are valid inside JSON strings and therefore does not
 * implement strict JSONL framing.
 */
export function attachJsonlLineReader(stream: Readable, onLine: (line: string) => void): () => void {
	const decoder = new StringDecoder("utf8");
	let fragments: string[] = [];
	let attached = true;

	const emitLine = (tail: string) => {
		let line = tail;
		if (fragments.length > 0) {
			fragments.push(tail);
			line = fragments.join("");
			fragments = [];
		}
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

	const onData = (chunk: string | Buffer) => {
		const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
		let start = 0;
		while (attached) {
			const newline = text.indexOf("\n", start);
			if (newline === -1) {
				// Avoid flattening the unfinished line on every read.
				if (start < text.length) fragments.push(text.slice(start));
				return;
			}
			emitLine(text.slice(start, newline));
			start = newline + 1;
		}
	};

	const onEnd = () => {
		const tail = decoder.end();
		if (attached && (fragments.length > 0 || tail)) emitLine(tail);
	};

	stream.on("data", onData);
	stream.on("end", onEnd);

	return () => {
		attached = false;
		fragments = [];
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}
