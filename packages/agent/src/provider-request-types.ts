import type { SimpleStreamOptions } from "omk-ai";

type ContractThinkingLevel = "off" | NonNullable<SimpleStreamOptions["reasoning"]>;
export interface ModelIdentity {
	readonly provider: string;
	readonly id: string;
}

/** Logical dispatch policy, not endpoint, credential, or serialized-payload attestation. */
export interface ModelContract {
	readonly allowedModels: readonly ModelIdentity[];
	readonly allowedProviders: readonly string[];
	readonly allowedAuthOrigins: readonly string[];
	readonly thinking: boolean;
	readonly maxOutputTokens: number;
	readonly thinkingLevel?: ContractThinkingLevel;
}

export interface RouteRequest {
	readonly model: ModelIdentity;
	readonly provider: string;
	readonly thinking: boolean;
	readonly maxOutputTokens?: number;
	/** Logical credential resolver identity; omission means request.provider. */
	readonly authOrigin?: string;
	readonly thinkingLevel?: ContractThinkingLevel;
}

export type ModelContractViolationCode =
	| "invalid-contract"
	| "invalid-contract-limit"
	| "invalid-request"
	| "invalid-request-limit"
	| "model-not-allowed"
	| "provider-not-allowed"
	| "provider-mismatch"
	| "auth-origin-not-allowed"
	| "thinking-not-allowed"
	| "thinking-level-mismatch"
	| "output-limit-exceeded";

export type ProviderRequestEvent =
	| {
			readonly type: "provider_denied";
			readonly requestId: string;
			readonly deniedReason: "contract-violation" | "aborted";
	  }
	| {
			readonly type: "provider_request";
			readonly requestId: string;
			readonly provider: string;
			readonly model: string;
			readonly maxOutputTokens: number;
			/** Tool attachments replaced by explicit text placeholders in this provider view. */
			readonly omittedToolImages?: number;
			readonly boundary: "stream-dispatch";
	  }
	| {
			readonly type: "provider_request_end";
			readonly requestId: string;
			readonly outcome: "completed" | "error" | "aborted";
			readonly boundary: "stream-dispatch";
	  };
