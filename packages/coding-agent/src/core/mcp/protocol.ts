/**
 * Pure JSON-RPC 2.0 framing for the MCP stdio transport.
 *
 * MCP stdio frames one JSON message per line on stdout; embedded newlines are
 * illegal, so decoding is a line split with a hard length ceiling. Nothing here
 * touches a process, a socket, or a clock — the transport owns all I/O so this
 * layer stays trivially testable.
 */

/** Ceiling for a single decoded line. A server that exceeds it is malfunctioning, not slow. */
export const MAX_MESSAGE_LINE_BYTES = 16 * 1024 * 1024;

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly method: string;
	readonly params?: unknown;
}

export interface JsonRpcNotification {
	readonly jsonrpc: "2.0";
	readonly method: string;
	readonly params?: unknown;
}

export interface JsonRpcErrorBody {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

export interface JsonRpcResponse {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly result?: unknown;
	readonly error?: JsonRpcErrorBody;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
	if (!isRecord(message) || message.jsonrpc !== "2.0") return false;
	if (!("id" in message)) return false;
	const id = message.id;
	if (typeof id !== "number" && typeof id !== "string") return false;
	// JSON-RPC success and error are mutually exclusive; `error: null` is not a
	// valid error object, and a present error must carry its required fields.
	const hasResult = "result" in message;
	const hasError = "error" in message;
	if (hasResult === hasError) return false; // both present or both absent
	if (hasError) {
		const error = message.error;
		if (!isRecord(error)) return false;
		if (typeof error.code !== "number" || !Number.isFinite(error.code)) return false;
		if (typeof error.message !== "string") return false;
	}
	return true;
}

export function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
	return isRecord(message) && message.jsonrpc === "2.0" && typeof message.method === "string" && !("id" in message);
}

export function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
	if (!isRecord(message) || message.jsonrpc !== "2.0") return false;
	if (typeof message.method !== "string") return false;
	const id = message.id;
	return typeof id === "number" || typeof id === "string";
}

/** Serialize one message as a single stdio frame (JSON + newline). */
export function encodeMessage(message: JsonRpcMessage): string {
	const line = JSON.stringify(message);
	if (line.includes("\n")) {
		// JSON.stringify escapes newlines, so this is unreachable for valid input;
		// keep the guard so a future custom serializer cannot corrupt framing.
		throw new Error("MCP frame contains a literal newline");
	}
	return `${line}\n`;
}

export interface DecodedLine {
	/** Parsed message, when the line was valid JSON. */
	readonly message?: JsonRpcMessage;
	/** Why the line was dropped, when it was not usable. */
	readonly error?: string;
}

/**
 * Incremental newline-delimited JSON decoder.
 *
 * The limit is enforced in UTF-8 bytes against the raw frame, before JSON
 * parsing, so the same message is accepted or rejected regardless of how the
 * transport splits it into chunks. A line that exceeds
 * {@link MAX_MESSAGE_LINE_BYTES} is reported once, its bytes are discarded
 * without being retained, and decoding resynchronizes at the next newline —
 * a runaway server cannot exhaust memory by growing the retained buffer.
 *
 * `maxLineBytes` must be a positive finite integer; anything else is a
 * configuration error, not a size to guess at.
 */
export function createLineDecoder(maxLineBytes: number = MAX_MESSAGE_LINE_BYTES): {
	push(chunk: string): DecodedLine[];
	reset(): void;
} {
	if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
		throw new RangeError(`maxLineBytes must be a positive finite integer, got ${maxLineBytes}`);
	}
	// Batch small fragments so one-character delivery cannot retain millions of
	// array slots. Only newly arrived text is scanned; each line is joined once.
	const blockChars = 4096;
	let blocks: string[] = [];
	let small: string[] = [];
	let smallChars = 0;
	let lineBytes = 0;
	let lastCodeUnit = -1;
	let discarding = false;
	const clearLine = (): void => {
		blocks = [];
		small = [];
		smallChars = 0;
		lineBytes = 0;
		lastCodeUnit = -1;
	};
	const compact = (): void => {
		if (small.length > 0) blocks.push(small.join(""));
		small = [];
		smallChars = 0;
	};
	const append = (part: string): void => {
		if (part.length === 0) return;
		if (part.length >= blockChars) {
			compact();
			blocks.push(part);
		} else {
			small.push(part);
			smallChars += part.length;
			if (smallChars >= blockChars) compact();
		}
	};

	return {
		push(chunk: string): DecodedLine[] {
			const out: DecodedLine[] = [];
			let offset = 0;
			while (offset < chunk.length) {
				const newline = chunk.indexOf("\n", offset);
				const end = newline < 0 ? chunk.length : newline;
				if (!discarding) {
					const part = chunk.slice(offset, end);
					let addedBytes = Buffer.byteLength(part, "utf8");
					// String callers may split a surrogate pair even though the stdio
					// transport already decodes UTF-8 before delivering chunks.
					const first = part.charCodeAt(0);
					if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) {
						addedBytes -= 2;
					}
					lineBytes += addedBytes;
					if (lineBytes > maxLineBytes) {
						out.push({ error: `MCP frame exceeded ${maxLineBytes} bytes` });
						clearLine();
						discarding = true;
					} else {
						append(part);
						if (part.length > 0) lastCodeUnit = part.charCodeAt(part.length - 1);
					}
				}
				if (newline < 0) break;
				if (!discarding) {
					compact();
					const line = blocks.join("").trim();
					if (line.length > 0) out.push(decodeLine(line));
				}
				clearLine();
				discarding = false;
				offset = newline + 1;
			}
			return out;
		},
		reset(): void {
			clearLine();
			discarding = false;
		},
	};
}

function decodeLine(line: string): DecodedLine {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return { error: "MCP frame is not valid JSON" };
	}
	if (isJsonRpcResponse(parsed) || isJsonRpcNotification(parsed) || isJsonRpcRequest(parsed)) {
		return { message: parsed };
	}
	return { error: "MCP frame is not a JSON-RPC 2.0 message" };
}

/** Format a JSON-RPC error body for a human or a model. */
export function formatJsonRpcError(error: JsonRpcErrorBody): string {
	const suffix = error.data === undefined ? "" : ` (${JSON.stringify(error.data)})`;
	return `JSON-RPC error ${error.code}: ${error.message}${suffix}`;
}
