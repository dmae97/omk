export type LogSink = (line: string) => void;

const ALLOWED = new Set(["request_id", "event_id", "key", "status", "code", "model", "ms", "stream", "estimated", "end_reason", "method", "path", "total_tokens", "msg"]);
// Defense in depth: even an allowed field is scrubbed of token-like and Bearer values.
const PATTERNS: [RegExp, string][] = [
	[new RegExp(`${["omk", ""].join("_")}[A-Za-z]+_[A-Za-z0-9]+`, "g"), "[redacted]"],
	[new RegExp(`\\b${"sk"}-[A-Za-z0-9_-]{8,}`, "g"), "[redacted]"],
	[/Bearer\s+\S+/gi, "Bearer [redacted]"],
];

export function redact(s: string): string {
	return PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

export interface Logger {
	info(event: string, fields?: Record<string, unknown>): void;
	warn(event: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON lines. Only whitelisted fields are ever emitted: no headers, no bodies. */
export function createLogger(sink: LogSink): Logger {
	const emit = (level: string, event: string, fields: Record<string, unknown> = {}) => {
		const o: Record<string, unknown> = { level, event };
		for (const [k, v] of Object.entries(fields)) {
			if (!ALLOWED.has(k)) continue;
			o[k] = typeof v === "string" ? redact(v) : v;
		}
		sink(JSON.stringify(o));
	};
	return { info: (e, f) => emit("info", e, f), warn: (e, f) => emit("warn", e, f) };
}
