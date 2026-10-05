/** Options for `on("context", handler, options)`. */
export interface ContextHandlerOptions {
	/**
	 * When `false`, the handler must not mutate `event.messages` or nested fields of the
	 * shared message objects; it may only return `{ messages: newArray }` (or `undefined`).
	 * Default / omitted is mutating-safe (`structuredClone` before handlers run).
	 */
	readonly mutatesMessages?: boolean;
}

/** Non-enumerable marker written by `on("context", …, { mutatesMessages: false })`. */
export const CONTEXT_HANDLER_OPTIONS: unique symbol = Symbol.for("omk.extension.contextHandlerOptions");

/** True unless the handler was registered with `{ mutatesMessages: false }`. */
export function contextHandlerMutatesMessages(handler: object): boolean {
	return (
		(handler as { [CONTEXT_HANDLER_OPTIONS]?: ContextHandlerOptions })[CONTEXT_HANDLER_OPTIONS]?.mutatesMessages !==
		false
	);
}

/** Stamp a context handler as non-mutating for `emitContext` shallow-array sharing. */
export function markContextHandlerNonMutating(handler: object): void {
	Object.defineProperty(handler, CONTEXT_HANDLER_OPTIONS, {
		value: Object.freeze({ mutatesMessages: false as const }),
		enumerable: false,
		configurable: true,
	});
}
