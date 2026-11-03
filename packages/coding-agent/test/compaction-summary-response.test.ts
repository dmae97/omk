import type { AssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { summaryTextOrThrow } from "../src/core/compaction/summary-response.ts";

function response(stopReason: string, content: unknown[], errorMessage?: string): AssistantMessage {
	return { role: "assistant", stopReason, content, errorMessage } as unknown as AssistantMessage;
}

const FAILURE = "Summarization failed";

describe("summaryTextOrThrow", () => {
	it("joins text parts with a newline and skips non-text parts", () => {
		const msg = response("stop", [
			{ type: "text", text: "first" },
			{ type: "thinking", thinking: "hidden" },
			{ type: "text", text: "second" },
		]);
		expect(summaryTextOrThrow(msg, FAILURE)).toBe("first\nsecond");
	});

	it("returns text when the stop reason is length", () => {
		expect(summaryTextOrThrow(response("length", [{ type: "text", text: "partial" }]), FAILURE)).toBe("partial");
	});

	it("throws an AbortError DOMException when aborted", () => {
		let caught: unknown;
		try {
			summaryTextOrThrow(response("aborted", [{ type: "text", text: "x" }]), FAILURE);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DOMException);
		expect((caught as DOMException).name).toBe("AbortError");
		expect((caught as DOMException).message).toBe(`${FAILURE}: aborted`);
	});

	it("throws the error message when the stop reason is error", () => {
		expect(() => summaryTextOrThrow(response("error", [], "rate limited"), FAILURE)).toThrow(
			`${FAILURE}: rate limited`,
		);
	});

	it("falls back to Unknown error when errorMessage is empty or missing", () => {
		expect(() => summaryTextOrThrow(response("error", [], ""), FAILURE)).toThrow(`${FAILURE}: Unknown error`);
		expect(() => summaryTextOrThrow(response("error", []), FAILURE)).toThrow(`${FAILURE}: Unknown error`);
	});

	it("rejects other stop reasons even when text is present", () => {
		expect(() => summaryTextOrThrow(response("toolUse", [{ type: "text", text: "summary" }]), FAILURE)).toThrow(
			`${FAILURE}: invalid summary stop reason`,
		);
	});

	it("reports the output limit when length produced only whitespace", () => {
		expect(() => summaryTextOrThrow(response("length", [{ type: "text", text: "  \n " }]), FAILURE)).toThrow(
			`${FAILURE}: the model reached its output limit before writing a summary`,
		);
	});

	it("reports an empty summary when stop produced no content", () => {
		expect(() => summaryTextOrThrow(response("stop", []), FAILURE)).toThrow(
			`${FAILURE}: the model returned an empty summary`,
		);
	});
});
