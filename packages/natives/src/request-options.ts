export interface RequestOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

function abortReason(signal?: AbortSignal): Error {
	if (!signal || !signal.reason) return new Error("Request aborted");
	if (signal.reason instanceof Error) return signal.reason;
	return new Error("Request aborted", { cause: signal.reason });
}
export async function wrapRequestOptions<T>(fn: () => Promise<T>, options?: RequestOptions): Promise<T> {
	const timeoutMs = options?.timeoutMs ?? 0;
	const signal = options?.signal;

	// Fast path: no timeout + no signal
	if (!signal && timeoutMs <= 0) return fn();

	// If already aborted, fail immediately
	if (signal?.aborted) throw abortReason(signal);

	// If we only have an abort signal and no timeout, keep it simple.
	if (signal && timeoutMs <= 0) {
		return withAbortSignal(fn, signal);
	}

	return withTimeoutAndOptionalAbort(fn, timeoutMs, signal);
}

function withAbortSignal<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(abortReason(signal));
		};

		signal.addEventListener("abort", onAbort, { once: true });

		// If it races and aborts right after addEventListener, `once` handles it,
		// but we still want to short-circuit.
		if (signal.aborted) return onAbort();

		fn().then(
			v => {
				signal.removeEventListener("abort", onAbort);
				resolve(v);
			},
			err => {
				signal.removeEventListener("abort", onAbort);
				reject(err);
			},
		);
	});
}

function withTimeoutAndOptionalAbort<T>(fn: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			if (signal) signal.removeEventListener("abort", onAbort);
		};

		const settle = (ok: boolean, value: any) => {
			if (settled) return;
			settled = true;
			cleanup();
			ok ? resolve(value as T) : reject(value);
		};

		const onAbort = () => settle(false, abortReason(signal!));

		// timeout
		timeoutId = setTimeout(() => {
			settle(false, new Error(`Request timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		// abort (optional)
		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) return onAbort();
		}

		// run
		fn().then(
			v => settle(true, v),
			err => settle(false, err),
		);
	});
}
