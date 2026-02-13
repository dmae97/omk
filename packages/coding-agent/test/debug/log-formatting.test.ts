import { describe, expect, it } from "bun:test";
import { formatDebugLogLine } from "../../src/debug/log-formatting";

describe("formatDebugLogLine", () => {
	it("strips ANSI codes and carriage returns", () => {
		const input = "\u001b[31merror\r\u001b[0m";
		const result = formatDebugLogLine(input, 80);
		expect(result).toBe("error");
	});

	it("replaces tabs with spaces", () => {
		const input = "col1\tcol2";
		const result = formatDebugLogLine(input, 80);
		expect(result).toBe("col1   col2");
	});

	it("removes unsafe control characters", () => {
		const input = "ok\u0007bad";
		const result = formatDebugLogLine(input, 80);
		expect(result).toBe("okbad");
	});

	it("truncates long lines", () => {
		const input = "0123456789ABCDEFGHIJ";
		const result = formatDebugLogLine(input, 10);
		expect(Bun.stringWidth(result)).toBeLessThanOrEqual(10);
		expect(result.startsWith("012345")).toBe(true);
	});
});
