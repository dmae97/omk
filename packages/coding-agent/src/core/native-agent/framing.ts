import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";

export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export class NativeFramingError extends Error {
	constructor(code: "CLOSED" | "STREAM_LIMIT" | "PAYLOAD_LIMIT" | "FRAME" | "UTF8" | "EOF") {
		super(code);
		this.name = "NativeFramingError";
	}
}

export class FrameDecoder {
	private readonly payload = new Uint8Array(MAX_PAYLOAD_BYTES);
	private used = 0;
	private total = 0;
	private frames = 0;
	private closed = false;

	push(chunk: Uint8Array, accept: (frame: string) => void): void {
		if (this.closed) throw new NativeFramingError("CLOSED");
		try {
			if (chunk.byteLength > MAX_STREAM_BYTES - this.total) throw new NativeFramingError("STREAM_LIMIT");
			this.total += chunk.byteLength;
			for (const byte of chunk) {
				if (byte === 13) throw new NativeFramingError("FRAME");
				if (byte === 10) {
					if (this.used === 0 || (this.payload[0] === 239 && this.payload[1] === 187 && this.payload[2] === 191))
						throw new NativeFramingError("FRAME");
					let frame: string;
					try {
						frame = decoder.decode(this.payload.subarray(0, this.used));
					} catch {
						throw new NativeFramingError("UTF8");
					}
					this.used = 0;
					this.frames++;
					accept(frame);
				} else {
					if (this.used === MAX_PAYLOAD_BYTES) throw new NativeFramingError("PAYLOAD_LIMIT");
					this.payload[this.used++] = byte;
				}
			}
		} catch (error) {
			this.closed = true;
			throw error;
		}
	}

	finish(): void {
		if (this.closed) throw new NativeFramingError("CLOSED");
		this.closed = true;
		if (this.used !== 0 || this.frames === 0) throw new NativeFramingError("EOF");
	}
}

export class FrameEncoder {
	private total = 0;

	encode(frame: string): Uint8Array {
		if (!frame || frame.charCodeAt(0) === 0xfeff || /[\r\n\uD800-\uDFFF]/u.test(frame))
			throw new NativeFramingError("FRAME");
		if (frame.length > MAX_PAYLOAD_BYTES) throw new NativeFramingError("PAYLOAD_LIMIT");
		const size = Buffer.byteLength(frame, "utf8");
		if (size > MAX_PAYLOAD_BYTES) throw new NativeFramingError("PAYLOAD_LIMIT");
		if (size + 1 > MAX_STREAM_BYTES - this.total) throw new NativeFramingError("STREAM_LIMIT");
		const output = new Uint8Array(size + 1);
		encoder.encodeInto(frame, output);
		output[size] = 10;
		this.total += output.length;
		return output;
	}
}
