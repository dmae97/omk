/**
 * Regression tests for apply-patch behaviors.
 *
 * These tests verify that the edit/ module correctly implements features
 * that were identified as missing or regressed in other implementations.
 * Each test corresponds to a specific scenario from patchv2/TODO.md.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch, findContextLine, seekSequence } from "../../src/core/tools/patch";

describe("regression: indentation adjustment for line-based replacements (2B)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `regression-2b-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("line-based patch adjusts indentation when fuzzy matching at different indent level", async () => {
		const filePath = join(tempDir, "indent.ts");
		// File has 4-space indentation
		await Bun.write(
			filePath,
			`class Example {
    constructor() {
        this.value = 1;
        this.name = "test";
    }
}
`,
		);

		// Patch uses 0 indentation - should be adjusted to match the 8-space indent in file
		await applyPatch(
			{
				path: "indent.ts",
				operation: "update",
				diff: `@@ constructor() {
-this.value = 1;
-this.name = "test";
+this.value = 42;
+this.name = "updated";`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("        this.value = 42;");
		expect(result).toContain('        this.name = "updated";');
	});

	test("multi-hunk patch adjusts indentation independently per hunk", async () => {
		const filePath = join(tempDir, "multi-indent.ts");
		await Bun.write(
			filePath,
			`function outer() {
  function inner1() {
    return 1;
  }
  function inner2() {
      return 2;
  }
}
`,
		);

		// Different indentation levels in file - each hunk should adjust independently
		await applyPatch(
			{
				path: "multi-indent.ts",
				operation: "update",
				diff: `@@ function inner1() {
-return 1;
+return 10;
@@ function inner2() {
-return 2;
+return 20;`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("    return 10;"); // 4 spaces for inner1
		expect(result).toContain("      return 20;"); // 6 spaces for inner2
	});
});

describe("regression: ambiguity detection for context-less hunks (2C)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `regression-2c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("single-hunk simple diff rejects multiple occurrences", async () => {
		const filePath = join(tempDir, "dupe.txt");
		await Bun.write(filePath, "foo\nbar\nfoo\nbaz\n");

		await expect(
			applyPatch(
				{
					path: "dupe.txt",
					operation: "update",
					diff: "-foo\n+FOO",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(/2 occurrences/);
	});

	test("multi-hunk context-less diff rejects ambiguous patterns", async () => {
		const filePath = join(tempDir, "multi-dupe.txt");
		// Each pattern appears twice
		await Bun.write(filePath, "aaa\nbbb\naaa\nccc\nbbb\nddd\n");

		// First hunk for "aaa" is ambiguous (appears at lines 1 and 3)
		await expect(
			applyPatch(
				{
					path: "multi-dupe.txt",
					operation: "update",
					diff: "@@\n-aaa\n+AAA\n@@\n-ccc\n+CCC",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(/2 occurrences/);
	});

	test("context lines disambiguate otherwise ambiguous patterns", async () => {
		const filePath = join(tempDir, "context-disambig.txt");
		await Bun.write(filePath, "header\nfoo\nbar\nmiddle\nfoo\nbaz\nfooter\n");

		// Context line "middle" disambiguates which "foo" to change
		await applyPatch(
			{
				path: "context-disambig.txt",
				operation: "update",
				diff: "@@\n middle\n-foo\n+FOO",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("header\nfoo\nbar\nmiddle\nFOO\nbaz\nfooter\n");
	});
});

describe("regression: context search uses line hints (2D)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `regression-2d-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("unified diff line numbers help locate correct position", async () => {
		const filePath = join(tempDir, "hints.txt");
		// File with repeated function definitions
		await Bun.write(
			filePath,
			`function process() {
    return 1;
}

function process() {
    return 2;
}

function process() {
    return 3;
}
`,
		);

		// Use unified diff format with line hint to target the second process()
		await applyPatch(
			{
				path: "hints.txt",
				operation: "update",
				diff: `@@ -5,3 +5,3 @@ function process() {
 function process() {
-    return 2;
+    return 200;
 }`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("return 1;"); // First unchanged
		expect(result).toContain("return 200;"); // Second changed
		expect(result).toContain("return 3;"); // Third unchanged
	});

	test("line hint overrides context-only search when appropriate", async () => {
		const filePath = join(tempDir, "hint-priority.txt");
		await Bun.write(
			filePath,
			`# Section A
def helper():
    pass

# Section B
def helper():
    pass
`,
		);

		// Line hint points to Section B's helper (line 6)
		await applyPatch(
			{
				path: "hint-priority.txt",
				operation: "update",
				diff: `@@ -6,2 +6,2 @@ def helper():
 def helper():
-    pass
+    return True`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		const lines = result.split("\n");
		expect(lines[2]).toBe("    pass"); // Section A unchanged
		expect(lines[6]).toBe("    return True"); // Section B changed
	});
});

describe("regression: insertion uses newStartLine fallback (2E)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `regression-2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("pure addition with context uses context to find insertion point", async () => {
		const filePath = join(tempDir, "insert.txt");
		await Bun.write(filePath, "line1\nline2\nline3\n");

		// Insert after line1 using context
		await applyPatch(
			{
				path: "insert.txt",
				operation: "update",
				diff: `@@
 line1
+inserted`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("line1\ninserted\nline2\nline3\n");
	});

	test("pure addition with line hint inserts at correct position", async () => {
		const filePath = join(tempDir, "insert-hint.txt");
		await Bun.write(filePath, "aaa\nbbb\nccc\n");

		// Use unified diff format line hints to insert at specific location
		await applyPatch(
			{
				path: "insert-hint.txt",
				operation: "update",
				diff: `@@ -2,1 +2,2 @@
 bbb
+inserted after bbb`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("aaa\nbbb\ninserted after bbb\nccc\n");
	});

	test("insertion at end of file works correctly", async () => {
		const filePath = join(tempDir, "append.txt");
		await Bun.write(filePath, "first\nsecond\n");

		await applyPatch(
			{
				path: "append.txt",
				operation: "update",
				diff: `@@
+appended line
*** End of File`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("first\nsecond\nappended line\n");
	});
});

describe("regression: seekSequence character-based fallback (2F)", () => {
	test("seekSequence falls back to character-based matching when line-based fails", () => {
		// Lines with subtle differences that line-based fuzzy matching might miss
		const lines = [
			"function calculateTotal(items) {",
			"  let sum = 0;",
			"  for (const item of items) {",
			"    sum += item.price * item.quantity;",
			"  }",
			"  return sum;",
			"}",
		];

		// Pattern has minor differences: extra space, different quote style
		const pattern = [
			"  for (const item of items)  {", // extra space before {
			"    sum += item.price*item.quantity;", // no spaces around *
		];

		const result = seekSequence(lines, pattern, 0, false);
		expect(result.index).toBe(2);
		expect(result.confidence).toBeGreaterThan(0.9);
	});

	test("seekSequence handles normalized unicode matching", () => {
		const lines = ['const message = "Hello – World";', "console.log(message);"];

		// Pattern uses ASCII dash instead of en-dash
		const pattern = ['const message = "Hello - World";'];

		const result = seekSequence(lines, pattern, 0, false);
		expect(result.index).toBe(0);
	});

	test("seekSequence finds pattern with whitespace differences", () => {
		const lines = ["  function   foo()  {", "    return   42;", "  }"];

		// Pattern has normalized whitespace
		const pattern = ["function foo() {", "return 42;"];

		const result = seekSequence(lines, pattern, 0, false);
		expect(result.index).toBe(0);
	});
});

describe("regression: findContextLine progressive matching (2D related)", () => {
	test("finds exact context line", () => {
		const lines = ["function foo() {", "  return 1;", "}"];
		const result = findContextLine(lines, "function foo() {", 0);
		expect(result.index).toBe(0);
		expect(result.confidence).toBe(1.0);
	});

	test("finds context line with whitespace differences", () => {
		const lines = ["  function foo()  {", "  return 1;", "}"];
		const result = findContextLine(lines, "function foo() {", 0);
		expect(result.index).toBe(0);
		expect(result.confidence).toBeGreaterThan(0.9);
	});

	test("finds context line with unicode normalization", () => {
		const lines = ['const msg = "Hello – World";', "return msg;"];
		// ASCII dash in pattern, en-dash in content
		const result = findContextLine(lines, 'const msg = "Hello - World";', 0);
		expect(result.index).toBe(0);
	});

	test("finds context line as prefix match", () => {
		const lines = ["function calculateTotalWithTax(items, taxRate) {", "  return 0;", "}"];
		// Partial function name matches as prefix
		const result = findContextLine(lines, "function calculateTotalWithTax(items", 0);
		expect(result.index).toBe(0);
		expect(result.confidence).toBeGreaterThan(0.9);
	});

	test("finds context line as substring match", () => {
		// Substring must be at least 6 chars and 30% of line length
		const lines = ["// comment: calculateTotal here", "function foo() {}"];
		const result = findContextLine(lines, "calculateTotal", 0);
		expect(result.index).toBe(0);
		expect(result.confidence).toBeGreaterThan(0.9);
	});

	test("falls back to fuzzy match for similar lines", () => {
		const lines = ["functoin calclateTotal(itms) {", "  return 0;", "}"];
		// Typos in content, correct in pattern
		const result = findContextLine(lines, "function calculateTotal(items) {", 0);
		expect(result.index).toBe(0);
		expect(result.confidence).toBeGreaterThan(0.8);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Plan: Make `@@` Context Matching Robust - Expected Behaviors
// These tests document expected behaviors from the plan. Some may fail if
// the feature is not yet implemented.
// ═══════════════════════════════════════════════════════════════════════════

describe("plan: partial line matching for @@ context", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `plan-partial-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ context matches when actual line contains it as substring", async () => {
		const filePath = join(tempDir, "imports.ts");
		// Actual line has more content than the @@ context
		await Bun.write(
			filePath,
			'import { mkdirSync, unlinkSync } from "node:fs";\n\nfunction cleanup() {\n  unlinkSync("temp");\n}\n',
		);

		// @@ context is a partial match (substring of actual line)
		await applyPatch(
			{
				path: "imports.ts",
				operation: "update",
				diff: `@@ import { mkdirSync, unlinkSync }

 function cleanup() {
-  unlinkSync("temp");
+  rmSync("temp", { recursive: true });`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain('rmSync("temp", { recursive: true });');
	});

	test("@@ context matches function signature even with trailing content", async () => {
		const filePath = join(tempDir, "funcs.ts");
		await Bun.write(
			filePath,
			`function processItems(items: Item[], options?: Options): Result {
  return items.map(i => i.value);
}
`,
		);

		// @@ has partial function signature
		await applyPatch(
			{
				path: "funcs.ts",
				operation: "update",
				diff: `@@ function processItems(items
-  return items.map(i => i.value);
+  return items.filter(i => i.valid).map(i => i.value);`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toContain("filter(i => i.valid)");
	});
});

describe("plan: unified diff format line numbers", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `plan-unified-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ -10,6 +10,7 @@ is parsed as line numbers not literal text", async () => {
		const filePath = join(tempDir, "lines.txt");
		// Create file with 15 lines
		const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
		await Bun.write(filePath, `${lines.join("\n")}\n`);

		// Use unified diff format to target line 10
		await applyPatch(
			{
				path: "lines.txt",
				operation: "update",
				diff: `@@ -10,3 +10,3 @@
 line 10
-line 11
+LINE ELEVEN
 line 12`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("LINE ELEVEN");
		expect(result).toContain("line 10"); // unchanged
		expect(result).toContain("line 12"); // unchanged
	});

	test("unified diff line numbers take precedence over context search", async () => {
		const filePath = join(tempDir, "repeat.txt");
		// Same pattern appears at lines 3 and 8
		await Bun.write(
			filePath,
			`header
line 2
target line
line 4
line 5
line 6
line 7
target line
line 9
`,
		);

		// Line hint says line 8, should change second "target line"
		await applyPatch(
			{
				path: "repeat.txt",
				operation: "update",
				diff: `@@ -8,1 +8,1 @@
-target line
+MODIFIED TARGET`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		const lines = result.split("\n");
		expect(lines[2]).toBe("target line"); // First unchanged
		expect(lines[7]).toBe("MODIFIED TARGET"); // Second changed
	});
});

describe("plan: Codex-style wrapped patches", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `plan-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("strips *** Begin Patch / *** End Patch wrapper", async () => {
		const filePath = join(tempDir, "wrapped.txt");
		await Bun.write(filePath, "old content\n");

		// Full Codex-style wrapper - the diff inside should be extracted
		await applyPatch(
			{
				path: "wrapped.txt",
				operation: "update",
				diff: `*** Begin Patch
@@
-old content
+new content
*** End Patch`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("new content\n");
	});

	test("strips partial wrapper (only *** End Patch)", async () => {
		const filePath = join(tempDir, "partial.txt");
		await Bun.write(filePath, "original\n");

		// Only end marker present
		await applyPatch(
			{
				path: "partial.txt",
				operation: "update",
				diff: `@@
-original
+modified
*** End Patch`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("modified\n");
	});

	test("strips unified diff metadata lines", async () => {
		const filePath = join(tempDir, "unified-meta.txt");
		await Bun.write(filePath, "first\nsecond\nthird\n");

		// Full unified diff format with metadata
		await applyPatch(
			{
				path: "unified-meta.txt",
				operation: "update",
				diff: `diff --git a/unified-meta.txt b/unified-meta.txt
index abc123..def456 100644
--- a/unified-meta.txt
+++ b/unified-meta.txt
@@ -1,3 +1,3 @@
 first
-second
+SECOND
 third`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("first\nSECOND\nthird\n");
	});
});

describe("plan: strip + prefix from file creation", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `plan-create-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("create file strips + prefix when all lines have it", async () => {
		await applyPatch(
			{
				path: "newfile.txt",
				operation: "create",
				diff: `+line one
+line two
+line three`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(join(tempDir, "newfile.txt"), "utf-8")).toBe("line one\nline two\nline three\n");
	});

	test("create file strips + space prefix", async () => {
		await applyPatch(
			{
				path: "spaced.txt",
				operation: "create",
				diff: `+ first line
+ second line`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(join(tempDir, "spaced.txt"), "utf-8")).toBe("first line\nsecond line\n");
	});

	test("create file preserves content when not all lines have + prefix", async () => {
		await applyPatch(
			{
				path: "mixed.txt",
				operation: "create",
				diff: `+line one
regular line
+line three`,
			},
			{ cwd: tempDir },
		);

		// Should preserve as-is since not all lines have +
		expect(readFileSync(join(tempDir, "mixed.txt"), "utf-8")).toBe("+line one\nregular line\n+line three\n");
	});
});

describe("regression: *** End of File marker handling (2A/2G)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `regression-eof-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("*** End of File marker is preserved in hunk parsing", async () => {
		const filePath = join(tempDir, "eof.txt");
		await Bun.write(filePath, "line1\nline2\nlast line\n");

		await applyPatch(
			{
				path: "eof.txt",
				operation: "update",
				diff: `@@
-last line
+modified last line
*** End of File`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("line1\nline2\nmodified last line\n");
	});

	test("EOF marker targets end of file for pattern matching", async () => {
		const filePath = join(tempDir, "eof-target.txt");
		// Pattern appears twice - EOF should target the last one
		await Bun.write(filePath, "item\nmore content\nitem\n");

		await applyPatch(
			{
				path: "eof-target.txt",
				operation: "update",
				diff: `@@
-item
+FINAL ITEM
*** End of File`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toBe("item\nmore content\nFINAL ITEM\n");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression: Model edit attempts that failed due to parser limitations
// These tests document real model behaviors that we want to recover from.
// Session: 2026-01-19T08-29-03-476Z_v0FEI1ixUrlssLyHL3TT3.jsonl
// ═══════════════════════════════════════════════════════════════════════════

describe("regression: model edit attempt - @@ line N syntax (session 2026-01-19)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `model-line-n-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ line 125 is parsed as line hint, not literal context search", async () => {
		const filePath = join(tempDir, "settings.ts");
		// Create file with enough lines - the target is around line 125
		const lines: string[] = [];
		for (let i = 1; i <= 130; i++) {
			if (i === 125) {
				lines.push("\tfuzzyMatch?: boolean; // default: true");
			} else if (i === 126) {
				lines.push("\tfuzzyThreshold?: number; // default: 0.95");
			} else if (i === 127) {
				lines.push("\tpatchMode?: boolean; // default: false");
			} else if (i === 128) {
				lines.push("}");
			} else {
				lines.push(`// line ${i}`);
			}
		}
		await Bun.write(filePath, `${lines.join("\n")}\n`);

		// Model's actual attempt: used @@ line 125 as anchor
		await applyPatch(
			{
				path: "settings.ts",
				operation: "update",
				diff: `@@ line 125
 	fuzzyMatch?: boolean; // default: true
 	fuzzyThreshold?: number; // default: 0.95
-	patchMode?: boolean; // default: false
+	patchMode?: boolean; // default: true
 }`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("patchMode?: boolean; // default: true");
		expect(result).not.toContain("patchMode?: boolean; // default: false");
	});

	test("@@ line N works with various formats", async () => {
		const filePath = join(tempDir, "code.ts");
		const lines = Array.from({ length: 20 }, (_, i) => `content line ${i + 1}`);
		lines[9] = "old value"; // line 10
		await Bun.write(filePath, `${lines.join("\n")}\n`);

		// Variations the model might produce
		await applyPatch(
			{
				path: "code.ts",
				operation: "update",
				diff: `@@ line 10
-old value
+new value`,
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toContain("new value");
	});
});

describe("regression: model edit attempt - nested @@ anchors (session 2026-01-19)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `model-nested-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ class X followed by @@   method on next line is parsed as nested anchors", async () => {
		const filePath = join(tempDir, "patch.ts");
		await Bun.write(
			filePath,
			`class OtherTool {
	constructor(session: ToolSession) {
		this.session = session;
		this.mode = false;
	}
}

class PatchTool {
	constructor(session: ToolSession) {
		this.session = session;
		this.patchMode = session.settings?.getEditPatchMode?.() ?? false;
		this.allowFuzzy = true;
	}
}
`,
		);

		// Model's actual attempt: multi-line @@ anchors
		await applyPatch(
			{
				path: "patch.ts",
				operation: "update",
				diff: `@@ class PatchTool
@@   constructor
 	constructor(session: ToolSession) {
 		this.session = session;
-		this.patchMode = session.settings?.getEditPatchMode?.() ?? false;
+		this.patchMode = session.settings?.getEditPatchMode?.() ?? true;
 		this.allowFuzzy = true;`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		// Should change PatchTool's constructor, not OtherTool's
		expect(result).toContain("this.patchMode = session.settings?.getEditPatchMode?.() ?? true;");
		expect(result).toContain("this.mode = false;"); // OtherTool unchanged
	});

	test("nested @@ anchors disambiguate between multiple matching methods", async () => {
		const filePath = join(tempDir, "multi-class.ts");
		await Bun.write(
			filePath,
			`class Alpha {
	process() {
		return "alpha";
	}
}

class Beta {
	process() {
		return "beta";
	}
}
`,
		);

		await applyPatch(
			{
				path: "multi-class.ts",
				operation: "update",
				diff: `@@ class Beta
@@   process
 	process() {
-		return "beta";
+		return "BETA";
 	}`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain('return "alpha"'); // Alpha unchanged
		expect(result).toContain('return "BETA"'); // Beta changed
	});
});

describe("regression: model edit attempt - space-separated anchors (session 2026-01-19)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `model-space-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ class PatchTool constructor is parsed as hierarchical anchors", async () => {
		const filePath = join(tempDir, "tool.ts");
		await Bun.write(
			filePath,
			`class OtherTool {
	constructor() {
		this.value = 1;
	}
}

class PatchTool {
	constructor() {
		this.value = 2;
	}
}
`,
		);

		// Model's actual attempt: space-separated anchors
		await applyPatch(
			{
				path: "tool.ts",
				operation: "update",
				diff: `@@ class PatchTool constructor
 	constructor() {
-		this.value = 2;
+		this.value = 200;
 	}`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("this.value = 1;"); // OtherTool unchanged
		expect(result).toContain("this.value = 200;"); // PatchTool changed
	});

	test("space-separated anchors work with function keyword", async () => {
		const filePath = join(tempDir, "funcs.ts");
		await Bun.write(
			filePath,
			`function outer() {
	function helper() {
		return 1;
	}
	return helper();
}

function process() {
	function helper() {
		return 2;
	}
	return helper();
}
`,
		);

		await applyPatch(
			{
				path: "funcs.ts",
				operation: "update",
				diff: `@@ function process helper
 	function helper() {
-		return 2;
+		return 200;
 	}`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("return 1;"); // outer's helper unchanged
		expect(result).toContain("return 200;"); // process's helper changed
	});
});

describe("regression: model edit attempt - unique substring on long line (session 2026-01-19 #2)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `model-long-line-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("@@ class ClassName matches long export line when unique", async () => {
		const filePath = join(tempDir, "tool.ts");
		// Real-world pattern: long line with export, implements, generics
		await Bun.write(
			filePath,
			`import { Something } from "somewhere";

export class EditTool implements AgentTool<typeof replaceEditSchema | typeof patchEditSchema, EditToolDetails> {
	public readonly name = "edit";

	constructor(session: ToolSession) {
		this.session = session;
		this.patchMode = false;
	}
}
`,
		);

		// Model's actual attempt: used "class EditTool" which is only ~12% of line length
		await applyPatch(
			{
				path: "tool.ts",
				operation: "update",
				diff: `@@ class EditTool
 	constructor(session: ToolSession) {
 		this.session = session;
-		this.patchMode = false;
+		this.patchMode = true;
 	}`,
			},
			{ cwd: tempDir },
		);

		const result = readFileSync(filePath, "utf-8");
		expect(result).toContain("this.patchMode = true;");
	});

	test("@@ class ClassName still rejects when multiple classes match", async () => {
		const filePath = join(tempDir, "multi.ts");
		await Bun.write(
			filePath,
			`export class EditTool implements AgentTool<Schema1, Details1> {
	value = 1;
}

export class EditTool implements AgentTool<Schema2, Details2> {
	value = 2;
}
`,
		);

		// Should reject because "class EditTool" matches two lines
		await expect(
			applyPatch(
				{
					path: "multi.ts",
					operation: "update",
					diff: `@@ class EditTool
-	value = 1;
+	value = 100;`,
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(/2 matches/);
	});
});
