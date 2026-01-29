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
 * Creates a deferred { promise, resolve, reject } triple which automatically rejects
 * with { name: "AbortError" } if the given abort signal fires before resolve/reject.
 *
 * @param signal - Optional AbortSignal to cancel the operation
 * @returns A deferred { promise, resolve, reject } triple
 */
export function createAbortablePromise<T>(signal?: AbortSignal): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	if (!signal) {
		return Promise.withResolvers<T>();
	} else if (signal.aborted) {
		return { promise: Promise.reject(new AbortError(signal)), resolve: () => {}, reject: () => {} };
	}

	const { promise, resolve, reject } = Promise.withResolvers<T>();

	const abortHandler = () => {
		reject(new AbortError(signal));
	};
	signal.addEventListener("abort", abortHandler, { once: true });
	promise
		.finally(() => {
			signal.removeEventListener("abort", abortHandler);
		})
		.catch(() => {});
	return { promise, resolve, reject };
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
	if (!signal) {
		return pr();
	} else if (signal.aborted) {
		return Promise.reject(new AbortError(signal));
	}
	const { promise, resolve, reject } = createAbortablePromise<T>(signal);
	let settled = false;
	const wrappedResolve = (value: T | PromiseLike<T>) => {
		if (!settled) {
			settled = true;
			resolve(value);
		}
	};
	const wrappedReject = (reason?: unknown) => {
		if (!settled) {
			settled = true;
			reject(reason);
		}
	};
	pr().then(wrappedResolve, wrappedReject);
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
