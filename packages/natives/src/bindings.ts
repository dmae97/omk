/**
 * Base types for native bindings.
 * Modules extend this interface via declaration merging.
 */

/** Callback type for threadsafe functions from N-API. */
export type TsFunc<T> = (error: Error | null, value: T) => void;

/**
 * Native bindings interface.
 * Extended by each module via declaration merging.
 */
export interface NativeBindings {}
