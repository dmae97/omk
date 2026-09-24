import fc from "fast-check";
import { visibleWidth } from "omk-tui";
import { describe, expect, test } from "vitest";
import { singleLineDisplayText } from "../src/utils/display-text.ts";

/** Anything a terminal would interpret: C0/C1 controls, DEL, bidi marks/embeddings/overrides/isolates. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

describe("singleLineDisplayText", () => {
	const cases: readonly { name: string; input: string; expected: string }[] = [
		{ name: "OSC 52 clipboard write", input: "\x1b]52;c;ZXZpbA==\x07Retry", expected: "Retry" },
		{ name: "OSC 0 window title", input: "a\x1b]0;PWNED\x07b", expected: "ab" },
		{ name: "CSI clear screen", input: "\x1b[2Jnext", expected: "next" },
		{ name: "SGR colour", input: "\x1b[31mred\x1b[0m", expected: "red" },
		{ name: "8-bit CSI", input: "a\u009b31mb", expected: "ab" },
		{ name: "lone C1 control", input: "a\u009bb", expected: "ab" },
		{ name: "right-to-left override", input: "evil\u202ename", expected: "evilname" },
		{ name: "bidi isolates and marks", input: "\u2066a\u2069\u200fb\u061c", expected: "ab" },
		{ name: "cursor marker is neutralised", input: "a\x1b_pi:c\x07b", expected: "a_pi:cb" },
		{ name: "line breaks fold to one space", input: "line one\r\n\tline\u2028two", expected: "line one line two" },
		{ name: "whitespace collapses and trims", input: "  a   b  ", expected: "a b" },
		{
			name: "ZWJ emoji sequence survives",
			input: "\u{1F469}\u200d\u{1F4BB} dev",
			expected: "\u{1F469}\u200d\u{1F4BB} dev",
		},
		{
			name: "ZWNJ survives",
			input: "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645",
			expected: "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645",
		},
		{ name: "CJK passes through", input: "測試 한글", expected: "測試 한글" },
		{ name: "lone high surrogate becomes U+FFFD", input: "a\ud800b", expected: "a\ufffdb" },
		{ name: "lone low surrogate becomes U+FFFD", input: "\udc00", expected: "\ufffd" },
		{ name: "surrogate pair survives", input: "\ud83d\ude00 ok", expected: "\u{1F600} ok" },
	];

	test("a lone surrogate is counted as the one cell stdout will draw for it", () => {
		const out = singleLineDisplayText("x\ud800y");
		expect(visibleWidth(out)).toBe(3);
		expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
	});
	for (const { name, input, expected } of cases) {
		test(name, () => {
			expect(singleLineDisplayText(input)).toBe(expected);
		});
	}

	const hostile = fc.oneof(
		fc.string({ unit: "binary", maxLength: 40 }),
		fc.constantFrom(
			"\x1b]52;c;ZXZpbA==\x07",
			"\x1b[2J",
			"\x1b]8;;https://x\x1b\\",
			"\x1b_Gf=100;AAAA\x1b\\",
			"\u009b",
			"\u202e",
			"\n",
			"\u0085",
		),
		fc.integer({ min: 0xd800, max: 0xdfff }).map((unit) => String.fromCharCode(unit)),
	);
	const hostileText = fc.array(hostile, { maxLength: 8 }).map((parts) => parts.join(""));

	test("output never contains a terminal control, bidi mark, or line break", () => {
		fc.assert(
			fc.property(hostileText, (text) => {
				const out = singleLineDisplayText(text);
				expect(out).not.toMatch(UNSAFE);
				expect(out).not.toMatch(/[\r\n\u2028\u2029]/);
				expect(out).not.toMatch(/[\ud800-\udfff]/u);
				expect(out).toBe(out.trim());
			}),
			{ numRuns: 400 },
		);
	});

	test("is idempotent", () => {
		fc.assert(
			fc.property(hostileText, (text) => {
				const once = singleLineDisplayText(text);
				expect(singleLineDisplayText(once)).toBe(once);
			}),
			{ numRuns: 400 },
		);
	});

	test("leaves printable single-line text without runs of spaces unchanged", () => {
		const printable = fc
			.string({ unit: fc.constantFrom(..."abc XYZ 012 _-./:測한\u{1F600}"), maxLength: 30 })
			.map((text) => text.replace(/ +/g, " ").trim());
		fc.assert(
			fc.property(printable, (text) => {
				expect(singleLineDisplayText(text)).toBe(text);
			}),
			{ numRuns: 300 },
		);
	});
});
