import { AsyncLocalStorage } from "node:async_hooks";
import type { OmkGatewayFailure } from "./messages.ts";

/** Filled in while one OMK request runs; read by the stream wrapper once the request has failed. */
export interface OmkCallCapture {
	failure?: OmkGatewayFailure;
}

const calls = new AsyncLocalStorage<OmkCallCapture>();
const WRAPPED = Symbol.for("omk.provider.omk.fetch");

type FetchFn = typeof fetch;

/**
 * Reads a failed gateway response and re-creates it. The OpenAI client reports only "<status> <message>", so the
 * `error.code` (token_expired vs token_revoked, quota_exceeded vs rate_limited) would be lost; the gateway's
 * `x-omk-retryable: false` also is not understood by the shared retry. It is mapped to the `x-should-retry: false`
 * header that retry does honor.
 */
async function observe(response: Response, capture: OmkCallCapture): Promise<Response> {
	const text = await response.text();
	let code: string | undefined;
	let message: string | undefined;
	try {
		const error = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;
		if (typeof error?.code === "string") code = error.code;
		if (typeof error?.message === "string") message = error.message;
	} catch {
		// not a gateway envelope (proxy page, empty body): leave the client's own text alone
	}
	const notRetryable = response.headers.get("x-omk-retryable") === "false";
	capture.failure = { status: response.status, code, message, notRetryable };
	const headers = new Headers(response.headers);
	if (notRetryable) headers.set("x-should-retry", "false");
	return new Response(text, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Make sure `globalThis.fetch` goes through the OMK observer. It only does anything for requests started inside
 * {@link runWithOmkCapture}; every other caller gets the wrapped fetch's response untouched. Called per request, so
 * a fetch replaced later (tests) is wrapped again instead of being bypassed.
 */
function ensureObserver(): void {
	const inner = globalThis.fetch;
	if ((inner as unknown as Record<symbol, boolean>)[WRAPPED]) return;
	const wrapped: FetchFn = async (input, init) => {
		const response = await inner(input, init);
		const capture = calls.getStore();
		return capture && !response.ok ? observe(response, capture) : response;
	};
	(wrapped as unknown as Record<symbol, boolean>)[WRAPPED] = true;
	globalThis.fetch = wrapped;
}

export function runWithOmkCapture<T>(capture: OmkCallCapture, run: () => T): T {
	ensureObserver();
	return calls.run(capture, run);
}
