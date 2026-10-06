/**
 * Installs undici's global dispatcher lazily, on the first `fetch`.
 *
 * Importing `http-dispatcher.ts` pulls undici (~9 MB RSS). CLI boot used to do
 * that unconditionally via `configureHttpDispatcher()`, so even `omk -p --help`
 * and the AgentSession import path paid for it. This module keeps only the
 * pending timeout and a one-shot fetch hook; undici loads when the first
 * network request actually runs (or when a caller forces ensure).
 */
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, parseHttpIdleTimeoutMs } from "./http-idle-timeout.ts";

export {
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	formatHttpIdleTimeoutMs,
	HTTP_IDLE_TIMEOUT_CHOICES,
	parseHttpIdleTimeoutMs,
} from "./http-idle-timeout.ts";

type ConfigureHttpDispatcher = (timeoutMs?: number) => void;

let pendingTimeoutMs = DEFAULT_HTTP_IDLE_TIMEOUT_MS;
let configureFn: ConfigureHttpDispatcher | undefined;
let installPromise: Promise<void> | undefined;
let fetchHookInstalled = false;

function normalizeTimeoutMs(timeoutMs: number): number {
	const normalized = parseHttpIdleTimeoutMs(timeoutMs);
	if (normalized === undefined) {
		throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
	}
	return normalized;
}

/**
 * Remember the idle timeout. If undici is already installed, reconfigure now;
 * otherwise the next `fetch` (via the hook) or `ensureHttpDispatcherInstalled`
 * applies it.
 */
export function scheduleHttpDispatcher(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
	pendingTimeoutMs = normalizeTimeoutMs(timeoutMs);
	if (configureFn) {
		configureFn(pendingTimeoutMs);
	}
}

/** Load undici and install the dispatcher once. Safe to call concurrently. */
export function ensureHttpDispatcherInstalled(): Promise<void> {
	installPromise ??= (async () => {
		const { configureHttpDispatcher } = await import("./http-dispatcher.ts");
		configureFn = configureHttpDispatcher;
		configureHttpDispatcher(pendingTimeoutMs);
	})().catch((error: unknown) => {
		installPromise = undefined;
		configureFn = undefined;
		throw error;
	});
	return installPromise;
}

/**
 * Wrap `globalThis.fetch` so the first call installs the dispatcher before any
 * request leaves. `undici.install()` may replace `fetch`; we then forward to
 * the replacement. One common choke point covers providers, OAuth, and tools.
 */
export function installHttpDispatcherFetchHook(): void {
	if (fetchHookInstalled) {
		return;
	}
	fetchHookInstalled = true;
	const priorFetch = globalThis.fetch.bind(globalThis);
	const wrapper: typeof globalThis.fetch = async (input, init) => {
		await ensureHttpDispatcherInstalled();
		const current = globalThis.fetch;
		if (current !== wrapper) {
			return current(input, init);
		}
		return priorFetch(input, init);
	};
	globalThis.fetch = wrapper;
}
