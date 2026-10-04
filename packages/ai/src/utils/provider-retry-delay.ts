const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export function validateProviderRetryOptions(maxRetries: number, maxRetryDelayMs: number | undefined): void {
	if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
		throw new RangeError("maxRetries must be a non-negative safe integer");
	}
	if (maxRetryDelayMs !== undefined && (!Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs < 0)) {
		throw new RangeError("maxRetryDelayMs must be finite and non-negative; zero disables the server-delay cap");
	}
}

function decimal(raw: string | null): number | undefined {
	if (raw === null || !DECIMAL.test(raw.trim())) return undefined;
	const value = Number(raw.trim());
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Invalid server metadata falls back to bounded exponential jitter, not a 1ms timer. */
export function computeProviderRetryDelay(
	headers: Headers | undefined,
	retryIndex: number,
	maxRetryDelayMs: number | undefined,
	providerErrorMessage: string,
	nowMs: number,
	randomValue: number,
): number {
	if (!Number.isSafeInteger(retryIndex) || retryIndex < 0) throw new RangeError("Invalid retryIndex");
	if (!Number.isFinite(nowMs)) throw new RangeError("Invalid wall clock");
	if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1)
		throw new RangeError("Invalid jitter draw");
	validateProviderRetryOptions(0, maxRetryDelayMs);
	let serverDelay = decimal(headers?.get("retry-after-ms") ?? null);
	if (serverDelay === undefined) {
		const raw = headers?.get("retry-after")?.trim() ?? null;
		const seconds = decimal(raw);
		if (seconds !== undefined) {
			const milliseconds = seconds * 1000;
			if (Number.isFinite(milliseconds)) serverDelay = milliseconds;
		} else if (raw !== null && /^[A-Za-z]{3,9},?\s/.test(raw)) {
			// Accept HTTP date forms; do not reinterpret a numeric suffix or negative
			// duration as a permissively parsed calendar date.
			const date = Date.parse(raw);
			const difference = date - nowMs;
			if (Number.isFinite(date) && Number.isFinite(difference)) serverDelay = Math.max(0, difference);
		}
	}
	if (serverDelay !== undefined) {
		const cap = maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
		if (cap > 0 && serverDelay > cap) {
			throw new Error(
				`Server requested ${Math.ceil(serverDelay / 1000)}s retry delay (max: ${Math.ceil(cap / 1000)}s). ${providerErrorMessage}`,
			);
		}
		return serverDelay;
	}
	return Math.min(500 * 2 ** Math.min(retryIndex, 4), 8000) * (1 - randomValue * 0.25);
}
