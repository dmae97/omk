import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplyPatchError, applyPatch, ParseError, type PatchInput, parseDiffHunks, seekSequence } from "$c/patch";

// ═══════════════════════════════════════════════════════════════════════════
// Legacy parser for test fixtures (*** Begin Patch format)
// ═══════════════════════════════════════════════════════════════════════════

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";

type LegacyHunk =
	| { type: "add"; path: string; contents: string }
	| { type: "delete"; path: string }
	| { type: "update"; path: string; movePath?: string; diffBody: string };

interface LegacyParseResult {
	hunks: LegacyHunk[];
}

function parseLegacyPatch(patch: string): LegacyParseResult {
	let lines = patch.trim().split("\n");

	// Try lenient heredoc mode first
	if (
		lines.length >= 4 &&
		(lines[0] === "<<EOF" || lines[0] === "<<'EOF'" || lines[0] === '<<"EOF"') &&
		lines[lines.length - 1].endsWith("EOF")
	) {
		lines = lines.slice(1, lines.length - 1);
	}

	// Check boundaries
	if (lines.length === 0 || lines[0].trim() !== BEGIN_PATCH_MARKER) {
		throw new ParseError("The first line of the patch must be '*** Begin Patch'");
	}
	if (lines[lines.length - 1].trim() !== END_PATCH_MARKER) {
		throw new ParseError("The last line of the patch must be '*** End Patch'");
	}

	const hunks: LegacyHunk[] = [];
	let remainingLines = lines.slice(1, lines.length - 1);
	let lineNumber = 2;

	while (remainingLines.length > 0) {
		if (remainingLines[0].trim() === "") {
			remainingLines = remainingLines.slice(1);
			lineNumber++;
			continue;
		}

		const firstLine = remainingLines[0].trim();

		// Add File
		if (firstLine.startsWith(ADD_FILE_MARKER)) {
			const path = firstLine.slice(ADD_FILE_MARKER.length);
			let contents = "";
			let linesConsumed = 1;

			for (let i = 1; i < remainingLines.length; i++) {
				const line = remainingLines[i];
				if (line.startsWith("+")) {
					contents += `${line.slice(1)}\n`;
					linesConsumed++;
				} else {
					break;
				}
			}

			hunks.push({ type: "add", path, contents });
			remainingLines = remainingLines.slice(linesConsumed);
			lineNumber += linesConsumed;
			continue;
		}

		// Delete File
		if (firstLine.startsWith(DELETE_FILE_MARKER)) {
			const path = firstLine.slice(DELETE_FILE_MARKER.length);
			hunks.push({ type: "delete", path });
			remainingLines = remainingLines.slice(1);
			lineNumber++;
			continue;
		}

		// Update File
		if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
			const path = firstLine.slice(UPDATE_FILE_MARKER.length);
			remainingLines = remainingLines.slice(1);
			lineNumber++;

			let movePath: string | undefined;
			if (remainingLines.length > 0 && remainingLines[0].startsWith(MOVE_TO_MARKER)) {
				movePath = remainingLines[0].slice(MOVE_TO_MARKER.length);
				remainingLines = remainingLines.slice(1);
				lineNumber++;
			}

			// Collect diff body until next file marker or end
			const diffLines: string[] = [];
			while (remainingLines.length > 0) {
				const line = remainingLines[0];
				// Stop at file operation markers (but not *** End of File)
				if (
					line.startsWith("*** Add File:") ||
					line.startsWith("*** Delete File:") ||
					line.startsWith("*** Update File:")
				) {
					break;
				}
				diffLines.push(remainingLines[0]);
				remainingLines = remainingLines.slice(1);
				lineNumber++;
			}

			if (diffLines.length === 0) {
				throw new ParseError(`Update file hunk for path '${path}' is empty`, lineNumber);
			}

			hunks.push({ type: "update", path, movePath, diffBody: diffLines.join("\n") });
			continue;
		}

		throw new ParseError(
			`'${firstLine}' is not a valid hunk header. Valid: '*** Add File:', '*** Delete File:', '*** Update File:'`,
			lineNumber,
		);
	}

	return { hunks };
}

/** Convert legacy hunk to new PatchInput format */
function legacyHunkToInput(hunk: LegacyHunk): PatchInput {
	if (hunk.type === "add") {
		return { path: hunk.path, op: "create", diff: hunk.contents };
	}
	if (hunk.type === "delete") {
		return { path: hunk.path, op: "delete" };
	}
	return { path: hunk.path, op: "update", rename: hunk.movePath, diff: hunk.diffBody };
}

/** Apply a legacy format patch (for test fixtures) */
async function applyLegacyPatch(patch: string, options: { cwd: string }) {
	const { hunks } = parseLegacyPatch(patch);

	if (hunks.length === 0) {
		throw new ApplyPatchError("No files were modified.");
	}

	for (const hunk of hunks) {
		const input = legacyHunkToInput(hunk);
		await applyPatch(input, options);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// seek-sequence tests (port of seek_sequence.rs tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("seekSequence", () => {
	test("exact match finds sequence", () => {
		const lines = ["foo", "bar", "baz"];
		const pattern = ["bar", "baz"];
		expect(seekSequence(lines, pattern, 0, false).index).toBe(1);
	});

	test("rstrip match ignores trailing whitespace", () => {
		const lines = ["foo   ", "bar\t\t"];
		const pattern = ["foo", "bar"];
		expect(seekSequence(lines, pattern, 0, false).index).toBe(0);
	});

	test("trim match ignores leading and trailing whitespace", () => {
		const lines = ["    foo   ", "   bar\t"];
		const pattern = ["foo", "bar"];
		expect(seekSequence(lines, pattern, 0, false).index).toBe(0);
	});

	test("pattern longer than input returns undefined", () => {
		const lines = ["just one line"];
		const pattern = ["too", "many", "lines"];
		expect(seekSequence(lines, pattern, 0, false).index).toBeUndefined();
	});

	test("empty pattern returns start", () => {
		const lines = ["foo", "bar"];
		expect(seekSequence(lines, [], 0, false).index).toBe(0);
		expect(seekSequence(lines, [], 5, false).index).toBe(5);
	});

	test("eof mode prefers end of file", () => {
		const lines = ["a", "b", "c", "d", "e"];
		const pattern = ["d", "e"];
		expect(seekSequence(lines, pattern, 0, true).index).toBe(3);
	});

	test("unicode normalization matches dashes", () => {
		const lines = ["import asyncio  # local import \u2013 avoids top\u2011level dep"];
		const pattern = ["import asyncio  # local import - avoids top-level dep"];
		expect(seekSequence(lines, pattern, 0, false).index).toBe(0);
	});

	test("fuzzy match finds sequence with minor differences", () => {
		const lines = ["function greet() {", '  console.log("Hello!");', "}"];
		const pattern = ["function greet() {", '  console.log("Hello!")  ', "}"];
		const result = seekSequence(lines, pattern, 0, false);
		expect(result.index).toBe(0);
		expect(result.confidence).toBeGreaterThanOrEqual(0.92);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy parser tests (for fixture compatibility)
// ═══════════════════════════════════════════════════════════════════════════

describe("parseLegacyPatch", () => {
	const wrapPatch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

	test("rejects invalid first line", () => {
		expect(() => parseLegacyPatch("bad")).toThrow(ParseError);
	});

	test("rejects missing end marker", () => {
		expect(() => parseLegacyPatch("*** Begin Patch\nbad")).toThrow(ParseError);
	});

	test("parses add file with whitespace-padded markers", () => {
		const patch = "*** Begin Patch \n*** Add File: foo\n+hi\n *** End Patch";
		const result = parseLegacyPatch(patch);
		expect(result.hunks).toEqual([{ type: "add", path: "foo", contents: "hi\n" }]);
	});

	test("rejects empty update file hunk", () => {
		const patch = wrapPatch("*** Update File: test.py");
		expect(() => parseLegacyPatch(patch)).toThrow(ParseError);
	});

	test("parses empty patch", () => {
		const patch = wrapPatch("");
		const result = parseLegacyPatch(patch);
		expect(result.hunks).toEqual([]);
	});

	test("parses full patch with all operations", () => {
		const patch = wrapPatch(
			"*** Add File: path/add.py\n" +
				"+abc\n" +
				"+def\n" +
				"*** Delete File: path/delete.py\n" +
				"*** Update File: path/update.py\n" +
				"*** Move to: path/update2.py\n" +
				"@@ def f():\n" +
				"-    pass\n" +
				"+    return 123",
		);
		const result = parseLegacyPatch(patch);

		expect(result.hunks).toHaveLength(3);
		expect(result.hunks[0]).toEqual({ type: "add", path: "path/add.py", contents: "abc\ndef\n" });
		expect(result.hunks[1]).toEqual({ type: "delete", path: "path/delete.py" });
		expect(result.hunks[2]).toMatchObject({
			type: "update",
			path: "path/update.py",
			movePath: "path/update2.py",
		});
	});

	test("parses heredoc wrapped patch", () => {
		const patchText = "*** Begin Patch\n*** Add File: test.txt\n+hello\n*** End Patch";
		const heredocPatch = `<<'EOF'\n${patchText}\nEOF\n`;
		const result = parseLegacyPatch(heredocPatch);
		expect(result.hunks).toHaveLength(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// parseDiffHunks tests
// ═══════════════════════════════════════════════════════════════════════════

describe("parseDiffHunks", () => {
	test("parses simple hunk", () => {
		const diff = "@@ def f():\n-    pass\n+    return 123";
		const chunks = parseDiffHunks(diff);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].changeContext).toBe("def f():");
		expect(chunks[0].oldLines).toEqual(["    pass"]);
		expect(chunks[0].newLines).toEqual(["    return 123"]);
	});

	test("parses multiple hunks", () => {
		const diff = "@@\n-bar\n+BAR\n@@\n-qux\n+QUX";
		const chunks = parseDiffHunks(diff);
		expect(chunks).toHaveLength(2);
	});

	test("parses context lines", () => {
		const diff = "@@\n foo\n-bar\n+baz\n qux";
		const chunks = parseDiffHunks(diff);
		expect(chunks[0].oldLines).toEqual(["foo", "bar", "qux"]);
		expect(chunks[0].newLines).toEqual(["foo", "baz", "qux"]);
	});

	test("handles empty @@ marker", () => {
		const diff = "@@\n+new line";
		const chunks = parseDiffHunks(diff);
		expect(chunks[0].changeContext).toBeUndefined();
	});

	test("handles end of file marker", () => {
		const diff = "@@\n+line\n*** End of File";
		const chunks = parseDiffHunks(diff);
		expect(chunks[0].isEndOfFile).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixture-based scenario tests
// ═══════════════════════════════════════════════════════════════════════════

describe("apply-patch scenarios", () => {
	const fixturesDir = join(import.meta.dir, "../fixtures/apply-patch/scenarios");
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `apply-patch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	function snapshotDir(dir: string): Map<string, string | "dir"> {
		const entries = new Map<string, string | "dir">();
		if (!readdirSync(dir, { withFileTypes: true }).length) {
			return entries;
		}

		function walk(currentDir: string, relativePath: string) {
			for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
				const fullPath = join(currentDir, entry.name);
				const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

				if (entry.isDirectory()) {
					entries.set(relPath, "dir");
					walk(fullPath, relPath);
				} else if (entry.isFile()) {
					entries.set(relPath, readFileSync(fullPath, "utf-8"));
				}
			}
		}

		walk(dir, "");
		return entries;
	}

	function copyDirRecursive(src: string, dst: string) {
		cpSync(src, dst, { recursive: true });
	}

	// Get all scenario directories
	const scenarioDirs = readdirSync(fixturesDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();

	for (const scenarioName of scenarioDirs) {
		test(scenarioName, async () => {
			const scenarioDir = join(fixturesDir, scenarioName);

			// Copy input files to temp directory
			const inputDir = join(scenarioDir, "input");
			try {
				copyDirRecursive(inputDir, tempDir);
			} catch {
				// No input directory is fine (e.g., for add-only scenarios)
			}

			// Read the patch
			const patchPath = join(scenarioDir, "patch.txt");
			const patch = readFileSync(patchPath, "utf-8");

			// Apply the patch using legacy parser (catching errors for rejection tests)
			try {
				await applyLegacyPatch(patch, { cwd: tempDir });
			} catch {
				// Expected for rejection tests
			}

			// Compare final state to expected
			const expectedDir = join(scenarioDir, "expected");
			const expectedSnapshot = snapshotDir(expectedDir);
			const actualSnapshot = snapshotDir(tempDir);

			expect(actualSnapshot).toEqual(expectedSnapshot);
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit tests for applyPatch (new format)
// ═══════════════════════════════════════════════════════════════════════════

describe("applyPatch", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `apply-patch-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	test("create file", async () => {
		const result = await applyPatch({ path: "add.txt", op: "create", diff: "ab\ncd" }, { cwd: tempDir });

		expect(result.change.type).toBe("create");
		expect(readFileSync(join(tempDir, "add.txt"), "utf-8")).toBe("ab\ncd\n");
	});

	test("delete file", async () => {
		const filePath = join(tempDir, "del.txt");
		await Bun.write(filePath, "x");

		const result = await applyPatch({ path: "del.txt", op: "delete" }, { cwd: tempDir });

		expect(result.change.type).toBe("delete");
		expect(await Bun.file(filePath).exists()).toBe(false);
	});

	test("update file", async () => {
		const filePath = join(tempDir, "update.txt");
		await Bun.write(filePath, "foo\nbar\n");

		const result = await applyPatch(
			{ path: "update.txt", op: "update", diff: "@@\n foo\n-bar\n+baz" },
			{ cwd: tempDir },
		);

		expect(result.change.type).toBe("update");
		expect(readFileSync(filePath, "utf-8")).toBe("foo\nbaz\n");
	});

	test("update with move", async () => {
		const srcPath = join(tempDir, "src.txt");
		await Bun.write(srcPath, "line\n");

		const result = await applyPatch(
			{ path: "src.txt", op: "update", rename: "dst.txt", diff: "@@\n-line\n+line2" },
			{ cwd: tempDir },
		);

		expect(result.change.type).toBe("update");
		expect(result.change.newPath).toBe(join(tempDir, "dst.txt"));
		expect(await Bun.file(srcPath).exists()).toBe(false);
		expect(readFileSync(join(tempDir, "dst.txt"), "utf-8")).toBe("line2\n");
	});

	test("multiple hunks in single update", async () => {
		const filePath = join(tempDir, "multi.txt");
		await Bun.write(filePath, "foo\nbar\nbaz\nqux\n");

		await applyPatch({ path: "multi.txt", op: "update", diff: "@@\n-bar\n+BAR\n@@\n-qux\n+QUX" }, { cwd: tempDir });

		expect(readFileSync(filePath, "utf-8")).toBe("foo\nBAR\nbaz\nQUX\n");
	});

	test("@@ scope and first context line can be identical", async () => {
		const filePath = join(tempDir, "scope.txt");
		await Bun.write(filePath, "## [Unreleased]\n\n### Changed\n\n- Old entry\n");

		await applyPatch(
			{
				path: "scope.txt",
				op: "update",
				diff: "@@ ## [Unreleased]\n ## [Unreleased]\n \n+### Added\n+\n+- New feature\n+\n ### Changed",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe(
			"## [Unreleased]\n\n### Added\n\n- New feature\n\n### Changed\n\n- Old entry\n",
		);
	});

	test("unicode dash matching", async () => {
		const filePath = join(tempDir, "unicode.py");
		await Bun.write(filePath, "import asyncio  # local import \u2013 avoids top\u2011level dep\n");

		await applyPatch(
			{
				path: "unicode.py",
				op: "update",
				diff: "@@\n-import asyncio  # local import - avoids top-level dep\n+import asyncio  # HELLO",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("import asyncio  # HELLO\n");
	});

	test("dry run does not modify files", async () => {
		const filePath = join(tempDir, "dryrun.txt");
		await Bun.write(filePath, "original\n");

		const result = await applyPatch(
			{ path: "dryrun.txt", op: "update", diff: "@@\n-original\n+modified" },
			{ cwd: tempDir, dryRun: true },
		);

		expect(result.change.newContent).toBe("modified\n");
		expect(readFileSync(filePath, "utf-8")).toBe("original\n");
	});

	test("missing file for update fails", async () => {
		await expect(
			applyPatch({ path: "nonexistent.txt", op: "update", diff: "@@\n-foo\n+bar" }, { cwd: tempDir }),
		).rejects.toThrow(ApplyPatchError);
	});

	test("update without diff fails", async () => {
		const filePath = join(tempDir, "nodiff.txt");
		await Bun.write(filePath, "content\n");

		await expect(applyPatch({ path: "nodiff.txt", op: "update" }, { cwd: tempDir })).rejects.toThrow("requires diff");
	});

	test("creates parent directories for create", async () => {
		await applyPatch({ path: "nested/deep/file.txt", op: "create", diff: "content" }, { cwd: tempDir });

		const filePath = join(tempDir, "nested/deep/file.txt");
		expect(readFileSync(filePath, "utf-8")).toBe("content\n");
	});

	test("creates parent directories for move", async () => {
		const srcPath = join(tempDir, "src.txt");
		await Bun.write(srcPath, "line\n");

		await applyPatch(
			{ path: "src.txt", op: "update", rename: "nested/deep/dst.txt", diff: "@@\n-line\n+newline" },
			{ cwd: tempDir },
		);

		const dstPath = join(tempDir, "nested/deep/dst.txt");
		expect(readFileSync(dstPath, "utf-8")).toBe("newline\n");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Simple replace mode tests (character-based fuzzy matching)
// ═══════════════════════════════════════════════════════════════════════════

describe("simple replace mode", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `simple-replace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	test("simple -/+ only diff uses character-based fuzzy matching", async () => {
		const filePath = join(tempDir, "fuzzy.txt");
		// File has smart quotes, diff uses ASCII quotes
		await Bun.write(filePath, 'console.log("Hello");\n');

		await applyPatch(
			{
				path: "fuzzy.txt",
				op: "update",
				// No @@ marker, just -/+ lines
				diff: '-console.log("Hello");\n+console.log("World");',
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe('console.log("World");\n');
	});

	test("simple diff adjusts indentation to match actual content", async () => {
		const filePath = join(tempDir, "indent.ts");
		// File content is indented with 4 spaces
		await Bun.write(filePath, "function test() {\n    const x = 1;\n    return x;\n}\n");

		await applyPatch(
			{
				path: "indent.ts",
				op: "update",
				// Diff uses 0 indentation, should be adjusted to 4 spaces
				diff: "-const x = 1;\n+const x = 42;",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("function test() {\n    const x = 42;\n    return x;\n}\n");
	});

	test("diff with context lines falls back to line-based matching", async () => {
		const filePath = join(tempDir, "context.txt");
		// Create a file with repeated patterns that need context to disambiguate
		await Bun.write(filePath, "header\nfoo\nbar\nmiddle\nfoo\nbaz\nfooter\n");

		// Use context line to target the second "foo"
		await applyPatch(
			{
				path: "context.txt",
				op: "update",
				diff: "@@\n middle\n-foo\n+FOO",
			},
			{ cwd: tempDir },
		);

		// Only the second "foo" should be changed
		expect(readFileSync(filePath, "utf-8")).toBe("header\nfoo\nbar\nmiddle\nFOO\nbaz\nfooter\n");
	});

	test("multiple chunks use line-based matching", async () => {
		const filePath = join(tempDir, "multi.txt");
		await Bun.write(filePath, "aaa\nbbb\nccc\nddd\n");

		// Multiple chunks in a single diff
		await applyPatch(
			{
				path: "multi.txt",
				op: "update",
				diff: "@@\n-bbb\n+BBB\n@@\n-ddd\n+DDD",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("aaa\nBBB\nccc\nDDD\n");
	});

	test("simple diff with @@ context uses line-based matching", async () => {
		const filePath = join(tempDir, "scoped.txt");
		await Bun.write(filePath, "class Foo {\n  method() {\n    return 1;\n  }\n}\n");

		// Even without context lines, @@ marker triggers line-based mode
		await applyPatch(
			{
				path: "scoped.txt",
				op: "update",
				diff: "@@ class Foo {\n-    return 1;\n+    return 42;",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("class Foo {\n  method() {\n    return 42;\n  }\n}\n");
	});

	test("simple diff rejects multiple occurrences", async () => {
		const filePath = join(tempDir, "dupe.txt");
		await Bun.write(filePath, "foo\nbar\nfoo\n");

		await expect(
			applyPatch(
				{
					path: "dupe.txt",
					op: "update",
					diff: "-foo\n+FOO",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(/2 occurrences/);
	});
});
