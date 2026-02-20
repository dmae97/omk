import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	applyHashlineEdits,
	computeLineHash,
	formatHashLines,
	HashlineMismatchError,
	parseTag,
	streamHashLinesFromLines,
	streamHashLinesFromUtf8,
	validateLineRef,
} from "@oh-my-pi/pi-coding-agent/patch";
import { formatLineTag, type HashlineEdit, type LineTag } from "@oh-my-pi/pi-coding-agent/patch/hashline";

function makeTag(line: number, content: string): LineTag {
	return parseTag(formatLineTag(line, content));
}

// ═══════════════════════════════════════════════════════════════════════════
// computeLineHash
// ═══════════════════════════════════════════════════════════════════════════

describe("computeLineHash", () => {
	it("returns 2-4 character alphanumeric hash string", () => {
		const hash = computeLineHash(1, "hello");
		expect(hash).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/);
	});

	it("same content at same line produces same hash", () => {
		const a = computeLineHash(1, "hello");
		const b = computeLineHash(1, "hello");
		expect(a).toBe(b);
	});

	it("different content produces different hash", () => {
		const a = computeLineHash(1, "hello");
		const b = computeLineHash(1, "world");
		expect(a).not.toBe(b);
	});

	it("empty line produces valid hash", () => {
		const hash = computeLineHash(1, "");
		expect(hash).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// formatHashLines
// ═══════════════════════════════════════════════════════════════════════════

describe("formatHashLines", () => {
	it("formats single line", () => {
		const result = formatHashLines("hello");
		const hash = computeLineHash(1, "hello");
		expect(result).toBe(`1#${hash}:hello`);
	});

	it("formats multiple lines with 1-indexed numbers", () => {
		const result = formatHashLines("foo\nbar\nbaz");
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toStartWith("1#");
		expect(lines[1]).toStartWith("2#");
		expect(lines[2]).toStartWith("3#");
	});

	it("respects custom startLine", () => {
		const result = formatHashLines("foo\nbar", 10);
		const lines = result.split("\n");
		expect(lines[0]).toStartWith("10#");
		expect(lines[1]).toStartWith("11#");
	});

	it("handles empty lines in content", () => {
		const result = formatHashLines("foo\n\nbar");
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[1]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:$/);
	});

	it("round-trips with computeLineHash", () => {
		const content = "function hello() {\n  return 42;\n}";
		const formatted = formatHashLines(content);
		const lines = formatted.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(\d+)#([ZPMQVRWSNKTXJBYH]{2}):(.*)$/);
			expect(match).not.toBeNull();
			const lineNum = Number.parseInt(match![1], 10);
			const hash = match![2];
			const lineContent = match![3];
			expect(computeLineHash(lineNum, lineContent)).toBe(hash);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// streamHashLinesFromUtf8 / streamHashLinesFromLines
// ═══════════════════════════════════════════════════════════════════════════

describe("streamHashLinesFrom*", () => {
	async function collectText(gen: AsyncIterable<string>): Promise<string> {
		const parts: string[] = [];
		for await (const part of gen) {
			parts.push(part);
		}
		return parts.join("\n");
	}

	async function* utf8Chunks(text: string, chunkSize: number): AsyncGenerator<Uint8Array> {
		const bytes = new TextEncoder().encode(text);
		for (let i = 0; i < bytes.length; i += chunkSize) {
			yield bytes.slice(i, i + chunkSize);
		}
	}

	it("streamHashLinesFromUtf8 matches formatHashLines", async () => {
		const content = "foo\nbar\nbaz";
		const streamed = await collectText(streamHashLinesFromUtf8(utf8Chunks(content, 2), { maxChunkLines: 1 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	it("streamHashLinesFromUtf8 handles empty content", async () => {
		const content = "";
		const streamed = await collectText(streamHashLinesFromUtf8(utf8Chunks(content, 2), { maxChunkLines: 1 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	it("streamHashLinesFromLines matches formatHashLines (including trailing newline)", async () => {
		const content = "foo\nbar\n";
		const lines = ["foo", "bar", ""]; // match `content.split("\\n")`
		const streamed = await collectText(streamHashLinesFromLines(lines, { maxChunkLines: 2 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	it("chunking respects maxChunkLines", async () => {
		const content = "a\nb\nc";
		const parts: string[] = [];
		for await (const part of streamHashLinesFromUtf8(utf8Chunks(content, 1), {
			maxChunkLines: 1,
			maxChunkBytes: 1024,
		})) {
			parts.push(part);
		}
		expect(parts).toHaveLength(3);
		expect(parts.join("\n")).toBe(formatHashLines(content));
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// parseTag
// ═══════════════════════════════════════════════════════════════════════════

describe("parseTag", () => {
	it("parses valid reference", () => {
		const ref = parseTag("5#QQ");
		expect(ref).toEqual({ line: 5, hash: "QQ" });
	});

	it("rejects single-character hash", () => {
		expect(() => parseTag("1#Q")).toThrow(/Invalid line reference/);
	});

	it("parses long hash by taking strict 2-char prefix", () => {
		const ref = parseTag("100#QQQQ");
		expect(ref).toEqual({ line: 100, hash: "QQ" });
	});

	it("rejects missing separator", () => {
		expect(() => parseTag("5QQ")).toThrow(/Invalid line reference/);
	});

	it("rejects non-numeric line", () => {
		expect(() => parseTag("abc#Q")).toThrow(/Invalid line reference/);
	});

	it("rejects non-alphanumeric hash", () => {
		expect(() => parseTag("5#$$$$")).toThrow(/Invalid line reference/);
	});

	it("rejects line number 0", () => {
		expect(() => parseTag("0#QQ")).toThrow(/Line number must be >= 1/);
	});

	it("rejects empty string", () => {
		expect(() => parseTag("")).toThrow(/Invalid line reference/);
	});

	it("rejects empty hash", () => {
		expect(() => parseTag("5#")).toThrow(/Invalid line reference/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// validateLineRef
// ═══════════════════════════════════════════════════════════════════════════

describe("validateLineRef", () => {
	it("accepts valid ref with matching hash", () => {
		const lines = ["hello", "world"];
		const hash = computeLineHash(1, "hello");
		expect(() => validateLineRef({ line: 1, hash }, lines)).not.toThrow();
	});

	it("rejects line out of range (too high)", () => {
		const lines = ["hello"];
		const hash = computeLineHash(1, "hello");
		expect(() => validateLineRef({ line: 2, hash }, lines)).toThrow(/does not exist/);
	});

	it("rejects line out of range (zero)", () => {
		const lines = ["hello"];
		expect(() => validateLineRef({ line: 0, hash: "aaaa" }, lines)).toThrow(/does not exist/);
	});

	it("rejects mismatched hash", () => {
		const lines = ["hello", "world"];
		expect(() => validateLineRef({ line: 1, hash: "0000" }, lines)).toThrow(/has changed since last read/);
	});

	it("validates last line correctly", () => {
		const lines = ["a", "b", "c"];
		const hash = computeLineHash(3, "c");
		expect(() => validateLineRef({ line: 3, hash }, lines)).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — replace
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — replace", () => {
	it("replaces single line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(2, "bbb"), content: ["BBB"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	it("range replace (shrink)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ op: "replace", first: makeTag(2, "bbb"), last: makeTag(3, "ccc"), content: ["ONE"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nONE\nddd");
	});

	it("range replace (same count)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ op: "replace", first: makeTag(2, "bbb"), last: makeTag(3, "ccc"), content: ["XXX", "YYY"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nXXX\nYYY\nddd");
		expect(result.firstChangedLine).toBe(2);
	});

	it("replaces first line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(1, "first"), content: ["FIRST"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("FIRST\nsecond\nthird");
		expect(result.firstChangedLine).toBe(1);
	});

	it("replaces last line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(3, "third"), content: ["THIRD"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("first\nsecond\nTHIRD");
		expect(result.firstChangedLine).toBe(3);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — delete
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — delete", () => {
	it("deletes single line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(2, "bbb"), content: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	it("deletes range of lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [{ op: "replace", first: makeTag(2, "bbb"), last: makeTag(3, "ccc"), content: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nddd");
	});

	it("deletes first line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(1, "aaa"), content: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("bbb\nccc");
	});

	it("deletes last line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "set", tag: makeTag(3, "ccc"), content: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — insert
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — insert", () => {
	it("inserts after a line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(1, "aaa"), content: ["NEW"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	it("inserts multiple lines", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(1, "aaa"), content: ["x", "y", "z"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb");
	});

	it("inserts after last line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(2, "bbb"), content: ["NEW"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW");
	});

	it("insert with empty dst throws", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(1, "aaa"), content: [] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("inserts at EOF without anchors", () => {
		const content = "aaa\nbbb";
		const edits = [{ op: "append", content: ["NEW"] }] as unknown as HashlineEdit[];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW");
		expect(result.firstChangedLine).toBe(3);
	});

	it("inserts at EOF into empty file without anchors", () => {
		const content = "";
		const edits = [{ op: "append", content: ["NEW"] }] as unknown as HashlineEdit[];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("NEW");
		expect(result.firstChangedLine).toBe(1);
	});

	it("insert at EOF with empty dst throws", () => {
		const content = "aaa\nbbb";
		const edits = [{ op: "append", content: [] }] as unknown as HashlineEdit[];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — insert (before)
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — insert (before)", () => {
	it("inserts before a line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(2, "bbb"), content: ["NEW"] }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	it("inserts multiple lines before", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(2, "bbb"), content: ["x", "y", "z"] }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb");
	});

	it("inserts before first line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(1, "aaa"), content: ["NEW"] }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("NEW\naaa\nbbb");
	});

	it("prepends at BOF without anchor", () => {
		const content = "aaa\nbbb";
		const edits = [{ op: "prepend", content: ["NEW"] }] as unknown as HashlineEdit[];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("NEW\naaa\nbbb");
		expect(result.firstChangedLine).toBe(1);
	});

	it("insert with before and empty text throws", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(1, "aaa"), content: [] }];
		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("strips anchor echo from end of inserted text (autocorrect)", () => {
		Bun.env.PI_HL_AUTOCORRECT = "1";
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(2, "bbb"), content: ["NEW", "bbb"] }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
	});
	Bun.env.PI_HL_AUTOCORRECT = undefined;

	it("insert before and insert after at same line produce correct order", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "prepend", before: makeTag(2, "bbb"), content: ["BEFORE"] },
			{ op: "append", after: makeTag(2, "bbb"), content: ["AFTER"] },
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBEFORE\nbbb\nAFTER\nccc");
	});

	it("insert before with set at same line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "prepend", before: makeTag(2, "bbb"), content: ["BEFORE"] },
			{ op: "set", tag: makeTag(2, "bbb"), content: ["BBB"] },
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBEFORE\nBBB\nccc");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — insert (between)
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — insert (between)", () => {
	it("inserts between adjacent anchors", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "insert", after: makeTag(1, "aaa"), before: makeTag(2, "bbb"), content: ["NEW"] },
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	it("inserts multiple lines between anchors", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{
				op: "insert",
				after: makeTag(1, "aaa"),
				before: makeTag(2, "bbb"),
				content: ["x", "y", "z"],
			},
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb\nccc");
	});

	it("strips boundary echo from both sides (autocorrect)", () => {
		Bun.env.PI_HL_AUTOCORRECT = "1";
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{
				op: "insert",
				after: makeTag(1, "aaa"),
				before: makeTag(2, "bbb"),
				content: ["aaa", "NEW", "bbb"],
			},
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
	});
	Bun.env.PI_HL_AUTOCORRECT = undefined;
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — heuristics
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — heuristics", () => {
	let origEnv: string | undefined;
	beforeAll(() => {
		origEnv = Bun.env.PI_HL_AUTOCORRECT;
		Bun.env.PI_HL_AUTOCORRECT = "1";
	});
	afterAll(() => {
		Bun.env.PI_HL_AUTOCORRECT = origEnv;
	});

	it("strips insert-after anchor echo", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(2, "bbb"), content: ["bbb", "NEW"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW\nccc");
	});

	it("strips range boundary echo and preserves whitespace on unchanged lines", () => {
		const content = [
			"import { foo } from 'x';",
			"if (cond) {",
			"  doA();",
			"} else {",
			"  doB();",
			"}",
			"after();",
		].join("\n");

		const start = 2;
		const end = 6;
		const edits: HashlineEdit[] = [
			{
				op: "replace",
				first: makeTag(start, "if (cond) {"),
				last: makeTag(end, "}"),
				// Echoes line after the range ("after();") and also reformats the import line.
				content: ["if (cond) {", "  doA();", "} else {", "  doB();", "}", "after();"],
			},
		];

		const result = applyHashlineEdits(content, edits);
		// Should not duplicate the trailing boundary line.
		expect(result.content.split("\n")).toHaveLength(7);
		expect(result.content).toBe(content);
	});

	it("does not override model whitespace choices in replacement content", () => {
		const content = ["import { foo } from 'x';", "import { bar } from 'y';", "const x = 1;"].join("\n");
		const edits: HashlineEdit[] = [
			{
				op: "replace",
				first: makeTag(1, "import { foo } from 'x';"),
				last: makeTag(2, "import { bar } from 'y';"),
				content: ["import {foo} from 'x';", "import { bar } from 'y';", "// added"],
			},
		];
		const result = applyHashlineEdits(content, edits);
		const outLines = result.content.split("\n");
		// Model's whitespace choice is respected -- no longer overridden
		expect(outLines[0]).toBe("import {foo} from 'x';");
		expect(outLines[1]).toBe("import { bar } from 'y';");
		expect(outLines[2]).toBe("// added");
		expect(outLines[3]).toBe("const x = 1;");
	});

	it("restores a long wrapped line when model reflows it across many lines", () => {
		const longLine =
			"const options = veryLongIdentifier + anotherLongIdentifier + thirdLongIdentifier + fourthLongIdentifier;";
		const content = ["before();", longLine, "after();"].join("\n");
		const edits: HashlineEdit[] = [
			{
				op: "set",
				tag: makeTag(2, longLine),
				content: [
					"const",
					"options",
					"=",
					"veryLongIdentifier",
					"+",
					"anotherLongIdentifier",
					"+",
					"thirdLongIdentifier",
					"+",
					"fourthLongIdentifier;",
				],
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe(content);
	});

	it("repairs single-line replacement that absorbed the next line (prevents duplication)", () => {
		const content = ["    typeof HOOK === 'undefined' &&", "    typeof HOOK.checkDCE !== 'function'", "tail();"].join(
			"\n",
		);

		const edits: HashlineEdit[] = [
			{
				op: "set",
				tag: makeTag(1, "    typeof HOOK === 'undefined' &&"),
				// Model merged both lines into one and dropped indentation.
				content: ["typeof HOOK === 'undefined' || typeof HOOK.checkDCE !== 'function'"],
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe(
			["    typeof HOOK === 'undefined' || typeof HOOK.checkDCE !== 'function'", "tail();"].join("\n"),
		);
	});

	it("repairs single-line replacement that absorbed the previous line (prevents duplication)", () => {
		const content = [
			"  const nativeStyleResolver: ResolveNativeStyle | void =",
			"    resolveRNStyle || hook.resolveRNStyle;",
			"  after();",
		].join("\n");

		const edits: HashlineEdit[] = [
			{
				op: "set",
				tag: makeTag(2, "    resolveRNStyle || hook.resolveRNStyle;"),
				// Model absorbed the declaration line and dropped indentation.
				content: ["const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;"],
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe(
			[
				"  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;",
				"  after();",
			].join("\n"),
		);
	});

	it("accepts polluted src that starts with LINE#ID but includes trailing content", () => {
		const content = "aaa\nbbb\nccc";
		const srcHash = computeLineHash(2, "bbb");
		const edits: HashlineEdit[] = [
			{
				op: "set",
				tag: parseTag(`2#${srcHash}export function foo(a, b) {}`), // comma in trailing content
				content: ["BBB"],
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	it("treats same-line ranges as single-line replacements", () => {
		const content = "aaa\nbbb\nccc";
		const good = makeTag(2, "bbb");
		const edits: HashlineEdit[] = [{ op: "replace", first: good, last: good, content: ["BBB"] }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — multiple edits
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — multiple edits", () => {
	it("applies two non-overlapping replaces (bottom-up safe)", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ op: "set", tag: makeTag(2, "bbb"), content: ["BBB"] },
			{ op: "set", tag: makeTag(4, "ddd"), content: ["DDD"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc\nDDD\neee");
		expect(result.firstChangedLine).toBe(2);
	});

	it("applies replace + delete in one call", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ op: "set", tag: makeTag(2, "bbb"), content: ["BBB"] },
			{ op: "set", tag: makeTag(4, "ddd"), content: [] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	it("applies replace + insert in one call", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "set", tag: makeTag(3, "ccc"), content: ["CCC"] },
			{ op: "append", after: makeTag(1, "aaa"), content: ["INSERTED"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nINSERTED\nbbb\nCCC");
	});

	it("applies non-overlapping edits against original anchors when line counts change", () => {
		const content = "one\ntwo\nthree\nfour\nfive\nsix";
		const edits: HashlineEdit[] = [
			{
				op: "replace",
				first: makeTag(2, "two"),
				last: makeTag(3, "three"),
				content: ["TWO_THREE"],
			},
			{ op: "set", tag: makeTag(6, "six"), content: ["SIX"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("one\nTWO_THREE\nfour\nfive\nSIX");
	});

	it("empty edits array is a no-op", () => {
		const content = "aaa\nbbb";
		const result = applyHashlineEdits(content, []);
		expect(result.content).toBe(content);
		expect(result.firstChangedLine).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — error cases
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — errors", () => {
	it("rejects stale hash", () => {
		const content = "aaa\nbbb\nccc";
		// Use a hash that doesn't match any line (avoid 00 — ccc hashes to 00)
		const edits: HashlineEdit[] = [{ op: "set", tag: parseTag("2#QQ"), content: ["BBB"] }];
		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	it("stale hash error shows >>> markers with correct hashes", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [{ op: "set", tag: parseTag("2#QQ"), content: ["BBB"] }];

		try {
			applyHashlineEdits(content, edits);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(HashlineMismatchError);
			const msg = (err as HashlineMismatchError).message;
			// Should contain >>> marker on the mismatched line
			expect(msg).toContain(">>>");
			// Should show the correct hash for line 2
			const correctHash = computeLineHash(2, "bbb");
			expect(msg).toContain(`2#${correctHash}:bbb`);
			// Context lines should NOT have >>> markers
			const lines = msg.split("\n");
			const contextLines = lines.filter(l => l.startsWith("    ") && !l.startsWith("    ...") && l.includes("#"));
			expect(contextLines.length).toBeGreaterThan(0);
		}
	});

	it("stale hash error collects all mismatches", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		// Use hashes that don't match any line (avoid 00 — ccc hashes to 00)
		const edits: HashlineEdit[] = [
			{ op: "set", tag: parseTag("2#ZZ"), content: ["BBB"] },
			{ op: "set", tag: parseTag("4#ZZ"), content: ["DDD"] },
		];

		try {
			applyHashlineEdits(content, edits);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(HashlineMismatchError);
			const e = err as HashlineMismatchError;
			expect(e.mismatches).toHaveLength(2);
			expect(e.mismatches[0].line).toBe(2);
			expect(e.mismatches[1].line).toBe(4);
			// Both lines should have >>> markers
			const markerLines = e.message.split("\n").filter(l => l.startsWith(">>>"));
			expect(markerLines).toHaveLength(2);
		}
	});

	it("does not relocate stale line refs even when hash uniquely matches another line", () => {
		const content = "aaa\nbbb\nccc";
		const staleButUnique = parseTag(`2#${computeLineHash(1, "ccc")}`);
		const edits: HashlineEdit[] = [{ op: "set", tag: staleButUnique, content: ["CCC"] }];
		try {
			applyHashlineEdits(content, edits);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(HashlineMismatchError);
			const e = err as HashlineMismatchError;
			expect(e.mismatches[0].line).toBe(2);
		}
	});

	it("does not relocate when expected hash is non-unique", () => {
		const content = "dup\nmid\ndup";
		const staleDuplicate = parseTag(`2#${computeLineHash(1, "dup")}`);
		const edits: HashlineEdit[] = [{ op: "set", tag: staleDuplicate, content: ["DUP"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	it("rejects out-of-range line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "set", tag: parseTag("10#ZZ"), content: ["X"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/does not exist/);
	});

	it("rejects range with start > end", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ op: "replace", first: makeTag(5, "eee"), last: makeTag(2, "bbb"), content: ["X"] },
		];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("rejects insert with after and empty text", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "append", after: makeTag(1, "aaa"), content: [] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("rejects insert with before and empty text", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ op: "prepend", before: makeTag(1, "aaa"), content: [] }];
		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("rejects insert with both anchors and empty text", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [
			{ op: "insert", after: makeTag(1, "aaa"), before: makeTag(2, "bbb"), content: [] },
		];
		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	it("inserts with non-adjacent anchors (before the 'before' anchor)", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "insert", after: makeTag(1, "aaa"), before: makeTag(3, "ccc"), content: ["NEW"] },
		];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW\nccc");
	});
	it("rejects insert with reversed anchors (before <= after)", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ op: "insert", after: makeTag(3, "ccc"), before: makeTag(1, "aaa"), content: ["NEW"] },
		];
		expect(() => applyHashlineEdits(content, edits)).toThrow(/after.*<.*before/);
	});
});
