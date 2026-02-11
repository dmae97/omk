import { describe, expect, test } from "bun:test";
import {
	applyHashlineEdits,
	computeLineHash,
	formatHashLines,
	type HashlineEdit,
	HashlineMismatchError,
	parseLineRef,
	streamHashLinesFromLines,
	streamHashLinesFromUtf8,
	validateLineRef,
} from "@oh-my-pi/pi-coding-agent/patch";

// ═══════════════════════════════════════════════════════════════════════════
// computeLineHash
// ═══════════════════════════════════════════════════════════════════════════

describe("computeLineHash", () => {
	test("returns 2-4 character alphanumeric hash string", () => {
		const hash = computeLineHash(1, "hello");
		expect(hash).toMatch(/^[0-9a-z]{2,4}$/);
	});

	test("same content at same line produces same hash", () => {
		const a = computeLineHash(1, "hello");
		const b = computeLineHash(1, "hello");
		expect(a).toBe(b);
	});

	test("different content produces different hash", () => {
		const a = computeLineHash(1, "hello");
		const b = computeLineHash(1, "world");
		expect(a).not.toBe(b);
	});

	test("empty line produces valid hash", () => {
		const hash = computeLineHash(1, "");
		expect(hash).toMatch(/^[0-9a-z]{2,4}$/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// formatHashLines
// ═══════════════════════════════════════════════════════════════════════════

describe("formatHashLines", () => {
	test("formats single line", () => {
		const result = formatHashLines("hello");
		const hash = computeLineHash(1, "hello");
		expect(result).toBe(`1:${hash}| hello`);
	});

	test("formats multiple lines with 1-indexed numbers", () => {
		const result = formatHashLines("foo\nbar\nbaz");
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toStartWith("1:");
		expect(lines[1]).toStartWith("2:");
		expect(lines[2]).toStartWith("3:");
	});

	test("respects custom startLine", () => {
		const result = formatHashLines("foo\nbar", 10);
		const lines = result.split("\n");
		expect(lines[0]).toStartWith("10:");
		expect(lines[1]).toStartWith("11:");
	});

	test("handles empty lines in content", () => {
		const result = formatHashLines("foo\n\nbar");
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[1]).toMatch(/^2:[0-9a-z]{2,4}\| $/);
	});

	test("round-trips with computeLineHash", () => {
		const content = "function hello() {\n  return 42;\n}";
		const formatted = formatHashLines(content);
		const lines = formatted.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(\d+):([0-9a-z]+)\| (.*)$/);
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

	test("streamHashLinesFromUtf8 matches formatHashLines", async () => {
		const content = "foo\nbar\nbaz";
		const streamed = await collectText(streamHashLinesFromUtf8(utf8Chunks(content, 2), { maxChunkLines: 1 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	test("streamHashLinesFromUtf8 handles empty content", async () => {
		const content = "";
		const streamed = await collectText(streamHashLinesFromUtf8(utf8Chunks(content, 2), { maxChunkLines: 1 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	test("streamHashLinesFromLines matches formatHashLines (including trailing newline)", async () => {
		const content = "foo\nbar\n";
		const lines = ["foo", "bar", ""]; // match `content.split("\\n")`
		const streamed = await collectText(streamHashLinesFromLines(lines, { maxChunkLines: 2 }));
		expect(streamed).toBe(formatHashLines(content));
	});

	test("chunking respects maxChunkLines", async () => {
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
// parseLineRef
// ═══════════════════════════════════════════════════════════════════════════

describe("parseLineRef", () => {
	test("parses valid reference", () => {
		const ref = parseLineRef("5:abcd");
		expect(ref).toEqual({ line: 5, hash: "abcd" });
	});

	test("parses single-digit hash", () => {
		const ref = parseLineRef("1:a");
		expect(ref).toEqual({ line: 1, hash: "a" });
	});

	test("parses long hash", () => {
		const ref = parseLineRef("100:abcdef0123456789");
		expect(ref).toEqual({ line: 100, hash: "abcdef0123456789" });
	});

	test("rejects missing colon", () => {
		expect(() => parseLineRef("5abcd")).toThrow(/Invalid line reference/);
	});

	test("rejects non-numeric line", () => {
		expect(() => parseLineRef("abc:1234")).toThrow(/Invalid line reference/);
	});

	test("rejects non-alphanumeric hash", () => {
		expect(() => parseLineRef("5:$$$$")).toThrow(/Invalid line reference/);
	});

	test("rejects line number 0", () => {
		expect(() => parseLineRef("0:abcd")).toThrow(/Line number must be >= 1/);
	});

	test("rejects empty string", () => {
		expect(() => parseLineRef("")).toThrow(/Invalid line reference/);
	});

	test("rejects empty hash", () => {
		expect(() => parseLineRef("5:")).toThrow(/Invalid line reference/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// validateLineRef
// ═══════════════════════════════════════════════════════════════════════════

describe("validateLineRef", () => {
	test("accepts valid ref with matching hash", () => {
		const lines = ["hello", "world"];
		const hash = computeLineHash(1, "hello");
		expect(() => validateLineRef({ line: 1, hash }, lines)).not.toThrow();
	});

	test("rejects line out of range (too high)", () => {
		const lines = ["hello"];
		const hash = computeLineHash(1, "hello");
		expect(() => validateLineRef({ line: 2, hash }, lines)).toThrow(/does not exist/);
	});

	test("rejects line out of range (zero)", () => {
		const lines = ["hello"];
		expect(() => validateLineRef({ line: 0, hash: "aaaa" }, lines)).toThrow(/does not exist/);
	});

	test("rejects mismatched hash", () => {
		const lines = ["hello", "world"];
		expect(() => validateLineRef({ line: 1, hash: "0000" }, lines)).toThrow(/has changed since last read/);
	});

	test("validates last line correctly", () => {
		const lines = ["a", "b", "c"];
		const hash = computeLineHash(3, "c");
		expect(() => validateLineRef({ line: 3, hash }, lines)).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — replace
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — replace", () => {
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("replaces single line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(2, "bbb"), content: "BBB" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("range replace (shrink)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ replaceLines: { start: makeRef(2, "bbb"), end: makeRef(3, "ccc"), content: "ONE" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nONE\nddd");
	});

	test("range replace (same count)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ replaceLines: { start: makeRef(2, "bbb"), end: makeRef(3, "ccc"), content: "XXX\nYYY" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nXXX\nYYY\nddd");
		expect(result.firstChangedLine).toBe(2);
	});

	test("replaces first line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(1, "first"), content: "FIRST" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("FIRST\nsecond\nthird");
		expect(result.firstChangedLine).toBe(1);
	});

	test("replaces last line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(3, "third"), content: "THIRD" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("first\nsecond\nTHIRD");
		expect(result.firstChangedLine).toBe(3);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — delete
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — delete", () => {
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("deletes single line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(2, "bbb"), content: "" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("deletes range of lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ replaceLines: { start: makeRef(2, "bbb"), end: makeRef(3, "ccc"), content: "" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nddd");
	});

	test("deletes first line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(1, "aaa"), content: "" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("bbb\nccc");
	});

	test("deletes last line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: makeRef(3, "ccc"), content: "" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — insert
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — insert", () => {
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("inserts after a line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(1, "aaa"), content: "NEW" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("inserts multiple lines", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(1, "aaa"), content: "x\ny\nz" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb");
	});

	test("inserts after last line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(2, "bbb"), content: "NEW" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW");
	});

	test("insert with empty dst throws", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(1, "aaa"), content: "" } }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — heuristics
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — heuristics", () => {
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("strips insert-after anchor echo", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(2, "bbb"), content: "bbb\nNEW" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW\nccc");
	});

	test("strips range boundary echo and preserves whitespace on unchanged lines", () => {
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
				replaceLines: {
					start: makeRef(start, "if (cond) {"),
					end: makeRef(end, "}"),
					// Echoes line after the range ("after();") and also reformats the import line.
					content: ["if (cond) {", "  doA();", "} else {", "  doB();", "}", "after();"].join("\n"),
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		// Should not duplicate the trailing boundary line.
		expect(result.content.split("\n")).toHaveLength(7);
		expect(result.content).toBe(content);
	});

	test("preserves whitespace for unchanged lines even when range counts mismatch", () => {
		const content = ["import { foo } from 'x';", "import { bar } from 'y';", "const x = 1;"].join("\n");

		const edits: HashlineEdit[] = [
			{
				replaceLines: {
					start: makeRef(1, "import { foo } from 'x';"),
					end: makeRef(2, "import { bar } from 'y';"),
					content: ["import {foo} from 'x';", "import { bar } from 'y';", "// added"].join("\n"),
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		const outLines = result.content.split("\n");
		expect(outLines[0]).toBe("import { foo } from 'x';");
		expect(outLines[1]).toBe("import { bar } from 'y';");
		expect(outLines[2]).toBe("// added");
		expect(outLines[3]).toBe("const x = 1;");
	});

	test("restores a long wrapped line when model reflows it across many lines", () => {
		const longLine =
			"const options = veryLongIdentifier + anotherLongIdentifier + thirdLongIdentifier + fourthLongIdentifier;";
		const content = ["before();", longLine, "after();"].join("\n");
		const edits: HashlineEdit[] = [
			{
				replaceLine: {
					loc: makeRef(2, longLine),
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
					].join("\n"),
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe(content);
	});

	test("repairs single-line replacement that absorbed the next line (prevents duplication)", () => {
		const content = ["    typeof HOOK === 'undefined' &&", "    typeof HOOK.checkDCE !== 'function'", "tail();"].join(
			"\n",
		);

		const edits: HashlineEdit[] = [
			{
				replaceLine: {
					loc: makeRef(1, "    typeof HOOK === 'undefined' &&"),
					// Model merged both lines into one and dropped indentation.
					content: "typeof HOOK === 'undefined' || typeof HOOK.checkDCE !== 'function'",
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe(
			["    typeof HOOK === 'undefined' || typeof HOOK.checkDCE !== 'function'", "tail();"].join("\n"),
		);
	});

	test("repairs single-line replacement that absorbed the previous line (prevents duplication)", () => {
		const content = [
			"  const nativeStyleResolver: ResolveNativeStyle | void =",
			"    resolveRNStyle || hook.resolveRNStyle;",
			"  after();",
		].join("\n");

		const edits: HashlineEdit[] = [
			{
				replaceLine: {
					loc: makeRef(2, "    resolveRNStyle || hook.resolveRNStyle;"),
					// Model absorbed the declaration line and dropped indentation.
					content: "const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;",
				},
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

	test("accepts polluted src that starts with LINE:HASH but includes trailing content", () => {
		const content = "aaa\nbbb\nccc";
		const srcHash = computeLineHash(2, "bbb");
		const edits: HashlineEdit[] = [
			{
				replaceLine: {
					loc: `2:${srcHash}export function foo(a, b) {}`, // comma in trailing content
					content: "BBB",
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("treats same-line ranges as single-line replacements", () => {
		const content = "aaa\nbbb\nccc";
		const good = makeRef(2, "bbb");
		const edits: HashlineEdit[] = [{ replaceLines: { start: good, end: "2:00", content: "BBB" } }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("normalizes unicode-confusable hyphens when an edit would otherwise be a no-op", () => {
		const content = "aaa\ndevtools–unsupported-bridge-protocol\nccc";
		// dst is byte-identical to original (en-dash), so this would normally be a no-op.
		const edits: HashlineEdit[] = [
			{
				replaceLine: {
					loc: makeRef(2, "devtools–unsupported-bridge-protocol"),
					content: "devtools–unsupported-bridge-protocol",
				},
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\ndevtools-unsupported-bridge-protocol\nccc");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyHashlineEdits — multiple edits
// ═══════════════════════════════════════════════════════════════════════════

describe("applyHashlineEdits — multiple edits", () => {
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("applies two non-overlapping replaces (bottom-up safe)", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ replaceLine: { loc: makeRef(2, "bbb"), content: "BBB" } },
			{ replaceLine: { loc: makeRef(4, "ddd"), content: "DDD" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc\nDDD\neee");
		expect(result.firstChangedLine).toBe(2);
	});

	test("applies replace + delete in one call", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ replaceLine: { loc: makeRef(2, "bbb"), content: "BBB" } },
			{ replaceLine: { loc: makeRef(4, "ddd"), content: "" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("applies replace + insert in one call", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ replaceLine: { loc: makeRef(3, "ccc"), content: "CCC" } },
			{ insertAfter: { loc: makeRef(1, "aaa"), content: "INSERTED" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nINSERTED\nbbb\nCCC");
	});

	test("applies non-overlapping edits against original anchors when line counts change", () => {
		const content = "one\ntwo\nthree\nfour\nfive\nsix";
		const edits: HashlineEdit[] = [
			{ replaceLines: { start: makeRef(2, "two"), end: makeRef(3, "three"), content: "TWO_THREE" } },
			{ replaceLine: { loc: makeRef(6, "six"), content: "SIX" } },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("one\nTWO_THREE\nfour\nfive\nSIX");
	});

	test("empty edits array is a no-op", () => {
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
	function makeRef(lineNum: number, content: string): string {
		return `${lineNum}:${computeLineHash(lineNum, content)}`;
	}

	test("rejects stale hash", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: "2:00", content: "BBB" } }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	test("stale hash error shows >>> markers with correct hashes", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: "2:00", content: "BBB" } }];

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
			expect(msg).toContain(`2:${correctHash}| bbb`);
			// Context lines should NOT have >>> markers
			const lines = msg.split("\n");
			const contextLines = lines.filter(l => l.startsWith("    ") && l.includes("|"));
			expect(contextLines.length).toBeGreaterThan(0);
		}
	});

	test("stale hash error collects all mismatches", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ replaceLine: { loc: "2:00", content: "BBB" } },
			{ replaceLine: { loc: "4:00", content: "DDD" } },
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

	test("relocates stale line refs when hash uniquely identifies a moved line", () => {
		const content = "aaa\nbbb\nccc";
		const staleButUnique = `2:${computeLineHash(1, "ccc")}`;
		const edits: HashlineEdit[] = [{ replaceLine: { loc: staleButUnique, content: "CCC" } }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nCCC");
	});

	test("does not relocate when expected hash is non-unique", () => {
		const content = "dup\nmid\ndup";
		const staleDuplicate = `2:${computeLineHash(1, "dup")}`;
		const edits: HashlineEdit[] = [{ replaceLine: { loc: staleDuplicate, content: "DUP" } }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	test("rejects out-of-range line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ replaceLine: { loc: "10:aa", content: "X" } }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/does not exist/);
	});

	test("rejects range with start > end", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ replaceLines: { start: makeRef(5, "eee"), end: makeRef(2, "bbb"), content: "X" } },
		];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	test("rejects insert-after with empty dst", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ insertAfter: { loc: makeRef(1, "aaa"), content: "" } }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});
});
