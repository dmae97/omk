/**
 * Intercept `globalThis.fetch` with a middleware-style handler.
 *
 * Returns a `Disposable` so callers can use `using` for automatic cleanup:
 *
 * ```ts
 * using _hook = hookFetch((input, init, next) => {
 *   if (shouldIntercept(input)) {
 *     return new Response("mocked");
 *   }
 *   return next(input, init);
 * });
 * ```
 */
export type FetchHandler = (
	input: string | URL | Request,
	init: RequestInit | undefined,
	next: typeof fetch,
) => Response | Promise<Response>;

export function hookFetch(handler: FetchHandler): Disposable {
	const original = globalThis.fetch;
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
		handler(input, init, original)) as typeof fetch;
	return {
		[Symbol.dispose]() {
			globalThis.fetch = original;
		},
	};
}
