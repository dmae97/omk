import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "../src/core/tools/truncate.ts";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { RollingTextTail } from "../src/modes/interactive/components/bash-output-tail.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const uiStub = {
	terminal: { columns: 200, rows: 24 },
	requestRender: () => {},
} as any;

const piece = fc.oneof(
	fc.constantFrom("\n", "\n\n", "a", "bc ", "한글", "漢字", "😀", "é", "x".repeat(37)),
	fc.string({ maxLength: 12 }),
	fc.integer({ min: 1, max: 400 }).map((n) => "L".repeat(n)),
);
const chunk = fc.array(piece, { maxLength: 12 }).map((parts) => parts.join(""));

describe("RollingTextTail", () => {
	it("truncateTail on the tail matches truncateTail on the full text (content and truncated flag)", () => {
		fc.assert(
			fc.property(
				fc.array(chunk, { maxLength: 80 }),
				fc.integer({ min: 8, max: 300 }),
				fc.integer({ min: 1, max: 40 }),
				(chunks, maxBytes, maxLines) => {
					const tail = new RollingTextTail(maxBytes * 2);
					let full = "";
					for (const text of chunks) {
						tail.append(text);
						full += text;
						const expected = truncateTail(full, { maxBytes, maxLines });
						const actual = truncateTail(tail.text, { maxBytes, maxLines });
						expect(actual.content).toBe(expected.content);
						expect(actual.truncated).toBe(expected.truncated);
					}
				},
			),
			{ numRuns: 1000 },
		);
	});

	it("stays bounded", () => {
		const tail = new RollingTextTail(100);
		for (let i = 0; i < 10_000; i++) tail.append(`line ${i}\n`);
		expect(tail.text.length).toBeLessThanOrEqual(200);
		expect(tail.text.length).toBeGreaterThanOrEqual(100);
		expect(tail.text.endsWith("line 9999\n")).toBe(true);
	});
});

describe("BashExecutionComponent streaming large output", () => {
	beforeAll(() => {
		initTheme("dark", false);
	});

	it("shows the same tail and hidden-line count as the full output and keeps getOutput exact", () => {
		const component = new BashExecutionComponent("yes", uiStub);
		let full = "";
		for (let i = 0; i < 3000; i++) {
			const text = `${"row".repeat(i % 7)} ${i}\r\n${i % 50 === 0 ? "x".repeat(900) : ""}`;
			component.appendOutput(text);
			full += text.replace(/\r\n/g, "\n");
		}
		component.setComplete(0, false, undefined, "/tmp/full-output.log");
		expect(component.getOutput()).toBe(full);

		const expected = truncateTail(full, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
		const expectedLines = expected.content.split("\n");
		const collapsed = component.render(200).join("\n");
		expect(collapsed).toContain(`... ${expectedLines.length - 20} more lines`);
		expect(collapsed).toContain("Output truncated. Full output: /tmp/full-output.log");
		expect(collapsed).toContain(expectedLines[expectedLines.length - 1]);

		component.setExpanded(true);
		const expanded = component.render(200).join("\n");
		expect(expanded).toContain(expectedLines[0]);
	});
});
