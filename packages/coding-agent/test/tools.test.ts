import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/patch";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { FindTool } from "@oh-my-pi/pi-coding-agent/tools/find";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { wrapToolWithMetaNotice } from "@oh-my-pi/pi-coding-agent/tools/output-meta";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import { Snowflake } from "@oh-my-pi/pi-utils";

// Helper to extract text from content blocks
function getTextOutput(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

let artifactCounter = 0;
function createTestToolSession(cwd: string): ToolSession {
	const sessionFile = path.join(cwd, "session.jsonl");
	const sessionDir = path.join(cwd, "session");
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => sessionFile,
		getSessionSpawns: () => "*",
		getArtifactsDir: () => sessionDir,
		allocateOutputArtifact: async (toolType: string) => {
			fs.mkdirSync(sessionDir, { recursive: true });
			const id = `artifact-${++artifactCounter}`;
			return { id, path: path.join(sessionDir, `${id}.${toolType}.log`) };
		},
		settings: Settings.isolated(),
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
	let originalEditVariant: string | undefined;

	beforeEach(() => {
		// Force replace mode for edit tool tests using old_text/new_text
		originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "replace";

		// Create a unique temporary directory for each test
		testDir = path.join(os.tmpdir(), `coding-agent-test-${Snowflake.next()}`);
		fs.mkdirSync(testDir, { recursive: true });

		// Create tools for this test directory
		const session = createTestToolSession(testDir);
		readTool = wrapToolWithMetaNotice(new ReadTool(session));
		writeTool = wrapToolWithMetaNotice(new WriteTool(session));
		editTool = wrapToolWithMetaNotice(new EditTool(session));
		bashTool = wrapToolWithMetaNotice(new BashTool(session));
		grepTool = wrapToolWithMetaNotice(new GrepTool(session));
		findTool = wrapToolWithMetaNotice(new FindTool(session));
	});

	afterEach(() => {
		// Clean up test directory
		fs.rmSync(testDir, { recursive: true, force: true });

		// Restore original edit variant
		if (originalEditVariant === undefined) {
			delete Bun.env.PI_EDIT_VARIANT;
		} else {
			Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
	});

	describe("read tool", () => {
		it("should read file contents that fit within limits", async () => {
			const testFile = path.join(testDir, "test.txt");
			const content = "Hello, world!\nLine 2\nLine 3";
			fs.writeFileSync(testFile, content);

			const result = await readTool.execute("test-call-1", { path: testFile });

			const output = getTextOutput(result);
			expect(output).toContain("Hello, world!");
			expect(output).toContain("Line 2");
			expect(output).toContain("Line 3");
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

		it("should stream output updates", async () => {
			const updates: string[] = [];
			const result = await bashTool.execute(
				"test-call-8-stream",
				{ command: "for i in 1 2 3; do echo $i; sleep 0.2; done" },
				undefined,
				update => {
					const text = update.content?.find(c => c.type === "text")?.text ?? "";
					updates.push(text);
				},
			);

			expect(updates.length).toBeGreaterThan(1);
			expect(getTextOutput(result)).toContain("1");
			expect(getTextOutput(result)).toContain("3");
		});

		it("should persist environment variables between commands", async () => {
			if (process.platform === "win32" || Bun.env.PI_SHELL_PERSIST !== "1") {
				return;
			}

			await bashTool.execute("test-call-8-env-set", { command: "export PI_TEST_VAR=hello" });
			const result = await bashTool.execute("test-call-8-env-get", { command: "echo $PI_TEST_VAR" });
			expect(getTextOutput(result)).toContain("hello");
		});

		it("should write truncated output to artifacts", async () => {
			const result = await bashTool.execute("test-call-8-artifact", {
				command: "printf 'a%.0s' {1..60000}",
			});

			const artifactId = result.details?.meta?.truncation?.artifactId;
			expect(artifactId).toBeDefined();
			if (artifactId) {
				const artifactPath = path.join(testDir, "session", `${artifactId}.bash.log`);
				expect(fs.existsSync(artifactPath)).toBe(true);
			}
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

		it("should abort and recover for subsequent commands", async () => {
			const controller = new AbortController();
			const promise = bashTool.execute("test-call-10-abort", { command: "sleep 5" }, controller.signal);
			await Bun.sleep(200);
			controller.abort("test abort");
			await expect(promise).rejects.toThrow(/abort|cancel|timed out/i);

			const result = await bashTool.execute("test-call-10-after-abort", { command: "echo ok" });
			expect(getTextOutput(result)).toContain("ok");
		});

		it("should throw error when cwd does not exist", async () => {
			const nonexistentCwd = "/this/directory/definitely/does/not/exist/12345";

			const bashToolWithBadCwd = new BashTool(createTestToolSession(nonexistentCwd));

			await expect(bashToolWithBadCwd.execute("test-call-11", { command: "echo test" })).rejects.toThrow(
				/Working directory does not exist/,
			);
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
			expect(output).not.toContain("# example.txt");
			expect(output).toMatch(/>>\s*2#[ZPMQVRWSNKTXJBYH]{2}:match line/);
		});

		it("should respect global limit and include context lines", async () => {
			const testFile = path.join(testDir, "context.txt");
			const content = ["before", "match one", "after", "middle", "match two", "after two"].join("\n");
			fs.writeFileSync(testFile, content);

			const result = await grepTool.execute("test-call-12", {
				pattern: "match",
				path: testFile,
				limit: 1,
				pre: 1,
				post: 1,
			});

			const output = getTextOutput(result);
			expect(output).not.toContain("# context.txt");
			expect(output).toMatch(/\b1#[ZPMQVRWSNKTXJBYH]{2}:before/);
			expect(output).toMatch(/>>\s*2#[ZPMQVRWSNKTXJBYH]{2}:match one/);
			expect(output).toMatch(/\b3#[ZPMQVRWSNKTXJBYH]{2}:after/);
			expect(output).toContain("[1 matches limit reached. Use limit=2 for more]");
			// Ensure second match is not present
			expect(output).not.toContain("match two");
		});

		it("should group multi-file matches and distribute limit with round-robin", async () => {
			for (let i = 1; i <= 3; i++) {
				fs.writeFileSync(path.join(testDir, `file-${i}.txt`), `needle in file ${i}\nextra needle ${i}`);
			}
			fs.writeFileSync(path.join(testDir, "dominant.txt"), "needle a\nneedle b\nneedle c\nneedle d");

			const result = await grepTool.execute("test-call-13-round-robin", {
				pattern: "needle",
				path: testDir,
				limit: 4,
			});

			const output = getTextOutput(result);
			expect(output).toContain("# file-1.txt");
			expect(output).toContain("# file-2.txt");
			expect(output).toContain("# file-3.txt");
			expect(output).toContain("# dominant.txt");
			expect(output).not.toContain("# .");
			expect(output).toContain("[4 matches limit reached. Use limit=8 for more]");
			expect(result.details?.fileCount).toBe(4);
			expect(result.details?.matchCount).toBe(4);
		});

		it("should not repeat file headings when round-robin selects multiple matches per file", async () => {
			fs.writeFileSync(path.join(testDir, "alpha.txt"), "needle a1\nneedle a2\nneedle a3");
			fs.writeFileSync(path.join(testDir, "beta.txt"), "needle b1\nneedle b2\nneedle b3");

			const result = await grepTool.execute("test-call-14-grouped-headings", {
				pattern: "needle",
				path: testDir,
				limit: 4,
			});

			const output = getTextOutput(result);
			const alphaHeadings = output.match(/# alpha\.txt/g)?.length ?? 0;
			const betaHeadings = output.match(/# beta\.txt/g)?.length ?? 0;
			expect(alphaHeadings).toBe(1);
			expect(betaHeadings).toBe(1);
			expect(result.details?.fileMatches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "alpha.txt", count: 2 }),
					expect.objectContaining({ path: "beta.txt", count: 2 }),
				]),
			);
		});

		it("should group files under directory headings", async () => {
			const nestedDir = path.join(testDir, "packages", "ai");
			fs.mkdirSync(nestedDir, { recursive: true });
			fs.writeFileSync(path.join(nestedDir, "CHANGELOG.md"), "Claude Opus\n");
			fs.writeFileSync(path.join(nestedDir, "models.json"), '{ "name": "Claude Opus" }\n');

			const result = await grepTool.execute("test-call-15-directory-headings", {
				pattern: "Claude Opus",
				path: testDir,
			});

			const output = getTextOutput(result);
			expect(output).toContain("# packages/ai");
			expect(output).toContain("## └─ CHANGELOG.md");
			expect(output).toContain("## └─ models.json");
			expect(result.details?.fileCount).toBeGreaterThanOrEqual(2);
		});

		it("should apply default limit of 20 when limit is not provided", async () => {
			const lines = Array.from({ length: 60 }, (_, i) => `needle ${i + 1}`);
			fs.writeFileSync(path.join(testDir, "default-limit.txt"), lines.join("\n"));

			const result = await grepTool.execute("test-call-14-default-limit", {
				pattern: "needle",
				path: testDir,
			});

			const output = getTextOutput(result);
			expect(output).toContain("[20 matches limit reached. Use limit=40 for more]");
			expect(result.details?.matchCount).toBe(20);
			expect(result.details?.matchLimitReached).toBe(20);
		});
	});

	describe("find tool", () => {
		it("should return a single file when given a file path", async () => {
			const testFile = path.join(testDir, "single.txt");
			fs.writeFileSync(testFile, "single");

			const result = await findTool.execute("test-call-13a", {
				pattern: testFile,
			});

			const outputLines = getTextOutput(result)
				.split("\n")
				.map(line => line.trim())
				.filter(Boolean);

			expect(outputLines).toEqual(["single.txt"]);
		});

		it("should include hidden files that are not gitignored", async () => {
			const hiddenDir = path.join(testDir, ".secret");
			fs.mkdirSync(hiddenDir);
			fs.writeFileSync(path.join(hiddenDir, "hidden.txt"), "hidden");
			fs.writeFileSync(path.join(testDir, "visible.txt"), "visible");

			const result = await findTool.execute("test-call-13", {
				pattern: `${testDir}/**/*.txt`,
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
			fs.mkdirSync(path.join(testDir, ".git"));
			fs.writeFileSync(path.join(testDir, ".gitignore"), "ignored.txt\n");
			fs.writeFileSync(path.join(testDir, "ignored.txt"), "ignored");
			fs.writeFileSync(path.join(testDir, "kept.txt"), "kept");

			const result = await findTool.execute("test-call-14", {
				pattern: `${testDir}/**/*.txt`,
			});

			const output = getTextOutput(result);
			expect(output).toContain("kept.txt");
			expect(output).not.toContain("ignored.txt");
		});
	});
});

describe("edit tool CRLF handling", () => {
	let testDir: string;
	let editTool: EditTool;
	let originalEditVariant: string | undefined;

	beforeEach(() => {
		// Force replace mode for edit tool tests using old_text/new_text
		originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "replace";

		testDir = path.join(os.tmpdir(), `coding-agent-crlf-test-${Snowflake.next()}`);
		fs.mkdirSync(testDir, { recursive: true });
		editTool = new EditTool(createTestToolSession(testDir));
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });

		// Restore original edit variant
		if (originalEditVariant === undefined) {
			delete Bun.env.PI_EDIT_VARIANT;
		} else {
			Bun.env.PI_EDIT_VARIANT = originalEditVariant;
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

	it("should delete file in hashline mode with delete:true", async () => {
		const originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "hashline";

		const hashDir = path.join(os.tmpdir(), `coding-agent-hashline-delete-${Snowflake.next()}`);
		fs.mkdirSync(hashDir, { recursive: true });
		const testFile = path.join(hashDir, "delete-me.txt");
		fs.writeFileSync(testFile, "to be deleted\n");

		try {
			const session = createTestToolSession(hashDir);
			const hashlineEditTool = new EditTool(session);
			const result = await hashlineEditTool.execute("hashline-delete-1", {
				path: testFile,
				edits: [],
				delete: true,
			});

			expect(getTextOutput(result)).toContain("Deleted");
			expect(fs.existsSync(testFile)).toBe(false);
		} finally {
			fs.rmSync(hashDir, { recursive: true, force: true });
			if (originalEditVariant === undefined) delete Bun.env.PI_EDIT_VARIANT;
			else Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
	});

	it("should rename file in hashline mode with rename", async () => {
		const originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "hashline";

		const hashDir = path.join(os.tmpdir(), `coding-agent-hashline-rename-${Snowflake.next()}`);
		fs.mkdirSync(hashDir, { recursive: true });
		const sourceFile = path.join(hashDir, "source.txt");
		const targetFile = path.join(hashDir, "moved", "target.txt");
		fs.writeFileSync(sourceFile, "unchanged content\n");

		try {
			const session = createTestToolSession(hashDir);
			const hashlineEditTool = new EditTool(session);
			const result = await hashlineEditTool.execute("hashline-rename-1", {
				path: sourceFile,
				edits: [],
				rename: targetFile,
			});

			expect(getTextOutput(result)).toContain("Updated and moved");
			expect(fs.existsSync(sourceFile)).toBe(false);
			expect(fs.existsSync(targetFile)).toBe(true);
			expect(await Bun.file(targetFile).text()).toBe("unchanged content\n");
		} finally {
			fs.rmSync(hashDir, { recursive: true, force: true });
			if (originalEditVariant === undefined) delete Bun.env.PI_EDIT_VARIANT;
			else Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
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
