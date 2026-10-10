/**
 * Abort when any source aborts, without `AbortSignal.any()`.
 *
 * On Node 22 a composite from `AbortSignal.any()` that has an abort listener (fetch adds one) and
 * never aborts stays reachable for the life of the process, even after its sources and the
 * composite itself are dropped: about 0.3 KB per call with short-lived sources and 1.1 KB per model
 * request through budget-stream.ts (measured on 22.22.0; nodejs/node #62363 and #64476, fixed in
 * 24.16/24.20 and 26.1/26.7, not in 22.x). Here the forwarding listeners are explicit and
 * `dispose()` removes them, so nothing outlives the request. The same explicit wiring is why
 * `tool-timeout.ts` avoids `AbortSignal.any()`.
 */
export interface AbortLink {
	readonly signal: AbortSignal;
	/** Stop forwarding. Idempotent; call when the request settles. */
	dispose(): void;
}

export function linkAbortSignals(...sources: readonly AbortSignal[]): AbortLink {
	const controller = new AbortController();
	const dispose = (): void => {
		for (const source of sources) source.removeEventListener("abort", forward);
	};
	function forward(this: AbortSignal): void {
		dispose();
		controller.abort(this.reason);
	}
	for (const source of sources) {
		if (source.aborted) {
			dispose();
			controller.abort(source.reason);
			break;
		}
		source.addEventListener("abort", forward);
	}
	return { signal: controller.signal, dispose };
}
