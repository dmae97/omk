/** Largest portable Node timer delay; larger delays are re-armed in chunks. */
export const MAX_RETRY_TIMER_MS = 2_147_483_647;

export function createProviderAbortError(): Error {
	const error = new Error("Request aborted");
	error.name = "AbortError";
	return error;
}

/** A long server delay must never overflow setTimeout into an immediate retry. */
export function sleepProviderRetry(ms: number, signal?: AbortSignal): Promise<void> {
	if (!Number.isFinite(ms) || ms < 0)
		return Promise.reject(new RangeError("Retry sleep must be finite and non-negative"));
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(createProviderAbortError());
			return;
		}
		const startedAt = performance.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let finished = false;
		const cleanup = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = (): void => {
			if (finished) return;
			finished = true;
			cleanup();
			reject(createProviderAbortError());
		};
		const tick = (): void => {
			if (finished) return;
			const remaining = ms - (performance.now() - startedAt);
			if (remaining <= 0) {
				finished = true;
				cleanup();
				resolve();
				return;
			}
			timer = setTimeout(tick, Math.min(MAX_RETRY_TIMER_MS, Math.max(1, Math.ceil(remaining))));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
		else timer = setTimeout(tick, Math.min(MAX_RETRY_TIMER_MS, Math.max(0, Math.ceil(ms))));
	});
}
