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

	test("same content at different line numbers produces different hash", () => {
		const a = computeLineHash(1, "hello");
		const b = computeLineHash(2, "hello");
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
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb")], new: ["BBB"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("replaces multiple consecutive lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb"), makeRef(3, "ccc")], new: ["XXX", "YYY"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nXXX\nYYY\nddd");
		expect(result.firstChangedLine).toBe(2);
	});

	test("replaces with different line count (expand)", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb")], new: ["line1", "line2", "line3"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nline1\nline2\nline3\nccc");
	});

	test("replaces with different line count (shrink)", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb"), makeRef(3, "ccc")], new: ["ONE"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nONE\nddd");
	});

	test("replaces first line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ old: [makeRef(1, "first")], new: ["FIRST"] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("FIRST\nsecond\nthird");
		expect(result.firstChangedLine).toBe(1);
	});

	test("replaces last line", () => {
		const content = "first\nsecond\nthird";
		const edits: HashlineEdit[] = [{ old: [makeRef(3, "third")], new: ["THIRD"] }];

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
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb")], new: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("deletes multiple consecutive lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [{ old: [makeRef(2, "bbb"), makeRef(3, "ccc")], new: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nddd");
	});

	test("deletes first line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ old: [makeRef(1, "aaa")], new: [] }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("bbb\nccc");
	});

	test("deletes last line", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [{ old: [makeRef(3, "ccc")], new: [] }];

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
		const edits: HashlineEdit[] = [{ old: [], new: ["NEW"], after: makeRef(1, "aaa") }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nNEW\nbbb\nccc");
		expect(result.firstChangedLine).toBe(2);
	});

	test("inserts multiple lines", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ old: [], new: ["x", "y", "z"], after: makeRef(1, "aaa") }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nx\ny\nz\nbbb");
	});

	test("inserts after last line", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ old: [], new: ["NEW"], after: makeRef(2, "bbb") }];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nbbb\nNEW");
	});

	test("insert without after ref throws", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ old: [], new: ["NEW"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/requires an 'after'/);
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
			{ old: [makeRef(2, "bbb")], new: ["BBB"] },
			{ old: [makeRef(4, "ddd")], new: ["DDD"] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc\nDDD\neee");
		expect(result.firstChangedLine).toBe(2);
	});

	test("applies replace + delete in one call", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [
			{ old: [makeRef(2, "bbb")], new: ["BBB"] },
			{ old: [makeRef(4, "ddd")], new: [] },
		];

		const result = applyHashlineEdits(content, edits);
		expect(result.content).toBe("aaa\nBBB\nccc");
	});

	test("applies replace + insert in one call", () => {
		const content = "aaa\nbbb\nccc";
		const edits: HashlineEdit[] = [
			{ old: [makeRef(3, "ccc")], new: ["CCC"] },
			{ old: [], new: ["INSERTED"], after: makeRef(1, "aaa") },
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
		const edits: HashlineEdit[] = [{ old: ["2:0000"], new: ["BBB"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(HashlineMismatchError);
	});

	test("stale hash error shows >>> markers with correct hashes", () => {
		const content = "aaa\nbbb\nccc\nddd\neee";
		const edits: HashlineEdit[] = [{ old: ["2:0000"], new: ["BBB"] }];

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
			{ old: ["2:0000"], new: ["BBB"] },
			{ old: ["4:0000"], new: ["DDD"] },
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
		const hash = computeLineHash(10, "aaa");
		const edits: HashlineEdit[] = [{ old: [`10:${hash}`], new: ["X"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/does not exist/);
	});

	test("rejects non-consecutive old lines", () => {
		const content = "aaa\nbbb\nccc\nddd";
		const edits: HashlineEdit[] = [{ old: [makeRef(1, "aaa"), makeRef(3, "ccc")], new: ["X"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/consecutive/);
	});

	test("rejects malformed line ref", () => {
		const content = "aaa\nbbb";
		const edits: HashlineEdit[] = [{ old: ["garbage"], new: ["X"] }];

		expect(() => applyHashlineEdits(content, edits)).toThrow(/Invalid line reference/);
	});
});
