/**
 * Standardized error types for tool execution.
 *
 * Tools should throw these instead of returning error text.
 * The agent loop catches and renders them appropriately.
 */

/**
 * Base error for tool execution failures.
 * Override render() for custom LLM-facing formatting.
 */
export class ToolError extends Error {
	constructor(
		message: string,
		readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ToolError";
	}

	/** Render error for LLM consumption. Override for custom formatting. */
	render(): string {
		return this.message;
	}
}

/**
 * Error entry for MultiError.
 */
export interface ErrorEntry {
	message: string;
	context?: string;
}

/**
 * Error with multiple entries (e.g., multiple validation failures, batch errors).
 */
export class MultiError extends ToolError {
	readonly errors: ErrorEntry[];

	constructor(errors: ErrorEntry[]) {
		super(errors.map((e) => e.message).join("; "));
		this.name = "MultiError";
		this.errors = errors;
	}

	render(): string {
		if (this.errors.length === 1) {
			const e = this.errors[0];
			return e.context ? `${e.context}: ${e.message}` : e.message;
		}
		return this.errors.map((e) => (e.context ? `${e.context}: ${e.message}` : e.message)).join("\n");
	}

	static from(errors: Array<string | ErrorEntry>): MultiError {
		return new MultiError(errors.map((e) => (typeof e === "string" ? { message: e } : e)));
	}
}

/**
 * Error thrown when a tool operation is aborted (e.g., via AbortSignal).
 */
export class ToolAbortError extends Error {
	static readonly MESSAGE = "Operation aborted";

	constructor(message: string = ToolAbortError.MESSAGE) {
		super(message);
		this.name = "ToolAbortError";
	}
}

/**
 * Throw ToolAbortError if the signal is aborted.
 * Use this instead of signal?.throwIfAborted() to get consistent error types.
 */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const reason = signal.reason instanceof Error ? signal.reason : undefined;
		throw reason instanceof ToolAbortError ? reason : new ToolAbortError();
	}
}

/**
 * Render an error for LLM consumption.
 * Handles ToolError.render() and falls back to message/string.
 */
export function renderError(e: unknown): string {
	if (e instanceof ToolError) {
		return e.render();
	}
	if (e instanceof Error) {
		return e.message;
	}
	return String(e);
}
