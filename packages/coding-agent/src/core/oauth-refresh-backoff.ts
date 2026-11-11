/**
 * Remembers OAuth refreshes that failed, so background callers stop repeating them.
 *
 * The usage rail asks for every configured provider's key about once a minute in every session.
 * A login that can no longer refresh sent a token request each time. A failure is remembered
 * per provider for the refresh token that was tried: a new login or another account has a
 * different token and is tried at once. The wait doubles with each consecutive failure.
 *
 * Process-local on purpose. Each session works this out for itself within a few polls, and a
 * request the user is waiting on never consults it.
 */

const FIRST_WAIT_MS = 60_000;
const MAX_WAIT_MS = 30 * 60_000;

/** Thrown in place of a refresh attempt that is being held back; not a provider failure. */
export class OAuthRefreshDeferredError extends Error {
	constructor(providerId: string) {
		super(`OAuth token refresh for ${providerId} failed recently; not retrying yet`);
		this.name = "OAuthRefreshDeferredError";
	}
}

interface FailedRefresh {
	readonly refreshToken: string;
	readonly failures: number;
	readonly retryAtMs: number;
}

export class OAuthRefreshBackoff {
	private readonly failed = new Map<string, FailedRefresh>();
	private readonly nowMs: () => number;

	/** `nowMs` must be monotonic; the default is not affected by wall-clock steps. */
	constructor(nowMs: () => number = () => performance.now()) {
		this.nowMs = nowMs;
	}

	isDeferred(providerId: string, refreshToken: string): boolean {
		const entry = this.failed.get(providerId);
		return entry !== undefined && entry.refreshToken === refreshToken && this.nowMs() < entry.retryAtMs;
	}

	recordFailure(providerId: string, refreshToken: string): void {
		const previous = this.failed.get(providerId);
		const failures = previous?.refreshToken === refreshToken ? previous.failures + 1 : 1;
		const waitMs = Math.min(FIRST_WAIT_MS * 2 ** (failures - 1), MAX_WAIT_MS);
		this.failed.set(providerId, { refreshToken, failures, retryAtMs: this.nowMs() + waitMs });
	}

	clear(providerId: string): void {
		this.failed.delete(providerId);
	}
}
