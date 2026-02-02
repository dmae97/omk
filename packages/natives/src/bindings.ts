/**
 * Base types for native bindings.
 * Modules extend this interface via declaration merging.
 */

/** Callback type for threadsafe functions from N-API. */
export type TsFunc<T> = (error: Error | null, value: T) => void;

/** Options for cancellable operations. */
export interface Cancellable {
	/** Timeout in milliseconds for the operation. */
	timeoutMs?: number;
	/** Abort signal for cancelling the operation. */
	signal?: AbortSignal;
}

/**
 * Native bindings interface.
 * Extended by each module via declaration merging.
 */
export interface NativeBindings {
	cancelWork(id: number): void;
}
