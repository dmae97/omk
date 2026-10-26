import { BedrockRuntimeServiceException } from "@aws-sdk/client-bedrock-runtime";

/** Prefixes preserve downstream retry and context-overflow matching. */
const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
	InternalServerException: "Internal server error",
	ModelStreamErrorException: "Model stream error",
	ValidationException: "Validation error",
	ThrottlingException: "Throttling error",
	ServiceUnavailableException: "Service unavailable",
};

/** Format errors from client.send and streaming SDK event items consistently. */
export function formatBedrockError(error: unknown): string {
	const message = error instanceof Error ? error.message : JSON.stringify(error);
	if (error instanceof BedrockRuntimeServiceException) {
		const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
		return `${prefix}: ${message}`;
	}
	return message;
}
