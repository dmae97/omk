import { describe, expect, it } from "bun:test";
import { subprocessToolRegistry } from "../../src/task/subprocess-tool-registry";
import { parseReportFindingDetails } from "../../src/tools/review";

describe("report_finding subprocess extraction", () => {
	it("returns undefined for malformed finding details", () => {
		expect(parseReportFindingDetails({})).toBeUndefined();
		expect(
			parseReportFindingDetails({
				title: "[P1] Missing file path",
				body: "Body",
				priority: "P1",
				confidence: 0.8,
				line_start: 12,
				line_end: 12,
			}),
		).toBeUndefined();
	});

	it("ignores error events and extracts valid details", () => {
		const handler = subprocessToolRegistry.getHandler("report_finding");
		if (!handler?.extractData) {
			throw new Error("report_finding handler is not registered");
		}

		const validDetails = {
			title: "[P1] Example finding",
			body: "Details",
			priority: "P1" as const,
			confidence: 0.95,
			file_path: "/tmp/example.ts",
			line_start: 10,
			line_end: 12,
		};

		expect(
			handler.extractData({
				toolName: "report_finding",
				toolCallId: "call-1",
				result: {
					content: [{ type: "text", text: "Finding recorded" }],
					details: validDetails,
				},
				isError: false,
			}),
		).toEqual(validDetails);

		expect(
			handler.extractData({
				toolName: "report_finding",
				toolCallId: "call-2",
				result: {
					content: [{ type: "text", text: "Validation failed" }],
					details: {},
				},
				isError: true,
			}),
		).toBeUndefined();
	});
});
