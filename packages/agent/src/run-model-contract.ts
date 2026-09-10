import { createImmutableSnapshot } from "./plain-data.ts";
import type {
	ModelContract,
	ModelContractViolationCode,
	ModelIdentity,
	RouteRequest,
} from "./provider-request-types.ts";

export type { ModelContract, ModelContractViolationCode, RouteRequest } from "./provider-request-types.ts";

const MESSAGES: Record<ModelContractViolationCode, string> = {
	"invalid-contract": "Invalid model contract shape",
	"invalid-contract-limit": "contract maxOutputTokens must be a positive safe integer",
	"invalid-request": "Invalid model contract request shape",
	"invalid-request-limit": "request maxOutputTokens must be a positive safe integer",
	"model-not-allowed": "Model is not allowed by the model contract",
	"provider-not-allowed": "Provider is not allowed by the model contract",
	"provider-mismatch": "Request provider does not match model provider",
	"auth-origin-not-allowed": "Credential resolver origin is not allowed by the model contract",
	"thinking-not-allowed": "Thinking is not allowed by the model contract",
	"thinking-level-mismatch": "Thinking level does not match the model contract",
	"output-limit-exceeded": "Request output limit exceeds the model contract",
};
const LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export class ModelContractViolation extends Error {
	readonly code: ModelContractViolationCode;

	constructor(code: ModelContractViolationCode) {
		const safeCode = typeof code === "string" && Object.hasOwn(MESSAGES, code) ? code : "invalid-contract";
		super(MESSAGES[safeCode]);
		this.name = "ModelContractViolation";
		this.code = safeCode;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value)
	);
}

function isIdentity(value: unknown): value is ModelIdentity {
	return isRecord(value) && isIdentifier(value.provider) && isIdentifier(value.id);
}

function isBoundedList<T>(value: unknown, guard: (entry: unknown) => entry is T): value is readonly T[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) return false;
	// Array.every skips holes; a sparse allowlist must not silently pass validation.
	for (const entry of value) if (!guard(entry)) return false;
	return true;
}

function validateContract(contract: unknown): asserts contract is ModelContract {
	if (!isRecord(contract)) throw new ModelContractViolation("invalid-contract");
	if (
		typeof contract.maxOutputTokens !== "number" ||
		!Number.isSafeInteger(contract.maxOutputTokens) ||
		contract.maxOutputTokens <= 0
	) {
		throw new ModelContractViolation("invalid-contract-limit");
	}
	if (
		!isBoundedList(contract.allowedModels, isIdentity) ||
		!isBoundedList(contract.allowedProviders, isIdentifier) ||
		!isBoundedList(contract.allowedAuthOrigins, isIdentifier) ||
		typeof contract.thinking !== "boolean" ||
		Object.keys(contract).some(
			(key) =>
				![
					"allowedModels",
					"allowedProviders",
					"allowedAuthOrigins",
					"thinking",
					"maxOutputTokens",
					"thinkingLevel",
				].includes(key),
		) ||
		(contract.thinkingLevel !== undefined &&
			(typeof contract.thinkingLevel !== "string" || !LEVELS.includes(contract.thinkingLevel))) ||
		(contract.thinkingLevel !== undefined && contract.thinkingLevel !== "off" && !contract.thinking)
	) {
		throw new ModelContractViolation("invalid-contract");
	}
}

/** Compatibility validator: an omitted limit is not evidence of an effective cap. */
export function assertModelContract(contract: ModelContract, request: RouteRequest): void {
	validateContract(contract);
	if (
		!isRecord(request) ||
		!isIdentity(request.model) ||
		!isIdentifier(request.provider) ||
		typeof request.thinking !== "boolean" ||
		(request.authOrigin !== undefined && !isIdentifier(request.authOrigin)) ||
		(request.thinkingLevel !== undefined &&
			(!LEVELS.includes(request.thinkingLevel) || (request.thinkingLevel !== "off") !== request.thinking))
	) {
		throw new ModelContractViolation("invalid-request");
	}
	if (
		request.maxOutputTokens !== undefined &&
		(!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)
	) {
		throw new ModelContractViolation("invalid-request-limit");
	}
	if (request.provider !== request.model.provider) throw new ModelContractViolation("provider-mismatch");
	if (!contract.allowedProviders.includes(request.provider)) throw new ModelContractViolation("provider-not-allowed");
	if (!contract.allowedModels.some((entry) => entry.provider === request.provider && entry.id === request.model.id)) {
		throw new ModelContractViolation("model-not-allowed");
	}
	if (!contract.allowedAuthOrigins.includes(request.authOrigin ?? request.provider)) {
		throw new ModelContractViolation("auth-origin-not-allowed");
	}
	if (request.thinking && !contract.thinking) throw new ModelContractViolation("thinking-not-allowed");
	const effectiveLevel = request.thinkingLevel ?? "off";
	if (contract.thinkingLevel !== undefined && contract.thinkingLevel !== effectiveLevel) {
		throw new ModelContractViolation("thinking-level-mismatch");
	}
	if (request.maxOutputTokens !== undefined && request.maxOutputTokens > contract.maxOutputTokens) {
		throw new ModelContractViolation("output-limit-exceeded");
	}
}

/** Copy only policy fields, never full model metadata or credential-bearing headers. */
export function snapshotModelContract(contract: unknown): ModelContract {
	validateContract(contract);
	return createImmutableSnapshot({
		allowedModels: contract.allowedModels.map(({ provider, id }) => ({ provider, id })),
		allowedProviders: [...contract.allowedProviders],
		allowedAuthOrigins: [...contract.allowedAuthOrigins],
		thinking: contract.thinking,
		maxOutputTokens: contract.maxOutputTokens,
		...(contract.thinkingLevel === undefined ? {} : { thinkingLevel: contract.thinkingLevel }),
	});
}
