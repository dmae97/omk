/**
 * Connect streaming frames for the Devin chat call. Node-only: gzip frames
 * need `node:zlib`, so this module stays off the browser-safe static path
 * (`devin-api.ts` only needs the unary reader in `devin-connect.ts`).
 */

import { gunzipSync } from "node:zlib";

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

function checkTrailer(payload: Buffer): void {
	let trailer: unknown;
	try {
		trailer = JSON.parse(payload.toString("utf8"));
	} catch {
		throw new Error("Invalid Devin Connect trailer");
	}
	if (!trailer || typeof trailer !== "object" || Array.isArray(trailer))
		throw new Error("Invalid Devin Connect trailer");
	if (!("error" in trailer) || !trailer.error) return;
	const error = trailer.error;
	const code =
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string" &&
		/^[a-z_]{1,40}$/.test(error.code)
			? error.code
			: "unknown";
	const message =
		typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
	// Classify evidence without returning a remote body that may echo secrets or prompts.
	// Quota wording, not "rate limit": the latter is retried in place and skips
	// failover and compaction trim. The trailer body is not echoed.
	if (code === "resource_exhausted") throw new Error("Devin quota exceeded");
	if (code === "unauthenticated") throw new Error("Devin authentication failed; run /login devin");
	if (
		code === "invalid_argument" &&
		/context[_ ]length[_ ]exceeded|prompt is too long|too many tokens|exceeds the context window/i.test(message)
	)
		throw new Error("Devin context_length_exceeded");
	const traceId = /\btrace ID:\s*([a-f0-9]{16,64})(?=[)\s.,]|$)/i.exec(message)?.[1];
	throw new Error(`Devin stream error: ${code}${traceId ? ` (trace ID: ${traceId})` : ""}`);
}

/** Connect requires an explicit final trailer; an HTTP EOF alone is not success. */
export async function* readConnectFrames(response: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Devin chat failed (HTTP ${response.status})`);
	}
	if (!response.body) throw new Error("Devin returned an empty stream");
	const reader = response.body.getReader();
	let pending: Buffer = Buffer.alloc(0);
	let ended = false;
	const abort = () => {
		reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (value?.length) pending = Buffer.concat([pending, value]);
			while (pending.length >= 5) {
				if (ended) throw new Error("Devin sent data after its terminal trailer");
				const flags = pending[0];
				const length = pending.readUInt32BE(1);
				if (flags & ~3) throw new Error("Invalid Devin Connect flags");
				if (length > MAX_FRAME_BYTES) throw new Error("Devin Connect frame exceeds size limit");
				if (pending.length < length + 5) break;
				let payload = pending.subarray(5, length + 5);
				pending = pending.subarray(length + 5);
				if (flags & 1) payload = gunzipSync(payload, { maxOutputLength: MAX_FRAME_BYTES });
				if (flags & 2) {
					checkTrailer(payload);
					ended = true;
				} else {
					yield payload;
				}
			}
			if (done) break;
		}
		if (pending.length) throw new Error("Truncated Devin Connect frame");
		if (!ended) throw new Error("Devin stream missing terminal trailer");
	} finally {
		signal.removeEventListener("abort", abort);
		await reader.cancel();
		reader.releaseLock();
	}
}
