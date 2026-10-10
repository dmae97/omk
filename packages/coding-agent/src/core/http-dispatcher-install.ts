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
/** The wrapper `installHttpDispatcherFetchHook` put on `globalThis.fetch`. */
let hookFetch: typeof globalThis.fetch | undefined;
/** The fetch paired with the installed dispatcher; the hook forwards to it. */
let pairedFetch: typeof globalThis.fetch | undefined;

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
		const { adoptGlobalFetch, configureHttpDispatcher, dispatcherFetch } = await import("./http-dispatcher.ts");
		// The import runs after extensions load. Compare against omk's own hook,
		// not whatever `globalThis.fetch` is now, so an extension's hook survives.
		if (hookFetch) adoptGlobalFetch(hookFetch);
		configureFn = configureHttpDispatcher;
		configureHttpDispatcher(pendingTimeoutMs);
		pairedFetch = dispatcherFetch;
	})().catch((error: unknown) => {
		installPromise = undefined;
		configureFn = undefined;
		pairedFetch = undefined;
		throw error;
	});
	return installPromise;
}

/**
 * Wrap `globalThis.fetch` so the first call installs the dispatcher before any
 * request leaves. One common choke point covers providers, OAuth, and tools.
 * The wrapper then forwards to the fetch paired with the dispatcher, never to
 * `globalThis.fetch`: an extension that wrapped this hook stays in front of it.
 */
export function installHttpDispatcherFetchHook(): void {
	if (hookFetch) {
		return;
	}
	const priorFetch = globalThis.fetch.bind(globalThis);
	const wrapper: typeof globalThis.fetch = async (input, init) => {
		await ensureHttpDispatcherInstalled();
		return (pairedFetch ?? priorFetch)(input, init);
	};
	hookFetch = wrapper;
	globalThis.fetch = wrapper;
}
