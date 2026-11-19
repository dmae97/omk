import { describe, expect, it } from "vitest";
import {
	isAsciiAlphaNumeric,
	isAsciiPunctuation,
	isCjkIdeograph,
	isEmojiOrWideSymbol,
	isHangul,
	isHiraganaOrKatakana,
	isUnicodeWhitespace,
} from "../src/core/text-char-classes.ts";

describe("isUnicodeWhitespace", () => {
	it("matches exactly what /\\s/u matches", () => {
		const codePoints = [
			0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
			0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x1c, 0x180e, 0x200b,
		];
		for (const codePoint of codePoints) {
			expect(isUnicodeWhitespace(codePoint)).toBe(/\s/u.test(String.fromCodePoint(codePoint)));
		}
	});
});

describe("isAsciiAlphaNumeric", () => {
	it("accepts digits and ASCII letters at their boundaries", () => {
		for (const codePoint of [0x30, 0x39, 0x41, 0x5a, 0x61, 0x7a]) {
			expect(isAsciiAlphaNumeric(codePoint)).toBe(true);
		}
	});

	it("rejects the characters just outside the alphanumeric ranges", () => {
		for (const codePoint of [0x2f, 0x3a, 0x40, 0x5b, 0x60, 0x7b]) {
			expect(isAsciiAlphaNumeric(codePoint)).toBe(false);
		}
	});
});

describe("isAsciiPunctuation", () => {
	it("pins only its two boundaries", () => {
		expect(isAsciiPunctuation(32)).toBe(false);
		expect(isAsciiPunctuation(33)).toBe(true);
		expect(isAsciiPunctuation(126)).toBe(true);
		expect(isAsciiPunctuation(127)).toBe(false);
	});
});

describe("isHangul", () => {
	it("accepts the first and last code point of each range", () => {
		for (const codePoint of [0xac00, 0xd7af, 0x1100, 0x11ff, 0x3130, 0x318f, 0xa960, 0xa97c]) {
			expect(isHangul(codePoint)).toBe(true);
		}
	});

	it("rejects the code points just outside each range", () => {
		for (const codePoint of [0xabff, 0xd7b0, 0x10ff, 0x1200, 0x312f, 0x3190, 0xa95f, 0xa97d]) {
			expect(isHangul(codePoint)).toBe(false);
		}
	});
});

describe("isHiraganaOrKatakana", () => {
	it("accepts the first and last code point of each range", () => {
		for (const codePoint of [0x3040, 0x309f, 0x30a0, 0x30ff, 0xff65, 0xff9f]) {
			expect(isHiraganaOrKatakana(codePoint)).toBe(true);
		}
	});

	it("accepts the adjacent values across the hiragana/katakana boundary", () => {
		expect(isHiraganaOrKatakana(0x309f)).toBe(true);
		expect(isHiraganaOrKatakana(0x30a0)).toBe(true);
	});

	it("rejects the code points just outside the accepted union", () => {
		for (const codePoint of [0x303f, 0x3100, 0xff64, 0xffa0]) {
			expect(isHiraganaOrKatakana(codePoint)).toBe(false);
		}
	});
});

describe("isCjkIdeograph", () => {
	it("accepts the first and last code point of each range", () => {
		for (const codePoint of [0x4e00, 0x9fff, 0x3400, 0x4dbf, 0xf900, 0xfaff]) {
			expect(isCjkIdeograph(codePoint)).toBe(true);
		}
	});

	it("rejects the code points just outside each range", () => {
		for (const codePoint of [0x4dff, 0xa000, 0x33ff, 0x4dc0, 0xf8ff, 0xfb00]) {
			expect(isCjkIdeograph(codePoint)).toBe(false);
		}
	});
});

describe("isEmojiOrWideSymbol", () => {
	it("accepts the lower bound of the unbounded emoji block", () => {
		expect(isEmojiOrWideSymbol(0x1efff)).toBe(false);
		expect(isEmojiOrWideSymbol(0x1f000)).toBe(true);
	});

	it("accepts the first and last code point of each bounded range", () => {
		for (const codePoint of [0x2600, 0x27bf, 0xff01, 0xff60, 0xffe0, 0xffe6]) {
			expect(isEmojiOrWideSymbol(codePoint)).toBe(true);
		}
	});

	it("rejects the code points just outside each bounded range", () => {
		for (const codePoint of [0x25ff, 0x27c0, 0xff00, 0xff61, 0xffdf, 0xffe7]) {
			expect(isEmojiOrWideSymbol(codePoint)).toBe(false);
		}
	});
});
