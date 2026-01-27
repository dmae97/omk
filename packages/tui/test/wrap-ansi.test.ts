import { describe, expect, it } from "bun:test";
import { visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui/utils";

describe("wrapTextWithAnsi", () => {
	describe("underline styling", () => {
		it("should not apply underline style before the styled text", () => {
			const underlineOn = "\x1b[4m";
			const underlineOff = "\x1b[24m";
			const url = "https://example.com/very/long/path/that/will/wrap";
			const text = `read this thread ${underlineOn}${url}${underlineOff}`;

			const wrapped = wrapTextWithAnsi(text, 40);

			const prefix = "read this thread ";
			expect(wrapped[0].startsWith(prefix)).toBe(true);
			const underlineIndex = wrapped[0].indexOf(underlineOn);
			if (underlineIndex !== -1) {
				expect(underlineIndex).toBeGreaterThanOrEqual(prefix.length);
				expect(wrapped[0].endsWith(underlineOff)).toBe(true);
			}

			// Second line should start with underline
			expect(wrapped[1].startsWith(underlineOn)).toBe(true);

			const plain = wrapped.join("").replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain.includes(url)).toBe(true);
		});

		it("should preserve whitespace before underline reset code", () => {
			const underlineOn = "\x1b[4m";
			const underlineOff = "\x1b[24m";
			const textWithUnderlinedTrailingSpace = `${underlineOn}underlined text here ${underlineOff}more`;

			const wrapped = wrapTextWithAnsi(textWithUnderlinedTrailingSpace, 18);

			expect(wrapped[1].includes(` ${underlineOff}`)).toBe(true);
		});

		it("should not bleed underline to padding - each line should end with reset for underline only", () => {
			const underlineOn = "\x1b[4m";
			const underlineOff = "\x1b[24m";
			const url = "https://example.com/very/long/path/that/will/definitely/wrap";
			const text = `prefix ${underlineOn}${url}${underlineOff} suffix`;

			const wrapped = wrapTextWithAnsi(text, 30);

			// Middle lines (with underlined content) should end with underline-off, not full reset
			// Line 1 and 2 contain underlined URL parts
			for (let i = 1; i < wrapped.length - 1; i++) {
				const line = wrapped[i];
				if (line.includes(underlineOn)) {
					// Should end with underline off, NOT full reset
					expect(line.endsWith(underlineOff)).toBe(true);
					expect(line.endsWith("\x1b[0m")).toBe(false);
				}
			}
		});
	});

	describe("background color preservation", () => {
		it("should preserve background color across wrapped lines without full reset", () => {
			const bgBlue = "\x1b[44m";
			const reset = "\x1b[0m";
			const text = `${bgBlue}hello world this is blue background text${reset}`;

			const wrapped = wrapTextWithAnsi(text, 15);

			// Each line should have background color
			for (const line of wrapped) {
				expect(line.includes(bgBlue)).toBeTruthy();
			}

			// Middle lines should NOT end with full reset (kills background for padding)
			for (let i = 0; i < wrapped.length - 1; i++) {
				expect(wrapped[i].endsWith("\x1b[0m")).toBe(false);
			}
		});

		it("should reset underline without preserving background after wrap", () => {
			const underlineOn = "\x1b[4m";
			const underlineOff = "\x1b[24m";
			const reset = "\x1b[0m";

			const text = `\x1b[41mprefix ${underlineOn}UNDERLINED_CONTENT_THAT_WRAPS${underlineOff} suffix${reset}`;

			const wrapped = wrapTextWithAnsi(text, 20);

			const lineHasBg = (line: string) => line.includes("[41m") || line.includes(";41m") || line.includes("[41;");

			expect(lineHasBg(wrapped[0])).toBeTruthy();
			expect(lineHasBg(wrapped[1])).toBeFalsy();
			expect(lineHasBg(wrapped[2])).toBeFalsy();

			// Lines with underlined content should use underline-off at end, not full reset
			for (let i = 0; i < wrapped.length - 1; i++) {
				const line = wrapped[i];
				// If this line has underline on, it should end with underline off (not full reset)
				if (
					(line.includes("[4m") || line.includes("[4;") || line.includes(";4m")) &&
					!line.includes(underlineOff)
				) {
					expect(line.endsWith(underlineOff)).toBe(true);
					expect(line.endsWith("\x1b[0m")).toBe(false);
				}
			}
		});
	});

	describe("basic wrapping", () => {
		it("should wrap plain text correctly", () => {
			const text = "hello world this is a test";
			const wrapped = wrapTextWithAnsi(text, 10);

			expect(wrapped.length > 1).toBeTruthy();
			for (const line of wrapped) {
				expect(visibleWidth(line) <= 10).toBeTruthy();
			}
		});

		it("should truncate trailing whitespace that exceeds width", () => {
			const twoSpacesWrappedToWidth1 = wrapTextWithAnsi("  ", 1);
			expect(visibleWidth(twoSpacesWrappedToWidth1[0]) <= 1).toBeTruthy();
		});

		it("should preserve color codes across wraps", () => {
			const red = "\x1b[31m";
			const reset = "\x1b[0m";
			const text = `${red}hello world this is red${reset}`;

			const wrapped = wrapTextWithAnsi(text, 10);

			// Each continuation line should start with red code
			for (let i = 1; i < wrapped.length; i++) {
				expect(wrapped[i].startsWith(red)).toBe(true);
			}

			// Middle lines should not end with full reset
			for (let i = 0; i < wrapped.length - 1; i++) {
				expect(wrapped[i].endsWith("\x1b[0m")).toBe(false);
			}
		});
	});
});
