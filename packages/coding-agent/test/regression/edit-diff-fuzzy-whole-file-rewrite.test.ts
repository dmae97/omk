// Regression test: when an edit only matches via the fuzzy/normalized fallback,
// the edit tool used to adopt the fuzzy-normalized WHOLE file as the write base.
// A single fuzzy-matched edit silently rewrote every line of the file (NFKC
// compatibility folds, smart quotes/dashes to ASCII, U+3000 to space, trailing
// whitespace stripped) and the displayed diff hid the rewrite because it was
// computed against the already-normalized base. The fix locates the match in
// normalized space but maps it back to offsets in the original content, so only
// the matched region changes.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "diff";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNormalizedContentMap, normalizeForFuzzyMatch } from "../../src/core/tools/edit-diff.ts";
import { createEditTool } from "../../src/index.ts";

const editTool = createEditTool(process.cwd());

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
}

describe("edit tool fuzzy matching does not rewrite the whole file", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `edit-diff-fuzzy-rewrite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// Lines that must keep their exact bytes after an unrelated fuzzy edit:
	// smart double quotes (U+201C/U+201D) + trailing whitespace, an em-dash
	// (U+2014), a U+3000 ideographic space, an NFKC-sensitive ligature (U+FB01)
	// and squared unit (U+33A1), and an NBSP (U+00A0).
	const untouchedHead =
		"const a = “smart quotes”;   \n" +
		"const b = 'em—dash — déjà vu';\n" +
		"const c = '全角　スペース';\n" +
		"const lig = 'ﬁle ㎡';\n";
	const untouchedTail = "tail line with nbsp  \n";

	it("keeps exact bytes outside the edited region and replaces the matched region (ascii-quote edit against smart-quote file)", async () => {
		const testFile = join(testDir, "fuzzy-preserve.txt");
		// The target line uses smart single quotes (U+2018/U+2019); the edit uses
		// ASCII quotes, so the exact match fails and the fuzzy fallback is used.
		const original = `${untouchedHead}console.log(‘hello’);\n${untouchedTail}`;
		writeFileSync(testFile, original);

		const result = await editTool.execute("regression-fuzzy-1", {
			path: testFile,
			edits: [{ oldText: "console.log('hello');\n", newText: "console.log('world');\n" }],
		});

		expect(getTextOutput(result)).toContain("Successfully replaced");
		const onDisk = readFileSync(testFile, "utf-8");
		// (2) The edited region was replaced correctly.
		expect(onDisk).toContain("console.log('world');\n");
		// (1) Every byte outside the edited region is preserved exactly.
		expect(onDisk).toBe(`${untouchedHead}console.log('world');\n${untouchedTail}`);
	});

	it("does not normalize untouched lines when the edit differs only by trailing whitespace", async () => {
		const testFile = join(testDir, "fuzzy-trailing-ws.txt");
		// "edited line" carries trailing spaces on disk; oldText omits them,
		// which forces the fuzzy path (this is the routine real-session trigger).
		const original = `${untouchedHead}edited line   \n${untouchedTail}`;
		writeFileSync(testFile, original);

		await editTool.execute("regression-fuzzy-2", {
			path: testFile,
			edits: [{ oldText: "edited line\n", newText: "replaced line\n" }],
		});

		expect(readFileSync(testFile, "utf-8")).toBe(`${untouchedHead}replaced line\n${untouchedTail}`);
	});

	it("returns a patch that applies cleanly to the ORIGINAL file content after a fuzzy edit", async () => {
		const testFile = join(testDir, "fuzzy-patch.txt");
		const original = `${untouchedHead}console.log(‘hello’);\n${untouchedTail}`;
		writeFileSync(testFile, original);

		const result = await editTool.execute("regression-fuzzy-3", {
			path: testFile,
			edits: [{ oldText: "console.log('hello');\n", newText: "console.log('world');\n" }],
		});

		// Before the fix the patch was computed against the normalized base, so
		// it silently encoded (and hid) a whole-file rewrite. It must now apply
		// to the original content and reproduce exactly what is on disk.
		const patch = (result.details as { patch: string }).patch;
		expect(applyPatch(original, patch)).toBe(readFileSync(testFile, "utf-8"));
	});

	it("supports multi-edit calls mixing exact and fuzzy matches without touching other lines", async () => {
		const testFile = join(testDir, "fuzzy-multi.txt");
		// En-dash (U+2013) in the file, ASCII hyphen in oldText -> fuzzy path.
		const original = `${untouchedHead}exact target\nrange: 1–5\n${untouchedTail}`;
		writeFileSync(testFile, original);

		await editTool.execute("regression-fuzzy-4", {
			path: testFile,
			edits: [
				{ oldText: "exact target\n", newText: "exact replaced\n" },
				{ oldText: "range: 1-5\n", newText: "range: 10-50\n" },
			],
		});

		expect(readFileSync(testFile, "utf-8")).toBe(`${untouchedHead}exact replaced\nrange: 10-50\n${untouchedTail}`);
	});

	it("keeps exact-match edits byte-for-byte identical to previous behavior", async () => {
		const testFile = join(testDir, "exact-unchanged.txt");
		// (3) Exact matches must not normalize anything and only splice the
		// matched region.
		const original = `${untouchedHead}const x = 'exact';\n${untouchedTail}`;
		writeFileSync(testFile, original);

		const result = await editTool.execute("regression-exact-1", {
			path: testFile,
			edits: [{ oldText: "const x = 'exact';", newText: "const x = 'changed';" }],
		});

		expect(getTextOutput(result)).toContain("Successfully replaced");
		expect(readFileSync(testFile, "utf-8")).toBe(`${untouchedHead}const x = 'changed';\n${untouchedTail}`);
	});

	it("still reports not-found and duplicate errors with fuzzy matching", async () => {
		const testFile = join(testDir, "errors.txt");
		writeFileSync(testFile, "hello world   \nhello world\n");

		await expect(
			editTool.execute("regression-errors-1", {
				path: testFile,
				edits: [{ oldText: "does not exist", newText: "x" }],
			}),
		).rejects.toThrow(/Could not find the exact text/);

		await expect(
			editTool.execute("regression-errors-2", {
				path: testFile,
				edits: [{ oldText: "hello world", newText: "x" }],
			}),
		).rejects.toThrow(/Found 2 occurrences/);
	});
});

describe("buildNormalizedContentMap", () => {
	it("produces output identical to normalizeForFuzzyMatch for tricky inputs", () => {
		const samples = [
			"",
			"\n",
			"plain ascii\n",
			"trailing spaces   \nand tabs\t\t\n",
			// Smart quotes, dashes, minus sign
			"“smart” ‘quotes’ — dashes – minus −\n",
			// NBSP and ideographic space, with trailing whitespace
			"nbsp and　ideographic space  \n",
			// Fullwidth forms
			"ＡＢＣ１２３ fullwidth\n",
			// Combining marks, including multiple marks that NFKC reorders
			"cafe\u0301 combining, multiple marks: a\u0301\u0327\n",
			// Compatibility ligatures, fractions, squared units
			"ligature ﬁ ﬂ, fraction ½, units ㎡ ™\n",
			// Decomposed Hangul jamo (compose under NFKC) and syllable + trailing jamo
			"\u1112\u1161\u11AB\u1100\u1173\u11AF\n\uAC00\u11A8\n",
			// Halfwidth katakana with (semi-)voiced sound marks (compose under NFKC)
			"\uFF76\uFF9E\uFF8A\uFF9F\n",
			// Astral characters and a combining mark after a surrogate pair
			"emoji \u{1F600}\u0301 ok\n",
			// Combining mark at start of string and immediately after a newline
			"\u0301leading mark\nx\n\u0301",
			"no final newline",
			"   \n　　\n", // whitespace-only lines
		];

		for (const sample of samples) {
			expect(buildNormalizedContentMap(sample).normalized).toBe(normalizeForFuzzyMatch(sample));
		}
	});

	it("maps normalized code units back to the original spans that produced them", () => {
		// U+FB01 expands to "fi" (both code units map to the one-char source span),
		// and the trailing whitespace before the newline is dropped from the map.
		const map = buildNormalizedContentMap("ﬁx  \ny");
		expect(map.normalized).toBe("fix\ny");
		expect(map.startOffsets).toEqual([0, 0, 1, 4, 5]);
		expect(map.endOffsets).toEqual([1, 1, 2, 5, 6]);
		expect(map.originalLength).toBe(6);
	});
});
