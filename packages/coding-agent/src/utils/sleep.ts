/** Largest delay one Node timer holds; `setTimeout` fires a longer delay after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Sleep helper that respects abort signal. A delay longer than one timer can hold re-arms in
 * timer-sized chunks instead of firing early; a negative or NaN delay waits one tick without
 * Node's timer warning. The abort listener is removed once the sleep ends.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		let timeout: ReturnType<typeof setTimeout> | undefined;
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(new Error("Aborted"));
		};
		const wait = (remaining: number): void => {
			timeout = setTimeout(
				() => {
					if (remaining > MAX_TIMER_DELAY_MS) {
						wait(remaining - MAX_TIMER_DELAY_MS);
						return;
					}
					signal?.removeEventListener("abort", onAbort);
					resolve();
				},
				Math.min(remaining, MAX_TIMER_DELAY_MS),
			);
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		// Not Math.max(0, ms): that keeps NaN, which Node warns about.
		wait(ms > 0 ? ms : 0);
	});
}
