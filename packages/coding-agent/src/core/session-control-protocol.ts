export const SESSION_CONTROL_VERSION = 1;
export const MAX_CONTROL_BYTES = 32_768;
export const MAX_CONTROL_TEXT = 16_384;
export type SessionControlAction = "status" | "prompt" | "steer" | "followUp" | "abort";

export interface SessionControlRequest {
	readonly version: 1;
	readonly sessionId: string;
	readonly token: string;
	readonly requestId: string;
	readonly action: SessionControlAction;
	readonly text?: string;
}

export interface SessionControlResponse {
	readonly requestId: string;
	readonly sessionId: string;
	readonly status: "ok" | "accepted" | "refused";
	readonly error?: string;
	readonly state?: { readonly streaming: boolean; readonly queued: number; readonly lastOutcome?: string };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseControlRequest(value: unknown): SessionControlRequest {
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => !["version", "sessionId", "token", "requestId", "action", "text"].includes(key))
	)
		throw new Error("invalid control request");
	const { version, sessionId, token, requestId, action, text } = value;
	if (
		version !== SESSION_CONTROL_VERSION ||
		typeof sessionId !== "string" ||
		sessionId.length < 1 ||
		sessionId.length > 128 ||
		typeof token !== "string" ||
		!/^[a-f0-9]{64}$/.test(token) ||
		typeof requestId !== "string" ||
		!/^[a-zA-Z0-9-]{1,128}$/.test(requestId)
	)
		throw new Error("invalid control identity");
	if (action !== "status" && action !== "prompt" && action !== "steer" && action !== "followUp" && action !== "abort")
		throw new Error("invalid control action");
	if (action === "prompt" || action === "steer" || action === "followUp") {
		if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_CONTROL_TEXT)
			throw new Error("invalid control text");
	} else if (text !== undefined) throw new Error("unexpected control text");
	return { version, sessionId, token, requestId, action, ...(typeof text === "string" ? { text } : {}) };
}
