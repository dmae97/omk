/** Logical request admission policy. Estimates are not provider billing authority. */
export type RequestAdmissionMode = "off" | "observe" | "enforce";
export interface RequestAdmissionPolicy {
	readonly mode: RequestAdmissionMode;
	readonly safetyRatio: number;
	readonly imageTokens: number;
	readonly maxSerializedChars: number;
	readonly maxMessages: number;
	readonly maxTools: number;
	readonly rejectUnknownWindow: boolean;
}
export const DEFAULT_REQUEST_ADMISSION_POLICY: RequestAdmissionPolicy = Object.freeze({
	mode: "observe",
	safetyRatio: 0.1,
	imageTokens: 1200,
	maxSerializedChars: 2_000_000,
	maxMessages: 8192,
	maxTools: 1024,
	rejectUnknownWindow: false,
});
export function snapshotRequestAdmissionPolicy(input: Partial<RequestAdmissionPolicy> = {}): RequestAdmissionPolicy {
	const p = { ...DEFAULT_REQUEST_ADMISSION_POLICY, ...input };
	if (
		!["off", "observe", "enforce"].includes(p.mode) ||
		!Number.isFinite(p.safetyRatio) ||
		p.safetyRatio < 0 ||
		p.safetyRatio >= 1 ||
		typeof p.rejectUnknownWindow !== "boolean"
	)
		throw new RangeError("admission.invalid_policy");
	for (const value of [p.imageTokens, p.maxSerializedChars, p.maxMessages, p.maxTools]) {
		if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("admission.invalid_policy");
	}
	return Object.freeze(p);
}
export function requestAdmissionPolicyFromEnv(): RequestAdmissionPolicy {
	const raw = process.env.OMK_REQUEST_ADMISSION_MODE;
	if (raw === undefined) return DEFAULT_REQUEST_ADMISSION_POLICY;
	if (raw !== "off" && raw !== "observe" && raw !== "enforce") throw new RangeError("admission.invalid_mode");
	return snapshotRequestAdmissionPolicy({ mode: raw });
}
export type AdmissionReason = "fits" | "over_capacity" | "unknown_window" | "invalid_input" | "representation_limit";
export interface RequestAdmissionDecision {
	readonly reason: AdmissionReason;
	readonly estimatedInputTokens?: number;
	readonly reservedOutputTokens?: number;
	readonly safetyTokens?: number;
	readonly contextWindow?: number;
}
export class RequestInputAdmissionError extends Error {
	readonly code = "request_admission_denied";
	readonly decision: RequestAdmissionDecision;
	constructor(decision: RequestAdmissionDecision) {
		super(`omk.request_admission:${decision.reason}; no logical stream was dispatched`);
		this.name = "RequestInputAdmissionError";
		this.decision = Object.freeze({ ...decision });
	}
}
export function decideRequestAdmission(
	input: {
		readonly estimatedInputTokens: number;
		readonly contextWindow: number;
		readonly modelMaxTokens: number;
		readonly requestedMaxTokens?: number;
		readonly reasoning?: string;
	},
	policy: RequestAdmissionPolicy,
): RequestAdmissionDecision {
	const { estimatedInputTokens, contextWindow, modelMaxTokens, requestedMaxTokens, reasoning } = input;
	if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 0) return { reason: "invalid_input" };
	if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return { reason: "unknown_window" };
	if (
		!Number.isSafeInteger(modelMaxTokens) ||
		modelMaxTokens <= 0 ||
		(requestedMaxTokens !== undefined && (!Number.isSafeInteger(requestedMaxTokens) || requestedMaxTokens <= 0))
	)
		return { reason: "invalid_input" };
	// Reasoning providers may add headroom after the logical boundary. Reserve the
	// model ceiling in that case; never pretend the caller's cap is the final wire cap.
	const reservedOutputTokens =
		reasoning !== undefined && reasoning !== "off" ? modelMaxTokens : (requestedMaxTokens ?? modelMaxTokens);
	const safetyTokens = Math.ceil(contextWindow * policy.safetyRatio);
	const available = Math.max(0, contextWindow - reservedOutputTokens - safetyTokens);
	const fits = reservedOutputTokens <= contextWindow - safetyTokens && estimatedInputTokens <= available;
	return Object.freeze({
		reason: fits ? "fits" : "over_capacity",
		estimatedInputTokens,
		reservedOutputTokens,
		safetyTokens,
		contextWindow,
	});
}

/** Stable classification survives conversion from thrown errors to assistant.errorMessage. */
export function requestAdmissionFailure(
	message: string | undefined,
):
	| { readonly area: "provider"; readonly code: "context_overflow" }
	| { readonly area: "configuration"; readonly code: "invalid" }
	| undefined {
	const match = /^omk\.request_admission:(over_capacity|unknown_window|invalid_input|representation_limit);/.exec(
		message ?? "",
	);
	if (!match) return undefined;
	return match[1] === "over_capacity"
		? { area: "provider", code: "context_overflow" }
		: { area: "configuration", code: "invalid" };
}
