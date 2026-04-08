import { $env } from "@oh-my-pi/pi-utils";

const DEFAULT_OPENAI_STREAM_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS = 60_000;

function normalizeIdleTimeoutMs(value: string | undefined, fallback: number): number | undefined {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	if (parsed <= 0) return undefined;
	return Math.trunc(parsed);
}

/**
 * Returns the idle timeout used for OpenAI-family streaming transports.
 *
 * Set `PI_OPENAI_STREAM_IDLE_TIMEOUT_MS=0` to disable the watchdog.
 */
export function getOpenAIStreamIdleTimeoutMs(): number | undefined {
	return normalizeIdleTimeoutMs($env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS, DEFAULT_OPENAI_STREAM_IDLE_TIMEOUT_MS);
}

/**
 * Returns the timeout used while waiting for the first stream event.
 * The first token can legitimately take longer than later inter-event gaps,
 * so the default never undershoots the steady-state idle timeout.
 *
 * Set `PI_STREAM_FIRST_EVENT_TIMEOUT_MS=0` to disable the watchdog.
 */
export function getStreamFirstEventTimeoutMs(idleTimeoutMs?: number): number | undefined {
	const fallback =
		idleTimeoutMs === undefined
			? DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS
			: Math.max(DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS, idleTimeoutMs);
	return normalizeIdleTimeoutMs($env.PI_STREAM_FIRST_EVENT_TIMEOUT_MS, fallback);
}

export interface FirstEventWatchdog {
	markFirstEventReceived(): void;
	cleanup(): void;
}

/**
 * Starts a watchdog that aborts a request if no first stream event arrives in time.
 * Call `markFirstEventReceived()` as soon as the first event is observed.
 */
export function createFirstEventWatchdog(timeoutMs: number | undefined, onTimeout: () => void): FirstEventWatchdog {
	let timer: NodeJS.Timeout | undefined;
	if (timeoutMs !== undefined && timeoutMs > 0) {
		timer = setTimeout(() => {
			timer = undefined;
			onTimeout();
		}, timeoutMs);
	}
	return {
		markFirstEventReceived() {
			if (!timer) return;
			clearTimeout(timer);
			timer = undefined;
		},
		cleanup() {
			if (!timer) return;
			clearTimeout(timer);
			timer = undefined;
		},
	};
}

/**
 * Wraps an async iterable and clears the watchdog once the first event arrives.
 */
export async function* markFirstStreamEvent<T>(
	iterable: AsyncIterable<T>,
	watchdog: FirstEventWatchdog,
): AsyncGenerator<T> {
	let sawFirstEvent = false;
	try {
		for await (const item of iterable) {
			if (!sawFirstEvent) {
				sawFirstEvent = true;
				watchdog.markFirstEventReceived();
			}
			yield item;
		}
	} finally {
		watchdog.cleanup();
	}
}

export interface IdleTimeoutIteratorOptions {
	idleTimeoutMs?: number;
	firstItemTimeoutMs?: number;
	errorMessage: string;
	firstItemErrorMessage?: string;
	onIdle?: () => void;
	onFirstItemTimeout?: () => void;
}

/**
 * Yields items from an async iterable while enforcing a maximum idle gap between items.
 *
 * The first item may use a shorter timeout so stuck requests can be aborted and retried
 * before any user-visible content has streamed.
 */
export async function* iterateWithIdleTimeout<T>(
	iterable: AsyncIterable<T>,
	options: IdleTimeoutIteratorOptions,
): AsyncGenerator<T> {
	const firstItemTimeoutMs = options.firstItemTimeoutMs ?? options.idleTimeoutMs;
	if (
		(firstItemTimeoutMs === undefined || firstItemTimeoutMs <= 0) &&
		(options.idleTimeoutMs === undefined || options.idleTimeoutMs <= 0)
	) {
		for await (const item of iterable) {
			yield item;
		}
		return;
	}

	const iterator = iterable[Symbol.asyncIterator]();
	let sawFirstItem = false;

	while (true) {
		const nextResultPromise = iterator.next().then(
			result => ({ kind: "next" as const, result }),
			error => ({ kind: "error" as const, error }),
		);
		const activeTimeoutMs = sawFirstItem ? options.idleTimeoutMs : firstItemTimeoutMs;

		if (activeTimeoutMs === undefined || activeTimeoutMs <= 0) {
			const outcome = await nextResultPromise;
			if (outcome.kind === "error") {
				throw outcome.error;
			}
			if (outcome.result.done) {
				return;
			}
			sawFirstItem = true;
			yield outcome.result.value;
			continue;
		}

		const { promise: timeoutPromise, resolve: resolveTimeout } = Promise.withResolvers<{
			kind: "timeout";
		}>();
		const timer = setTimeout(() => resolveTimeout({ kind: "timeout" }), activeTimeoutMs);

		try {
			const outcome = await Promise.race([nextResultPromise, timeoutPromise]);
			if (outcome.kind === "timeout") {
				if (sawFirstItem) {
					options.onIdle?.();
				} else {
					options.onFirstItemTimeout?.();
				}
				const returnPromise = iterator.return?.();
				if (returnPromise) {
					void returnPromise.catch(() => {});
				}
				throw new Error(
					sawFirstItem ? options.errorMessage : (options.firstItemErrorMessage ?? options.errorMessage),
				);
			}
			if (outcome.kind === "error") {
				throw outcome.error;
			}
			if (outcome.result.done) {
				return;
			}
			sawFirstItem = true;
			yield outcome.result.value;
		} finally {
			clearTimeout(timer);
		}
	}
}
