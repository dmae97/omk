import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EditTool } from "@oh-my-pi/pi-coding-agent/patch";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { FindTool } from "@oh-my-pi/pi-coding-agent/tools/find";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { LsTool } from "@oh-my-pi/pi-coding-agent/tools/ls";
import { wrapToolWithMetaNotice } from "@oh-my-pi/pi-coding-agent/tools/output-meta";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import * as shellModule from "@oh-my-pi/pi-coding-agent/utils/shell";
import { nanoid } from "nanoid";

// Helper to extract text from content blocks
function getTextOutput(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

function createTestToolSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	};
}

describe("Coding Agent Tools", () => {
	let testDir: string;
	let readTool: ReadTool;
	let writeTool: WriteTool;
	let editTool: EditTool;
	let bashTool: BashTool;
	let grepTool: GrepTool;
	let findTool: FindTool;
	let lsTool: LsTool;
	let originalEditVariant: string | undefined;

	beforeEach(() => {
		// Force replace mode for edit tool tests using old_text/new_text
		originalEditVariant = process.env.OMP_EDIT_VARIANT;
		process.env.OMP_EDIT_VARIANT = "replace";

		// Create a unique temporary directory for each test
		testDir = path.join(os.tmpdir(), `coding-agent-test-${nanoid()}`);
		fs.mkdirSync(testDir, { recursive: true });

		// Create tools for this test directory
		const session = createTestToolSession(testDir);
		readTool = wrapToolWithMetaNotice(new ReadTool(session));
		writeTool = wrapToolWithMetaNotice(new WriteTool(session));
		editTool = wrapToolWithMetaNotice(new EditTool(session));
		bashTool = wrapToolWithMetaNotice(new BashTool(session));
		grepTool = wrapToolWithMetaNotice(new GrepTool(session));
		findTool = wrapToolWithMetaNotice(new FindTool(session));
		lsTool = wrapToolWithMetaNotice(new LsTool(session));
	});

	afterEach(() => {
		// Clean up test directory
		fs.rmSync(testDir, { recursive: true, force: true });

		// Restore original edit variant
		if (originalEditVariant === undefined) {
			delete process.env.OMP_EDIT_VARIANT;
		} else {
			process.env.OMP_EDIT_VARIANT = originalEditVariant;
		}
	});

	describe("read tool", () => {
		it("should read file contents that fit within limits", async () => {
			const testFile = path.join(testDir, "test.txt");
			const content = "Hello, world!\nLine 2\nLine 3";
			fs.writeFileSync(testFile, content);

			const result = await readTool.execute("test-call-1", { path: testFile, lines: false });

			expect(getTextOutput(result)).toBe(content);
			// No truncation message since file fits within limits
			expect(getTextOutput(result)).not.toContain("Use offset=");
			expect(result.details?.truncation).toBeUndefined();
		});

		it("should handle non-existent files", async () => {
			const testFile = path.join(testDir, "nonexistent.txt");

			await expect(readTool.execute("test-call-2", { path: testFile })).rejects.toThrow(/ENOENT|not found/i);
		});

		it("should truncate files exceeding line limit", async () => {
			const testFile = path.join(testDir, "large.txt");
			const lines = Array.from({ length: 3500 }, (_, i) => `Line ${i + 1}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-3", { path: testFile });
			const output = getTextOutput(result);

			expect(output).toContain("Line 1");
			expect(output).toContain("Line 3000");
			expect(output).not.toContain("Line 3001");
			expect(output).toContain("[Showing lines 1-3000 of 3500. Use offset=3001 to continue]");
		});

		it("should truncate when byte limit exceeded", async () => {
			const testFile = path.join(testDir, "large-bytes.txt");
			// Create file that exceeds 50KB byte limit but has fewer than 3000 lines
			const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}: ${"x".repeat(200)}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-4", { path: testFile });
			const output = getTextOutput(result);

			expect(output).toContain("Line 1:");
			// Should show byte limit message
			expect(output).toMatch(
				/\[Showing lines 1-\d+ of 1000 \(\d+(\.\d+)?\s*KB limit\)\. Use offset=\d+ to continue\]/,
			);
		});

		it("should handle offset parameter", async () => {
			const testFile = path.join(testDir, "offset-test.txt");
			const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-5", { path: testFile, offset: 51 });
			const output = getTextOutput(result);

			expect(output).not.toContain("Line 50");
			expect(output).toContain("Line 51");
			expect(output).toContain("Line 100");
			// No truncation message since file fits within limits
			expect(output).not.toContain("Use offset=");
		});

		it("should handle limit parameter", async () => {
			const testFile = path.join(testDir, "limit-test.txt");
			const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-6", { path: testFile, limit: 10 });
			const output = getTextOutput(result);

			expect(output).toContain("Line 1");
			expect(output).toContain("Line 10");
			expect(output).not.toContain("Line 11");
			expect(output).toContain("[Showing lines 1-10 of 100. Use offset=11 to continue]");
		});

		it("should handle offset + limit together", async () => {
			const testFile = path.join(testDir, "offset-limit-test.txt");
			const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-7", {
				path: testFile,
				offset: 41,
				limit: 20,
			});
			const output = getTextOutput(result);

			expect(output).not.toContain("Line 40");
			expect(output).toContain("Line 41");
			expect(output).toContain("Line 60");
			expect(output).not.toContain("Line 61");
			expect(output).toContain("[Showing lines 41-60 of 100. Use offset=61 to continue]");
		});

		it("should show error when offset is beyond file length", async () => {
			const testFile = path.join(testDir, "short.txt");
			fs.writeFileSync(testFile, "Line 1\nLine 2\nLine 3");

			const result = await readTool.execute("test-call-8", { path: testFile, offset: 100 });
			const output = getTextOutput(result);

			expect(output).toContain("Offset 100 is beyond end of file (3 lines total)");
			expect(output).toContain("Use offset=1 to read from the start, or offset=3 to read the last line.");
		});

		it("should include truncation details when truncated", async () => {
			const testFile = path.join(testDir, "large-file.txt");
			const lines = Array.from({ length: 3500 }, (_, i) => `Line ${i + 1}`);
			fs.writeFileSync(testFile, lines.join("\n"));

			const result = await readTool.execute("test-call-9", { path: testFile });

			expect(result.details).toBeDefined();
			expect(result.details?.truncation).toBeDefined();
			expect(result.details?.truncation?.truncated).toBe(true);
			expect(result.details?.truncation?.truncatedBy).toBe("lines");
			expect(result.details?.truncation?.totalLines).toBe(3500);
			expect(result.details?.truncation?.outputLines).toBe(3000);
		});

		it("should detect image MIME type from file magic (not extension)", async () => {
			const png1x1Base64 =
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2Z0AAAAASUVORK5CYII=";
			const pngBuffer = Buffer.from(png1x1Base64, "base64");

			const testFile = path.join(testDir, "image.txt");
			fs.writeFileSync(testFile, pngBuffer);

			const result = await readTool.execute("test-call-img-1", { path: testFile });

			expect(result.content[0]?.type).toBe("text");
			expect(getTextOutput(result)).toContain("Read image file [image/png]");

			const imageBlock = result.content.find(
				(c): c is { type: "image"; mimeType: string; data: string } => c.type === "image",
			);
			expect(imageBlock).toBeDefined();
			expect(imageBlock?.mimeType).toBe("image/png");
			expect(typeof imageBlock?.data).toBe("string");
			expect((imageBlock?.data ?? "").length).toBeGreaterThan(0);
		});

		it("should treat files with image extension but non-image content as text", async () => {
			const testFile = path.join(testDir, "not-an-image.png");
			fs.writeFileSync(testFile, "definitely not a png");

			const result = await readTool.execute("test-call-img-2", { path: testFile });
			const output = getTextOutput(result);

			expect(output).toContain("definitely not a png");
			expect(result.content.some((c: any) => c.type === "image")).toBe(false);
		});
	});

	describe("write tool", () => {
		it("should write file contents", async () => {
			const testFile = path.join(testDir, "write-test.txt");
			const content = "Test content";

			const result = await writeTool.execute("test-call-3", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(getTextOutput(result)).toContain(testFile);
		});

		it("should create parent directories", async () => {
			const testFile = path.join(testDir, "nested", "dir", "test.txt");
			const content = "Nested content";

			const result = await writeTool.execute("test-call-4", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
		});
	});

	describe("edit tool", () => {
		it("should replace text in file", async () => {
			const testFile = path.join(testDir, "edit-test.txt");
			const originalContent = "Hello, world!";
			fs.writeFileSync(testFile, originalContent);

			const result = await editTool.execute("test-call-5", {
				path: testFile,
				old_text: "world",
				new_text: "testing",
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			expect(result.details).toBeDefined();
			expect(result.details!.diff).toBeDefined();
			expect(typeof result.details!.diff).toBe("string");
			expect(result.details!.diff).toContain("testing");
		});

		it("should fail if text not found", async () => {
			const testFile = path.join(testDir, "edit-test.txt");
			const originalContent = "Hello, world!";
			fs.writeFileSync(testFile, originalContent);

			await expect(
				editTool.execute("test-call-6", {
					path: testFile,
					old_text: "nonexistent",
					new_text: "testing",
				}),
			).rejects.toThrow(/Could not find/);
		});

		it("should fail if text appears multiple times", async () => {
			const testFile = path.join(testDir, "edit-test.txt");
			const originalContent = "foo foo foo";
			fs.writeFileSync(testFile, originalContent);

			await expect(
				editTool.execute("test-call-7", {
					path: testFile,
					old_text: "foo",
					new_text: "bar",
				}),
			).rejects.toThrow(/Found 3 occurrences/);
		});

		it("should replace all occurrences with all: true", async () => {
			const testFile = path.join(testDir, "edit-all-test.txt");
			fs.writeFileSync(testFile, "foo bar foo baz foo");

			const result = await editTool.execute("test-all-1", {
				path: testFile,
				old_text: "foo",
				new_text: "qux",
				all: true,
			});

			expect(getTextOutput(result)).toContain("Successfully replaced 3 occurrences");
			const content = await Bun.file(testFile).text();
			expect(content).toBe("qux bar qux baz qux");
		});

		it("should reject all: true when multiple fuzzy matches are ambiguous", async () => {
			const testFile = path.join(testDir, "edit-all-fuzzy.txt");
			// File has two similar blocks with different indentation
			fs.writeFileSync(
				testFile,
				`function a() {
  if (x) {
    doThing();
  }
}
function b() {
    if (x) {
        doThing();
    }
}
`,
			);

			// With multiple fuzzy matches, the tool rejects for safety to avoid ambiguous replacements
			await expect(
				editTool.execute("test-all-fuzzy", {
					path: testFile,
					old_text: "if (x) {\n  doThing();\n}",
					new_text: "if (y) {\n  doOther();\n}",
					all: true,
				}),
			).rejects.toThrow(/Found 2 high-confidence matches/);
		});

		it("should fail with all: true if no matches found", async () => {
			const testFile = path.join(testDir, "edit-all-nomatch.txt");
			fs.writeFileSync(testFile, "hello world");

			await expect(
				editTool.execute("test-all-nomatch", {
					path: testFile,
					old_text: "nonexistent",
					new_text: "bar",
					all: true,
				}),
			).rejects.toThrow(/Could not find/);
		});

		it("should replace multiline text with all: true", async () => {
			const testFile = path.join(testDir, "edit-all-multiline.txt");
			fs.writeFileSync(testFile, "start\nfoo\nbar\nend\nstart\nfoo\nbar\nend");

			const result = await editTool.execute("test-all-multiline", {
				path: testFile,
				old_text: "foo\nbar",
				new_text: "replaced",
				all: true,
			});

			expect(getTextOutput(result)).toContain("Successfully replaced 2 occurrences");
			const content = await Bun.file(testFile).text();
			expect(content).toBe("start\nreplaced\nend\nstart\nreplaced\nend");
		});

		it("should work with all: true when only one occurrence exists", async () => {
			const testFile = path.join(testDir, "edit-all-single.txt");
			fs.writeFileSync(testFile, "hello world");

			const result = await editTool.execute("test-all-single", {
				path: testFile,
				old_text: "world",
				new_text: "universe",
				all: true,
			});

			expect(getTextOutput(result)).toContain("Successfully replaced text");
			const content = await Bun.file(testFile).text();
			expect(content).toBe("hello universe");
		});
	});

	describe("bash tool", () => {
		it("should execute simple commands", async () => {
			const result = await bashTool.execute("test-call-8", { command: "echo 'test output'" });

			expect(getTextOutput(result)).toContain("test output");
			expect(result.details).toBeUndefined();
		});

		it("should handle command errors", async () => {
			await expect(bashTool.execute("test-call-9", { command: "exit 1" })).rejects.toThrow(
				/(Command failed|code 1)/,
			);
		});

		it("should respect timeout", async () => {
			await expect(bashTool.execute("test-call-10", { command: "sleep 5", timeout: 1 })).rejects.toThrow(
				/timed out/i,
			);
		});

		it("should throw error when cwd does not exist", async () => {
			const nonexistentCwd = "/this/directory/definitely/does/not/exist/12345";

			const bashToolWithBadCwd = new BashTool(createTestToolSession(nonexistentCwd));

			await expect(bashToolWithBadCwd.execute("test-call-11", { command: "echo test" })).rejects.toThrow(
				/Working directory does not exist/,
			);
		});

		it("should handle process spawn errors", async () => {
			const getShellConfigSpy = vi.spyOn(shellModule, "getShellConfig").mockResolvedValueOnce({
				shell: "/nonexistent-shell-path-xyz123",
				args: ["-c"],
				env: {},
				prefix: undefined,
			});

			const bashWithBadShell = new BashTool(createTestToolSession(testDir));

			await expect(bashWithBadShell.execute("test-call-12", { command: "echo test" })).rejects.toThrow(/ENOENT/);

			getShellConfigSpy.mockRestore();
		});
	});

	describe("grep tool", () => {
		it("should include filename when searching a single file", async () => {
			const testFile = path.join(testDir, "example.txt");
			fs.writeFileSync(testFile, "first line\nmatch line\nlast line");

			const result = await grepTool.execute("test-call-11", {
				pattern: "match",
				path: testFile,
			});

			const output = getTextOutput(result);
			expect(output).toContain("example.txt:2: match line");
		});

		it("should respect global limit and include context lines", async () => {
			const testFile = path.join(testDir, "context.txt");
			const content = ["before", "match one", "after", "middle", "match two", "after two"].join("\n");
			fs.writeFileSync(testFile, content);

			const result = await grepTool.execute("test-call-12", {
				pattern: "match",
				path: testFile,
				limit: 1,
				context: 1,
			});

			const output = getTextOutput(result);
			expect(output).toContain("context.txt-1- before");
			expect(output).toContain("context.txt:2: match one");
			expect(output).toContain("context.txt-3- after");
			expect(output).toContain("[1 matches limit reached. Use limit=2 for more]");
			// Ensure second match is not present
			expect(output).not.toContain("match two");
		});
	});

	describe("find tool", () => {
		it("should include hidden files that are not gitignored", async () => {
			const hiddenDir = path.join(testDir, ".secret");
			fs.mkdirSync(hiddenDir);
			fs.writeFileSync(path.join(hiddenDir, "hidden.txt"), "hidden");
			fs.writeFileSync(path.join(testDir, "visible.txt"), "visible");

			const result = await findTool.execute("test-call-13", {
				pattern: "**/*.txt",
				path: testDir,
				hidden: true,
			});

			const outputLines = getTextOutput(result)
				.split("\n")
				.map(line => line.trim())
				.filter(Boolean);

			expect(outputLines).toContain("visible.txt");
			expect(outputLines).toContain(".secret/hidden.txt");
		});

		it("should respect .gitignore", async () => {
			fs.writeFileSync(path.join(testDir, ".gitignore"), "ignored.txt\n");
			fs.writeFileSync(path.join(testDir, "ignored.txt"), "ignored");
			fs.writeFileSync(path.join(testDir, "kept.txt"), "kept");

			const result = await findTool.execute("test-call-14", {
				pattern: "**/*.txt",
				path: testDir,
			});

			const output = getTextOutput(result);
			expect(output).toContain("kept.txt");
			expect(output).not.toContain("ignored.txt");
		});
	});

	describe("ls tool", () => {
		it("should list dotfiles and directories", async () => {
			fs.writeFileSync(path.join(testDir, ".hidden-file"), "secret");
			fs.mkdirSync(path.join(testDir, ".hidden-dir"));

			const result = await lsTool.execute("test-call-15", { path: testDir });
			const output = getTextOutput(result);

			expect(output).toContain(".hidden-file");
			expect(output).toContain(".hidden-dir/");
		});
	});
});

describe("edit tool CRLF handling", () => {
	let testDir: string;
	let editTool: EditTool;
	let originalEditVariant: string | undefined;

	beforeEach(() => {
		// Force replace mode for edit tool tests using old_text/new_text
		originalEditVariant = process.env.OMP_EDIT_VARIANT;
		process.env.OMP_EDIT_VARIANT = "replace";

		testDir = path.join(os.tmpdir(), `coding-agent-crlf-test-${nanoid()}`);
		fs.mkdirSync(testDir, { recursive: true });
		editTool = new EditTool(createTestToolSession(testDir));
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });

		// Restore original edit variant
		if (originalEditVariant === undefined) {
			delete process.env.OMP_EDIT_VARIANT;
		} else {
			process.env.OMP_EDIT_VARIANT = originalEditVariant;
		}
	});

	it("should match LF old_text against CRLF file content", async () => {
		const testFile = path.join(testDir, "crlf-test.txt");

		fs.writeFileSync(testFile, "line one\r\nline two\r\nline three\r\n");

		const result = await editTool.execute("test-crlf-1", {
			path: testFile,
			old_text: "line two\n",
			new_text: "replaced line\n",
		});

		expect(getTextOutput(result)).toContain("Successfully replaced");
	});

	it("should preserve CRLF line endings after edit", async () => {
		const testFile = path.join(testDir, "crlf-preserve.txt");
		fs.writeFileSync(testFile, "first\r\nsecond\r\nthird\r\n");

		await editTool.execute("test-crlf-2", {
			path: testFile,
			old_text: "second\n",
			new_text: "REPLACED\n",
		});

		const content = await Bun.file(testFile).text();
		expect(content).toBe("first\r\nREPLACED\r\nthird\r\n");
	});

	it("should preserve LF line endings for LF files", async () => {
		const testFile = path.join(testDir, "lf-preserve.txt");
		fs.writeFileSync(testFile, "first\nsecond\nthird\n");

		await editTool.execute("test-lf-1", {
			path: testFile,
			old_text: "second\n",
			new_text: "REPLACED\n",
		});

		const content = await Bun.file(testFile).text();
		expect(content).toBe("first\nREPLACED\nthird\n");
	});

	it("should detect duplicates across CRLF/LF variants", async () => {
		const testFile = path.join(testDir, "mixed-endings.txt");

		fs.writeFileSync(testFile, "hello\r\nworld\r\n---\r\nhello\nworld\n");

		await expect(
			editTool.execute("test-crlf-dup", {
				path: testFile,
				old_text: "hello\nworld\n",
				new_text: "replaced\n",
			}),
		).rejects.toThrow(/Found 2 occurrences/);
	});

	// TODO: CRLF preservation broken by LSP formatting - fix later
	it.skip("should preserve UTF-8 BOM after edit", async () => {
		const testFile = path.join(testDir, "bom-test.txt");
		fs.writeFileSync(testFile, "\uFEFFfirst\r\nsecond\r\nthird\r\n");

		await editTool.execute("test-bom", {
			path: testFile,
			old_text: "second\n",
			new_text: "REPLACED\n",
		});

		const content = await Bun.file(testFile).text();
		expect(content).toBe("\uFEFFfirst\r\nREPLACED\r\nthird\r\n");
	});
});
