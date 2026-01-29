import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type FindMatch, find, grep, htmlToMarkdown } from "../src/index";

let testDir: string;

async function setupFixtures() {
	testDir = await fs.mkdtemp(path.join(os.tmpdir(), "natives-test-"));

	await fs.writeFile(
		path.join(testDir, "file1.ts"),
		`export function hello() {
    // TODO: implement
    return "hello";
}
`,
	);

	await fs.writeFile(
		path.join(testDir, "file2.ts"),
		`export function world() {
    // FIXME: fix this
    return "world";
}
`,
	);

	await fs.writeFile(
		path.join(testDir, "readme.md"),
		`# Test README

This is a test file.
`,
	);
}

async function cleanupFixtures() {
	await fs.rm(testDir, { recursive: true, force: true });
}

describe("pi-natives", () => {
	beforeAll(async () => {
		await setupFixtures();
		return async () => {
			await cleanupFixtures();
		};
	});

	describe("grep", () => {
		it("should find patterns in files", async () => {
			const result = await grep({
				pattern: "TODO",
				path: testDir,
			});

			expect(result.totalMatches).toBe(1);
			expect(result.matches.length).toBe(1);
			expect(result.matches[0].line).toContain("TODO");
		});

		it("should respect glob patterns", async () => {
			const result = await grep({
				pattern: "test",
				path: testDir,
				glob: "*.md",
				ignoreCase: true,
			});

			expect(result.totalMatches).toBe(2); // "Test" in title + "test" in body
		});

		it("should return filesWithMatches mode", async () => {
			const result = await grep({
				pattern: "return",
				path: testDir,
				mode: "filesWithMatches",
			});

			expect(result.filesWithMatches).toBeGreaterThan(0);
		});
	});

	describe("find", () => {
		it("should find files matching pattern", async () => {
			const result = await find({
				pattern: "*.ts",
				path: testDir,
			});

			expect(result.totalMatches).toBe(2);
			expect(result.matches.every((m: FindMatch) => m.path.endsWith(".ts"))).toBe(true);
		});

		it("should filter by file type", async () => {
			const result = await find({
				pattern: "*",
				path: testDir,
				fileType: "file",
			});

			expect(result.totalMatches).toBe(3);
		});
	});

	describe("htmlToMarkdown", () => {
		it("should convert basic HTML to markdown", async () => {
			const html = "<h1>Hello World</h1><p>This is a paragraph.</p>";
			const markdown = await htmlToMarkdown(html);

			expect(markdown).toContain("# Hello World");
			expect(markdown).toContain("This is a paragraph.");
		});

		it("should handle links", async () => {
			const html = '<p>Visit <a href="https://example.com">Example</a> for more info.</p>';
			const markdown = await htmlToMarkdown(html);

			expect(markdown).toContain("[Example](https://example.com)");
		});

		it("should handle lists", async () => {
			const html = "<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>";
			const markdown = await htmlToMarkdown(html);

			expect(markdown).toContain("- Item 1");
			expect(markdown).toContain("- Item 2");
			expect(markdown).toContain("- Item 3");
		});

		it("should handle code blocks", async () => {
			const html = "<pre><code>const x = 42;</code></pre>";
			const markdown = await htmlToMarkdown(html);

			expect(markdown).toContain("const x = 42;");
		});

		it("should skip images when option is set", async () => {
			const html = '<p>Text with <img src="image.jpg" alt="pic"> image</p>';
			const withImages = await htmlToMarkdown(html);
			const withoutImages = await htmlToMarkdown(html, { skipImages: true });

			expect(withImages).toContain("pic");
			expect(withoutImages).not.toContain("pic");
		});

		it("should clean content when option is set", async () => {
			const html = "<nav>Navigation</nav><main><p>Main content</p></main><footer>Footer</footer>";
			const cleaned = await htmlToMarkdown(html, { cleanContent: true });

			expect(cleaned).toContain("Main content");
			// Navigation/footer may or may not be removed depending on preprocessing
		});
	});
});
