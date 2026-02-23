import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	FileType,
	fuzzyFind,
	type GlobMatch,
	glob,
	grep,
	htmlToMarkdown,
	invalidateFsScanCache,
	PtySession,
	sanitizeText,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "../src/index";

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

	await fs.writeFile(path.join(testDir, "history-search.ts"), "export const historySearch = true;\n");
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

		it("should treat unknown grep type filter as a strict extension filter", async () => {
			const result = await grep({
				pattern: "return",
				path: testDir,
				type: "definitelynotatype",
			});

			expect(result.totalMatches).toBe(0);
			expect(result.filesWithMatches).toBe(0);
		});
	});

	describe("fuzzyFind", () => {
		it("should match abbreviated fuzzy queries across separators", async () => {
			const result = await fuzzyFind({
				query: "histsr",
				path: testDir,
				hidden: true,
				gitignore: true,
				maxResults: 20,
			});

			expect(result.matches.some(match => match.path === "history-search.ts")).toBe(true);
		});
	});

	describe("find", () => {
		it("should find files matching pattern", async () => {
			const result = await glob({
				pattern: "*.ts",
				path: testDir,
			});

			expect(result.totalMatches).toBe(3);
			expect(result.matches.every((m: GlobMatch) => m.path.endsWith(".ts"))).toBe(true);
		});

		it("should filter by file type", async () => {
			const result = await glob({
				pattern: "*",
				path: testDir,
				fileType: FileType.File,
			});

			expect(result.totalMatches).toBe(4);
		});

		it("should invalidate scan cache when invalidateFsScanCache receives a relative path", async () => {
			await glob({ pattern: "*.ts", path: testDir, cache: true });
			const newFile = path.join(testDir, "newly-added.ts");
			await fs.writeFile(newFile, "export const newer = true;\n");

			const relativePath = path.relative(process.cwd(), newFile);
			invalidateFsScanCache(relativePath);

			const result = await glob({ pattern: "newly-added.ts", path: testDir, cache: true });
			expect(result.matches.some(match => match.path === "newly-added.ts")).toBe(true);
		});

		it("should avoid scan work when maxResults is zero", async () => {
			const result = await glob({
				pattern: "**/*",
				path: testDir,
				maxResults: 0,
			});

			expect(result.totalMatches).toBe(0);
			expect(result.matches).toHaveLength(0);
		});

		it("should fast-recheck empty cached results when threshold is reached", async () => {
			const fileName = "cache-empty-recheck-target.txt";
			const filePath = path.join(testDir, fileName);
			await fs.rm(filePath, { force: true });
			invalidateFsScanCache();
			const first = await glob({ pattern: fileName, path: testDir, hidden: true, gitignore: true, cache: true });
			expect(first.totalMatches).toBe(0);
			await fs.writeFile(filePath, "created after empty cached query\n");
			await Bun.sleep(250);
			const second = await glob({ pattern: fileName, path: testDir, hidden: true, gitignore: true, cache: true });
			expect(second.totalMatches).toBe(1);
		});
	});

	describe("text tab width", () => {
		it("uses default tab width and supports explicit overrides", () => {
			expect(visibleWidth("a\tb")).toBe(5);
			expect(visibleWidth("a\tb", 4)).toBe(6);
			expect(visibleWidth("a\tb", 2)).toBe(4);
		});

		it("applies explicit tab width in truncate and wrap", () => {
			expect(truncateToWidth("\tfoo", 6, undefined, false, 4)).toBe("\tf…");
			expect(wrapTextWithAnsi("\tfoo", 4, 4)).toEqual(["\t", "foo"]);
		});
	});

	describe("pty", () => {
		it("should time out detached background workloads without hanging", async () => {
			if (process.platform === "win32" || !Bun.which("bash")) {
				return;
			}

			const session = new PtySession();
			const started = Date.now();
			try {
				const outcome = await Promise.race([
					session
						.start(
							{
								command: 'bash -lc "set -m; sleep 30 & disown; sleep 30"',
								cwd: testDir,
								timeoutMs: 150,
								cols: 120,
								rows: 40,
							},
							undefined,
						)
						.then(result => ({ kind: "done" as const, result })),
					Bun.sleep(4000).then(() => ({ kind: "hang" as const })),
				]);

				expect(outcome.kind).toBe("done");
				if (outcome.kind !== "done") {
					return;
				}

				expect(outcome.result.timedOut).toBe(true);
				expect(Date.now() - started).toBeLessThan(4000);
			} finally {
				try {
					session.kill();
				} catch {}
			}
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

	describe("sanitizeText", () => {
		it("should strip ANSI, remove control chars and normalize CR", () => {
			const input = "\x1b[31mred\x1b[0m\ra\u0000b\tline\ncarriage\r\u0001\u0085";
			expect(sanitizeText(input)).toBe("redab\tline\ncarriage");
		});

		it("should remove lone surrogates but keep valid pairs", () => {
			expect(sanitizeText(`a\ud800b\udc00c`)).toBe("abc");
			const validPair = "a\u{1f600}b";
			expect(sanitizeText(validPair)).toBe(validPair);
		});

		it("should strip OSC sequences", () => {
			const input = "\x1b]0;title\x07hello";
			expect(sanitizeText(input)).toBe("hello");
		});
	});
});
