type ErrorLike = {
	message?: string;
	name?: string;
	status?: number;
	statusCode?: number;
	response?: { status?: number };
	cause?: unknown;
};

const TRANSIENT_MESSAGE_PATTERN =
	/overloaded|rate.?limit|usage.?limit|too many requests|service.?unavailable|server error|internal error|connection.?error|fetch failed/i;

const VALIDATION_MESSAGE_PATTERN =
	/invalid|validation|bad request|unsupported|schema|missing required|not found|unauthorized|forbidden/i;

/**
 * Identify errors that should be retried (timeouts, 5xx, 408, 429, transient network failures).
 */
export function isRetryableError(error: unknown): boolean {
	const info = error as ErrorLike | null;
	const message = info?.message ?? "";
	const name = info?.name ?? "";
	if (name === "AbortError" || /timeout|timed out|aborted/i.test(message)) return true;

	const status = extractHttpStatusFromError(error);
	if (status !== undefined) {
		if (status >= 500) return true;
		if (status === 408 || status === 429) return true;
		if (status >= 400 && status < 500) return false;
	}

	if (VALIDATION_MESSAGE_PATTERN.test(message)) return false;

	return TRANSIENT_MESSAGE_PATTERN.test(message);
}

export function extractHttpStatusFromError(error: unknown, depth = 0): number | undefined {
	if (!error || typeof error !== "object" || depth > 3) return undefined;
	const info = error as ErrorLike;
	const status =
		info.status ??
		info.statusCode ??
		(info.response && typeof info.response === "object" ? info.response.status : undefined);
	if (typeof status === "number" && status >= 100 && status <= 599) {
		return status;
	}

	if (info.message) {
		const extracted = extractStatusFromMessage(info.message);
		if (extracted !== undefined) return extracted;
	}

	if (info.cause) {
		return extractHttpStatusFromError(info.cause, depth + 1);
	}

	return undefined;
}

function extractStatusFromMessage(message: string): number | undefined {
	const patterns = [
		/error\s*\((\d{3})\)/i,
		/status\s*[:=]?\s*(\d{3})/i,
		/\bhttp\s*(\d{3})\b/i,
		/\b(\d{3})\s*(?:status|error)\b/i,
	];

	for (const pattern of patterns) {
		const match = pattern.exec(message);
		if (!match) continue;
		const value = Number(match[1]);
		if (Number.isFinite(value) && value >= 100 && value <= 599) {
			return value;
		}
	}

	return undefined;
}
