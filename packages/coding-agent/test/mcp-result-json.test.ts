import { describe, expect, it } from "vitest";
import { validateMcpCallResult } from "../src/core/mcp/result-contract.ts";

describe("Pi 1.2 MCP structuredContent JSON values", () => {
	it.each(
		[null, false, 7, "value", [], [1, { nested: true }], { nested: [null, "text"] }].map((structuredContent) => ({
			structuredContent,
		})),
	)("preserves JSON value $structuredContent", ({ structuredContent }) => {
		expect(validateMcpCallResult({ content: [], structuredContent }).structuredContent).toEqual(structuredContent);
	});
	it.each([Number.NaN, Number.POSITIVE_INFINITY, () => {}, { nested: undefined }])(
		"rejects non-JSON structured content",
		(structuredContent) => {
			expect(() => validateMcpCallResult({ content: [], structuredContent })).toThrow("mcp.invalid_tool_result");
		},
	);
});
