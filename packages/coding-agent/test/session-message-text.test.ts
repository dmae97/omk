import { describe, expect, it } from "vitest";
import { extractUserMessageText } from "../src/core/session-message-text.ts";

describe("extractUserMessageText", () => {
	it("returns a string unchanged", () => {
		expect(extractUserMessageText("hello")).toBe("hello");
		expect(extractUserMessageText("")).toBe("");
	});

	it("joins text parts with no separator", () => {
		expect(
			extractUserMessageText([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
		).toBe("ab");
	});

	it("skips non-text parts", () => {
		expect(
			extractUserMessageText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]),
		).toBe("ab");
	});

	it("skips text parts with no text field", () => {
		expect(extractUserMessageText([{ type: "text", text: "a" }, { type: "text" }, { type: "text", text: "b" }])).toBe(
			"ab",
		);
	});

	it("returns an empty string for an empty array", () => {
		expect(extractUserMessageText([])).toBe("");
	});
});
