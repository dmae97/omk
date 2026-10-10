import type { JsonRpcId, JsonRpcMessage } from "./protocol.ts";

/** `notifications/cancelled` lets the server stop work that nobody is waiting for anymore. */
function cancelledNotification(requestId: number, reason: string): JsonRpcMessage {
	return { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason } };
}

/** Attach `onAbort` for the request's lifetime; the returned settlers detach it exactly once. */
export function withAbortListener<T>(
	signal: AbortSignal | undefined,
	onAbort: () => void,
	resolve: (value: T) => void,
	reject: (error: Error) => void,
): { resolve: (value: T) => void; reject: (error: Error) => void } {
	if (!signal) return { resolve, reject };
	signal.addEventListener("abort", onAbort, { once: true });
	const detach = () => signal.removeEventListener("abort", onAbort);
	return {
		resolve: (value) => {
			detach();
			resolve(value);
		},
		reject: (error) => {
			detach();
			reject(error);
		},
	};
}

/**
 * Drop a pending request, stop its timer, and best-effort notify the server.
 * Returns false when the request already settled, so callers settle at most once.
 */
export function cancelPendingRequest(
	pending: Map<JsonRpcId, { readonly timer: ReturnType<typeof setTimeout> }>,
	id: number,
	reason: string,
	send: (notice: JsonRpcMessage) => unknown,
): boolean {
	const entry = pending.get(id);
	if (!entry) return false;
	pending.delete(id);
	clearTimeout(entry.timer);
	try {
		send(cancelledNotification(id, reason));
	} catch {
		// The request already settled locally; a failed notice changes nothing for the caller.
	}
	return true;
}
