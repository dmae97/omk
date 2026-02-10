import { describe, expect, test } from "bun:test";
import {
	applyHashlineEdits,
	computeLineHash,
	formatHashLines,
	type HashlineEdit,
	HashlineMismatchError,
	parseLineRef,
	validateLineRef,
} from "@oh-my-pi/pi-coding-agent/patch";

// ═══════════════════════════════════════════════════════════════════════════
// computeLineHash
// ═══════════════════════════════════════════════════════════════════════════

describe("computeLineHash", () => {
	test("returns 4-character hex string", () => {
		const hash = computeLineHash(1, "hello");
		expect(hash).toMatch(/^[0-9a-f]{2}$/);
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
		expect(hash).toMatch(/^[0-9a-f]{2}$/);
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
		expect(lines[1]).toMatch(/^2:[0-9a-f]{2}\| $/);
	});

	test("round-trips with computeLineHash", () => {
		const content = "function hello() {\n  return 42;\n}";
		const formatted = formatHashLines(content);
		const lines = formatted.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(\d+):([0-9a-f]+)\| (.*)$/);
			expect(match).not.toBeNull();
			const lineNum = Number.parseInt(match![1], 10);
			const hash = match![2];
			const lineContent = match![3];
			expect(computeLineHash(lineNum, lineContent)).toBe(hash);
		}
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

	test("rejects non-hex hash", () => {
		expect(() => parseLineRef("5:zzzz")).toThrow(/Invalid line reference/);
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
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(2, "bbb") }, dst: "BBB" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("range replace (shrink)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ src: { kind: "range", start: makeRef(2, "bbb"), end: makeRef(3, "ccc") }, dst: "ONE" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nONE\nddd");
	});

	test("range replace (same count)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ src: { kind: "range", start: makeRef(2, "bbb"), end: makeRef(3, "ccc") }, dst: "XXX\nYYY" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nXXX\nYYY\nddd");
		expect(result.firstChangedLine).toBe(2);
	});

	test("replaces first line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(1, "first") }, dst: "FIRST" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("FIRST\nsecond\nthird");
		expect(result.firstChangedLine).toBe(1);
	});

	test("replaces last line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(3, "third") }, dst: "THIRD" }];

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
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(2, "bbb") }, dst: "" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("deletes range of lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ src: { kind: "range", start: makeRef(2, "bbb"), end: makeRef(3, "ccc") }, dst: "" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nddd");
	});

	test("deletes first line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(1, "aaa") }, dst: "" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("bbb\nccc");
	});

	test("deletes last line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: makeRef(3, "ccc") }, dst: "" }];

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
		const edits: HashlineEdit[] = [{ src: { kind: "insertAfter", after: makeRef(1, "aaa") }, dst: "NEW" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("inserts multiple lines", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "insertAfter", after: makeRef(1, "aaa") }, dst: "x\ny\nz" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb");
	});

	test("inserts after last line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "insertAfter", after: makeRef(2, "bbb") }, dst: "NEW" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW");
	});

	test("insert with empty dst throws", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "insertAfter", after: makeRef(1, "aaa") }, dst: "" }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	test("inserts before a line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ src: { kind: "insertBefore", before: makeRef(2, "bbb") }, dst: "NEW" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("inserts before first line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "insertBefore", before: makeRef(1, "aaa") }, dst: "TOP" }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("TOP\naaa\nbbb");
		expect(result.firstChangedLine).toBe(1);
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
		const edits: HashlineEdit[] = [
			{
				src: { kind: "insertAfter", after: makeRef(2, "bbb") },
				dst: "bbb\nNEW",
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW\nccc");
	});

	test("strips insert-before anchor echo", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{
				src: { kind: "insertBefore", before: makeRef(2, "bbb") },
				dst: "NEW\nbbb",
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
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
				src: { kind: "range", start: makeRef(start, "if (cond) {"), end: makeRef(end, "}") },
				// Echoes line after the range ("after();") and also reformats the import line.
				dst: ["if (cond) {", "  doA();", "} else {", "  doB();", "}", "after();"].join("\n"),
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
				src: {
					kind: "range",
					start: makeRef(1, "import { foo } from 'x';"),
					end: makeRef(2, "import { bar } from 'y';"),
				},
				dst: ["import {foo} from 'x';", "import { bar } from 'y';", "// added"].join("\n"),
			},
		];

		const result = applyHashlineEdits(content, edits);
		const outLines = result.content.split("\n");
		expect(outLines[0]).toBe("import { foo } from 'x';");
		expect(outLines[1]).toBe("import { bar } from 'y';");
		expect(outLines[2]).toBe("// added");
		expect(outLines[3]).toBe("const x = 1;");
	});

	test("repairs single-line replacement that absorbed the next line (prevents duplication)", () => {
		const content = ["    typeof HOOK === 'undefined' &&", "    typeof HOOK.checkDCE !== 'function'", "tail();"].join(
			"\n",
		);

		const edits: HashlineEdit[] = [
			{
				src: { kind: "single", ref: makeRef(1, "    typeof HOOK === 'undefined' &&") },
				// Model merged both lines into one and dropped indentation.
				dst: "typeof HOOK === 'undefined' || typeof HOOK.checkDCE !== 'function'",
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
				src: { kind: "single", ref: makeRef(2, "    resolveRNStyle || hook.resolveRNStyle;") },
				// Model absorbed the declaration line and dropped indentation.
				dst: "const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;",
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
				src: { kind: "single", ref: `2:${srcHash}export function foo(a, b) {}` }, // comma in trailing content
				dst: "BBB",
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("treats same-line ranges as single-line replacements", () => {
		const content = "aaa\nbbb\nccc";
		const good = makeRef(2, "bbb");
		const edits: HashlineEdit[] = [{ src: { kind: "range", start: good, end: "2:00" }, dst: "BBB" }];
		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("supports substring src when it matches exactly one line", () => {
		const content = "aaa\ndevtools–unsupported-bridge-protocol\nccc";
		const edits: HashlineEdit[] = [
			{
				src: { kind: "substring", needle: "devtools–unsupported-bridge-protocol" },
				dst: "devtools-unsupported-bridge-protocol",
			},
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\ndevtools-unsupported-bridge-protocol\nccc");
	});

	test("normalizes unicode-confusable hyphens when an edit would otherwise be a no-op", () => {
		const content = "aaa\ndevtools–unsupported-bridge-protocol\nccc";
		// dst is byte-identical to original (en-dash), so this would normally be a no-op.
		const edits: HashlineEdit[] = [
			{
				src: { kind: "single", ref: makeRef(2, "devtools–unsupported-bridge-protocol") },
				dst: "devtools–unsupported-bridge-protocol",
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
			{ src: { kind: "single", ref: makeRef(2, "bbb") }, dst: "BBB" },
			{ src: { kind: "single", ref: makeRef(4, "ddd") }, dst: "DDD" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc\nDDD\neee");
		expect(result.firstChangedLine).toBe(2);
	});

	test("applies replace + delete in one call", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ src: { kind: "single", ref: makeRef(2, "bbb") }, dst: "BBB" },
			{ src: { kind: "single", ref: makeRef(4, "ddd") }, dst: "" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("applies replace + insert in one call", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ src: { kind: "single", ref: makeRef(3, "ccc") }, dst: "CCC" },
			{ src: { kind: "insertAfter", after: makeRef(1, "aaa") }, dst: "INSERTED" },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nINSERTED\nbbb\nCCC");
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
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: "2:00" }, dst: "BBB" }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	test("stale hash error shows >>> markers with correct hashes", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: "2:00" }, dst: "BBB" }];

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
			{ src: { kind: "single", ref: "2:00" }, dst: "BBB" },
			{ src: { kind: "single", ref: "4:00" }, dst: "DDD" },
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

	test("rejects out-of-range line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "single", ref: "10:aa" }, dst: "X" }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/does not exist/);
	});

	test("rejects substring src when not found", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "substring", needle: "garbage" }, dst: "X" }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/Substring src not found/);
	});

	test("rejects range with start > end", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [
			{ src: { kind: "range", start: makeRef(5, "eee"), end: makeRef(2, "bbb") }, dst: "X" },
		];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});

	test("rejects insert-after with empty dst", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ src: { kind: "insertAfter", after: makeRef(1, "aaa") }, dst: "" }];

		expect(() => applyHashlineEdits(content, edits)).toThrow();
	});
});
