import assert from "node:assert";
import { describe, it } from "node:test";
import fc from "fast-check";
import { CURSOR_MARKER } from "../src/tui.ts";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";

// Property tests for the width contract the renderer enforces: TUI.render throws when
// visibleWidth(line) > terminal width, so truncateToWidth/wrapTextWithAnsi must stay within it.
// Free-text generators never emit C0/DEL/C1 controls: every ESC comes from the SGR codes or CURSOR_MARKER added here.

const NUM_RUNS = 250;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const codePoint = (min: number, max: number) => fc.integer({ min, max }).map((cp) => String.fromCodePoint(cp));

/** Any code point except C0/DEL/C1 controls and lone surrogates. */
const printableCodePoint = fc.oneof(codePoint(0x20, 0x7e), codePoint(0xa0, 0xd7ff), codePoint(0xe000, 0x10ffff));

/** Code points that join grapheme clusters or change their width (ZWJ, VS15/16, keycap, marks, Prepend,
 * virama, Thai AM, halfwidth voiced mark, Hangul jamo, regional indicators, skin tone, emoji bases). */
const clusterSensitive = fc.constantFrom(
	...Array.from("\u200d\ufe0e\ufe0f\u20e3\u0301\u0600\u0915\u094d\u0e33\uff9e\u1100\u1161\u11a8\u00ad\u200b#1"),
	...Array.from("\u{1f1fa}\u{1f1f8}\u{1f3fb}\u2764\u{1f44d}\u{1f468}"),
);

/** fast-check printable graphemes, including multi-code-point emoji and combining sequences. */
const grapheme = fc.string({ unit: "grapheme", minLength: 1, maxLength: 1 }).filter((g) => !/\p{Cc}/u.test(g));

const freeUnit = fc.oneof(printableCodePoint, clusterSensitive, grapheme);
const freeText = fc.string({ unit: freeUnit, maxLength: 80, size: "medium" });

/** Printable ASCII, CJK ideographs and Hangul syllables: every code point is its own grapheme cluster. */
const singleCodePointGrapheme = fc.oneof(
	codePoint(0x20, 0x7e),
	codePoint(0x4e00, 0x9fff),
	codePoint(0xac00, 0xd7a3),
	fc.constantFrom("測", "漢", "字", "한", "글"),
);
const restrictedText = fc.string({ unit: singleCodePointGrapheme, maxLength: 60, size: "medium" });

const sgr = fc.oneof(
	fc.constantFrom("\x1b[0m", "\x1b[1m", "\x1b[4m", "\x1b[24m", "\x1b[7m", "\x1b[31m", "\x1b[39m"),
	fc
		.tuple(fc.constantFrom(38, 48), fc.nat(255), fc.nat(255), fc.nat(255))
		.map(([k, r, g, b]) => `\x1b[${k};2;${r};${g};${b}m`),
	fc.tuple(fc.constantFrom(38, 48), fc.nat(255)).map(([k, n]) => `\x1b[${k};5;${n}m`),
);

/** Free text with SGR codes inserted only between grapheme clusters, never inside one. */
const styledText = fc.tuple(freeText, fc.array(fc.tuple(fc.nat(), sgr), { maxLength: 8 })).map(([text, inserts]) => {
	const clusters = Array.from(graphemes.segment(text), ({ segment }) => segment);
	const slots = new Array<string>(clusters.length + 1).fill("");
	for (const [at, code] of inserts) slots[at % slots.length] += code;
	return clusters.map((cluster, i) => slots[i] + cluster).join("") + slots[clusters.length];
});

/** Free text with SGR codes between any two code points, including inside a grapheme cluster. */
const clusterSplittingText = fc.string({ unit: fc.oneof(freeUnit, sgr), maxLength: 80, size: "medium" });

/** Restricted alphabet plus spaces and SGR codes; each code point is its own cluster, so SGR never splits one. */
const wrapText = fc.string({
	unit: fc.oneof(
		{ arbitrary: singleCodePointGrapheme, weight: 4 },
		{ arbitrary: fc.constant(" "), weight: 1 },
		{ arbitrary: sgr, weight: 1 },
	),
	maxLength: 160,
	size: "medium",
});

const ellipses = fc.constantFrom("...", "…", "", "~", "🙂");

/** Half of the runs use narrow widths so the truncating and wrapping paths are exercised. */
const narrowBiasedWidth = (min: number) => fc.oneof(fc.integer({ min, max: 12 }), fc.integer({ min, max: 120 }));

/** Visible text of a string whose only escape sequences are SGR codes. */
const stripSgr = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

/** ASCII is narrow, CJK ideographs and Hangul syllables are wide (UAX #11). */
const restrictedWidth = (text: string) => [...text].reduce((sum, ch) => sum + (ch.codePointAt(0)! <= 0x7e ? 1 : 2), 0);

function checkTruncation(text: string, maxWidth: number, ellipsis: string): void {
	const out = truncateToWidth(text, maxWidth, ellipsis);
	assert.ok(visibleWidth(out) <= maxWidth, `width ${visibleWidth(out)} > ${maxWidth}: ${JSON.stringify(out)}`);
	const visible = stripSgr(out);
	if (visibleWidth(text) <= maxWidth) {
		assert.strictEqual(visible, stripSgr(text), "fitting text must be unchanged");
	} else if (visibleWidth(ellipsis) >= maxWidth) {
		assert.ok(ellipsis.startsWith(visible), `only a clipped ellipsis fits: ${JSON.stringify(out)}`);
	} else {
		assert.ok(visible.endsWith(ellipsis), `ellipsis missing: ${JSON.stringify(out)}`);
		const kept = visible.slice(0, visible.length - ellipsis.length);
		assert.ok(stripSgr(text).startsWith(kept), `kept text is not a prefix: ${JSON.stringify(out)}`);
	}
}

describe("width invariants (property-based)", () => {
	it("W1: visibleWidth is a non-negative integer, at most 2 columns per code point", () => {
		fc.assert(
			fc.property(freeText, (text) => {
				const width = visibleWidth(text);
				assert.ok(Number.isInteger(width) && width >= 0, `width ${width}`);
				assert.ok(width <= 2 * [...text].length, `width ${width} for ${[...text].length} code points`);
			}),
			{
				numRuns: NUM_RUNS,
				examples: [
					[""],
					["\u200d"],
					["\u2764\ufe0f"],
					["\u{1f468}\u200d\u{1f469}\u200d\u{1f467}"],
					["\u{1f1fa}\u{1f1f8}"],
				],
			},
		);
	});

	it("W2: SGR codes are transparent to visibleWidth", () => {
		fc.assert(
			fc.property(freeText, sgr, (text, code) => {
				const width = visibleWidth(text);
				assert.strictEqual(visibleWidth(`\x1b[31m${text}\x1b[0m`), width);
				assert.strictEqual(visibleWidth(`\x1b[38;2;1;2;3m${text}\x1b[0m`), width);
				assert.strictEqual(visibleWidth(`${code}${text}\x1b[0m`), width);
			}),
			{
				numRuns: NUM_RUNS,
				examples: [
					["", "\x1b[0m"],
					["測漢字한글", "\x1b[38;5;196m"],
				],
			},
		);
	});

	it("W3: CURSOR_MARKER is zero-width", () => {
		fc.assert(
			fc.property(restrictedText, restrictedText, (a, b) => {
				assert.strictEqual(visibleWidth(a + CURSOR_MARKER + b), visibleWidth(a + b));
			}),
			{
				numRuns: NUM_RUNS,
				examples: [
					["測漢字", "한글"],
					["", ""],
				],
			},
		);
	});

	it("W4: visibleWidth is additive over single-code-point graphemes", () => {
		fc.assert(
			fc.property(restrictedText, restrictedText, (a, b) => {
				assert.strictEqual(visibleWidth(a + b), visibleWidth(a) + visibleWidth(b));
				assert.strictEqual(visibleWidth(a), restrictedWidth(a));
			}),
			{
				numRuns: NUM_RUNS,
				examples: [
					["測漢字", "한글"],
					["abc", ""],
				],
			},
		);
	});

	it(
		"W4b: a leading zero-width joiner adds no width",
		{ todo: 'known defect: ["\\u0e33"] -> visibleWidth("\\u200d\\u0e33") is 2, visibleWidth("\\u0e33") is 1' },
		() => {
			fc.assert(
				fc.property(freeText, (text) => {
					assert.strictEqual(visibleWidth(`\u200d${text}`), visibleWidth(text));
				}),
				{ numRuns: NUM_RUNS, examples: [["\u0e33"], ["\uff9e"]] },
			);
		},
	);

	it("W5: truncateToWidth stays within maxWidth and leaves fitting text unchanged", () => {
		fc.assert(fc.property(styledText, narrowBiasedWidth(1), ellipses, checkTruncation), {
			numRuns: NUM_RUNS,
			examples: [
				["", 1, "..."],
				["abcdef", 1, "🙂"],
				["abcdef", 2, "🙂"],
				["界", 2, "🙂"],
				[`\x1b[31m${"hello ".repeat(20)}\x1b[0m`, 20, "…"],
			],
		});
	});

	it(
		"W5b: truncateToWidth invariants hold when SGR splits a grapheme cluster",
		{ todo: 'known defect: ["\\u2764\\x1b[0m\\ufe0f", 1, ""] -> truncateToWidth returns its input, width 2 > 1' },
		() => {
			fc.assert(fc.property(clusterSplittingText, narrowBiasedWidth(1), ellipses, checkTruncation), {
				numRuns: NUM_RUNS,
				examples: [
					["\u2764\x1b[0m\ufe0f", 1, ""],
					["\u{1f1fa}\x1b[31m\u{1f1f8}", 3, "…"],
				],
			});
		},
	);

	it("W6: wrapTextWithAnsi lines fit the width and keep every non-space character", () => {
		const nonSpace = (text: string) => stripSgr(text).replaceAll(" ", "");
		fc.assert(
			fc.property(wrapText, narrowBiasedWidth(2), (text, width) => {
				const lines = wrapTextWithAnsi(text, width);
				for (const line of lines) {
					assert.ok(
						visibleWidth(line) <= width,
						`width ${visibleWidth(line)} > ${width}: ${JSON.stringify(line)}`,
					);
				}
				assert.strictEqual(nonSpace(lines.join("")), nonSpace(text));
			}),
			{
				numRuns: NUM_RUNS,
				examples: [
					["測漢字 한글 abc", 2],
					[`\x1b[4m${"a".repeat(30)} b\x1b[24m`, 7],
				],
			},
		);
	});
});
