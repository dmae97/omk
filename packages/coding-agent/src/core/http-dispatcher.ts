// The explicit entry avoids Bun's native undici shim, which ignores fetch integrity.
import * as undici from "undici/index.js";
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

const originalRequest = globalThis.Request;
// SAFETY: npm undici implements Fetch, with separate DOM Request/Response typings.
const npmFetch = undici.fetch as unknown as typeof globalThis.fetch;

/** Preserve Requests created before the lazy installer replaces the native classes. */
export const dispatcherFetch: typeof globalThis.fetch = (input, init) => {
	if (input instanceof originalRequest && !(input instanceof undici.Request)) {
		// SAFETY: Fetch Request fields map to the same RequestInit dictionary keys.
		const requestInit: undici.RequestInit = {
			// SAFETY: Bun and npm undici both use Web streams for request bodies.
			body: input.body as unknown as undici.BodyInit,
			cache: input.cache,
			credentials: input.credentials,
			duplex: "half",
			// SAFETY: both Headers implementations expose the Fetch header iterable.
			headers: input.headers as unknown as undici.HeadersInit,
			integrity: input.integrity,
			keepalive: input.keepalive,
			method: input.method,
			mode: input.mode,
			redirect: input.redirect,
			referrer: input.referrer,
			referrerPolicy: input.referrerPolicy,
			signal: input.signal,
		};
		const request = new undici.Request(input.url, requestInit);
		// SAFETY: the request now has npm undici's brand, which npmFetch consumes.
		return npmFetch(request as unknown as Request, init);
	}
	return npmFetch(input, init);
};

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
		globalThis.fetch = dispatcherFetch;
		ownedGlobalFetch = dispatcherFetch;
	}
}
