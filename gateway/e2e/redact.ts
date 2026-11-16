/** Redact account tokens and Bearer credentials from any text we persist. */
const TOKEN_RE = /omk_test_[A-Za-z0-9]+/g;
const BEARER_RE = /Bearer\s+\S+/gi;

export function redact(s: string): string {
	return s.replace(TOKEN_RE, "omk_test_[REDACTED]").replace(BEARER_RE, "Bearer [REDACTED]");
}

export function redactJson(value: unknown): unknown {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value)) return value.map(redactJson);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			const key = k.toLowerCase();
			if (key.includes("token") || key === "authorization" || key === "apikey" || key === "api_key") {
				out[k] = typeof v === "string" && v ? "[REDACTED]" : v;
			} else {
				out[k] = redactJson(v);
			}
		}
		return out;
	}
	return value;
}
