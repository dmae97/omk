/**
 * Codex wire protocol shared by the SSE and WebSocket transports in openai-codex-responses.ts:
 * the protocol error type and the SSE event parser.
 */
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { formatThrownValue } from "../utils/diagnostics.ts";

export class CodexProtocolError extends Error {
	readonly payload?: unknown;
	readonly cause?: unknown;

	constructor(message: string, options?: { payload?: unknown; cause?: unknown }) {
		super(message);
		this.name = "CodexProtocolError";
		this.payload = options?.payload;
		this.cause = options?.cause;
	}
}

// Characters the parser may hold across reads before an event completes. Same ceiling as the
// Cursor and Devin frame readers (MAX_FRAME_BYTES); an event that arrives within one read is not limited.
const MAX_CODEX_SSE_BUFFER_CHARS = 16 * 1024 * 1024;

export async function* parseSSE(response: Response, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const pending: EventSourceMessage[] = [];
	let overflow: Error | undefined;
	// Accepts LF, CRLF and bare CR terminators, including a CRLF split across reads.
	const parser = createParser({
		maxBufferSize: MAX_CODEX_SSE_BUFFER_CHARS,
		onEvent: (event) => pending.push(event),
		// Unknown fields and a bad `retry` value also arrive here; SSE ignores them, as the old parser did.
		onError: (error) => {
			if (error.type === "max-buffer-size-exceeded") overflow = error;
		},
	});
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (done) break;
			parser.feed(decoder.decode(value, { stream: true }));

			for (const event of pending.splice(0)) {
				const data = event.data.trim();
				if (!data || data === "[DONE]") continue;
				try {
					yield JSON.parse(data) as Record<string, unknown>;
				} catch (cause) {
					throw new CodexProtocolError(`Invalid Codex SSE JSON: ${formatThrownValue(cause)}`, {
						cause,
						payload: data,
					});
				}
			}
			if (overflow) {
				throw new CodexProtocolError(
					`Codex SSE buffered over ${MAX_CODEX_SSE_BUFFER_CHARS} characters without an event`,
					{
						cause: overflow,
					},
				);
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {
			// The terminal event may have already closed the stream.
		}
		try {
			reader.releaseLock();
		} catch {
			// Ignore cleanup races after cancellation.
		}
	}
}
