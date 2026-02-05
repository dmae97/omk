import assert from "node:assert/strict";

export class AbortError extends Error {
	constructor(signal: AbortSignal) {
		assert(signal.aborted, "Abort signal must be aborted");

		const message = signal.reason instanceof Error ? signal.reason.message : "Cancelled";
		super(`Aborted: ${message}`, { cause: signal.reason });
		this.name = "AbortError";
	}
}

/**
 * Sleep for a given number of milliseconds, respecting abort signal.
 */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return untilAborted(signal, () => Bun.sleep(ms));
}

/**
 * Creates an abortable stream from a given stream and signal.
 *
 * @param stream - The stream to make abortable
 * @param signal - The signal to abort the stream
 * @returns The abortable stream
 */
export function createAbortableStream<T>(stream: ReadableStream<T>, signal?: AbortSignal): ReadableStream<T> {
	if (!signal) return stream;
	return stream.pipeThrough(new TransformStream<T, T>(), { signal });
}

/**
 * Runs a promise-returning function (`pr`). If the given AbortSignal is aborted before or during
 * execution, the promise is rejected with a standard error.
 *
 * @param signal - Optional AbortSignal to cancel the operation
 * @param pr - Function returning a promise to run
 * @returns Promise resolving as `pr` would, or rejecting on abort
 */
export function untilAborted<T>(signal: AbortSignal | undefined | null, pr: () => Promise<T>): Promise<T> {
	if (!signal) return pr();
	if (signal.aborted) return Promise.reject(new AbortError(signal));

	const { promise, resolve, reject } = Promise.withResolvers<T>();
	const onAbort = () => reject(new AbortError(signal));
	signal.addEventListener("abort", onAbort, { once: true });
	const cleanup = () => signal.removeEventListener("abort", onAbort);

	void (async () => {
		try {
			const out = await pr();
			resolve(out);
		} catch (err) {
			reject(err);
		} finally {
			cleanup();
		}
	})();

	return promise;
}

/**
 * Memoizes a function with no arguments, calling it once and caching the result.
 *
 * @param fn - Function to be called once
 * @returns A function that returns the cached result of `fn`
 */
export function once<T>(fn: () => T): () => T {
	let store = undefined as { value: T } | undefined;
	return () => {
		if (store) {
			return store.value;
		}
		const value = fn();
		store = { value };
		return value;
	};
}
