import * as undici from "undici";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, parseHttpIdleTimeoutMs } from "./http-idle-timeout.ts";

export {
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	formatHttpIdleTimeoutMs,
	HTTP_IDLE_TIMEOUT_CHOICES,
	parseHttpIdleTimeoutMs,
} from "./http-idle-timeout.ts";

/**
 * The `globalThis.fetch` value omk owns. Only while `globalThis.fetch` is still
 * this value may `configureHttpDispatcher` replace it with undici's fetch; any
 * other value is a deliberate override (an extension hook) and is left alone.
 * Defaults to the fetch seen at import. The lazy installer imports this module
 * on the first request, after extensions load, so it must call
 * `adoptGlobalFetch` with its own hook before configuring.
 */
let ownedGlobalFetch: typeof globalThis.fetch = globalThis.fetch;

/** The fetch that pairs with the dispatcher installed below. */
export const dispatcherFetch = undici.fetch as unknown as typeof globalThis.fetch;

export function adoptGlobalFetch(fetchFn: typeof globalThis.fetch): void {
	ownedGlobalFetch = fetchFn;
}

export function configureHttpDispatcher(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
	const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
	if (normalizedTimeoutMs === undefined) {
		throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
	}
	undici.setGlobalDispatcher(
		new undici.EnvHttpProxyAgent({
			allowH2: false,
			bodyTimeout: normalizedTimeoutMs,
			headersTimeout: normalizedTimeoutMs,
		}),
	);
	// Keep fetch and the dispatcher on the same undici implementation. Node 26.0's
	// bundled fetch can otherwise consume compressed responses through npm undici's
	// dispatcher without decompressing them, causing response.json() failures.
	// If anyone else replaced fetch, preserve that deliberate override.
	if (globalThis.fetch === ownedGlobalFetch) {
		undici.install?.();
		ownedGlobalFetch = globalThis.fetch;
	}
}
