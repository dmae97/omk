import {
	AccessDeniedException,
	InternalServerException,
	ModelStreamErrorException,
	ServiceUnavailableException,
	ThrottlingException,
	ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { formatBedrockError } from "../src/providers/bedrock-errors.ts";

describe("formatBedrockError", () => {
	// These prefixes are load-bearing: utils/overflow.ts matches them so
	// throttling/service errors are not mistaken for context overflow.
	it.each([
		{
			error: new ThrottlingException({ message: "Too many tokens", $metadata: {} }),
			expected: "Throttling error: Too many tokens",
		},
		{
			error: new ValidationException({ message: "Missing required parameter", $metadata: {} }),
			expected: "Validation error: Missing required parameter",
		},
		{
			error: new ServiceUnavailableException({ message: "Try again later", $metadata: {} }),
			expected: "Service unavailable: Try again later",
		},
		{
			error: new InternalServerException({ message: "Backend exploded", $metadata: {} }),
			expected: "Internal server error: Backend exploded",
		},
		{
			error: new ModelStreamErrorException({ message: "Stream reset", $metadata: {} }),
			expected: "Model stream error: Stream reset",
		},
	])("formats mapped exceptions with their fixed prefix: $expected", ({ error, expected }) => {
		expect(formatBedrockError(error)).toBe(expected);
	});

	it("falls back to the exception name for unmapped BedrockRuntimeServiceException names", () => {
		const error = new AccessDeniedException({ message: "Not authorized", $metadata: {} });
		expect(formatBedrockError(error)).toBe("AccessDeniedException: Not authorized");
	});

	it("returns the message unchanged for a plain Error", () => {
		expect(formatBedrockError(new Error("boom"))).toBe("boom");
	});

	it("JSON-stringifies non-Error values", () => {
		expect(formatBedrockError({ code: 1 })).toBe('{"code":1}');
	});
});
