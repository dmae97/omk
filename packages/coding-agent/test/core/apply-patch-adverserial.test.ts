import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplyPatchError, applyPatch } from "../../src/core/tools/patch";

describe("applyPatch adversarial inputs", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `apply-patch-adversarial-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	test("rejects moveTo when it matches path", async () => {
		const filePath = join(tempDir, "same.txt");
		await Bun.write(filePath, "foo\n");

		await expect(
			applyPatch(
				{ path: "same.txt", operation: "update", moveTo: "same.txt", diff: "@@\n-foo\n+bar" },
				{ cwd: tempDir },
			),
		).rejects.toThrow(ApplyPatchError);

		expect(readFileSync(filePath, "utf-8")).toBe("foo\n");
	});

	test("respects changeContext for pure additions", async () => {
		const filePath = join(tempDir, "add-context.ts");
		await Bun.write(filePath, "function foo() {\n  return 1;\n}\nfunction bar() {\n  return 2;\n}\n");

		await applyPatch(
			{
				path: "add-context.ts",
				operation: "update",
				diff: "@@ function bar\n+  console.log('x');",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe(
			"function foo() {\n  return 1;\n}\nfunction bar() {\n  console.log('x');\n  return 2;\n}\n",
		);
	});

	test("rejects multi-file patch markers in a single-file update", async () => {
		const filePath = join(tempDir, "single.txt");
		await Bun.write(filePath, "foo\nbar\n");

		await expect(
			applyPatch(
				{
					path: "single.txt",
					operation: "update",
					diff: "*** Begin Patch\n*** Update File: single.txt\n@@\n-foo\n+FOO\n*** Update File: other.txt\n@@\n-bar\n+BAR\n*** End Patch",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(ApplyPatchError);
	});

	test("preserves context lines that look like diff metadata", async () => {
		const filePath = join(tempDir, "metadata-context.txt");
		await Bun.write(filePath, "diff --git a b\nalpha\nmid\ndiff --git a b\nalpha\n");

		await applyPatch(
			{
				path: "metadata-context.txt",
				operation: "update",
				diff: "@@\n diff --git a b\n-alpha\n+ALPHA",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("diff --git a b\nALPHA\nmid\ndiff --git a b\nalpha\n");
	});

	test("applies hunks regardless of order", async () => {
		const filePath = join(tempDir, "order.txt");
		await Bun.write(filePath, "first\nkeep\nsecond\nkeep\n");

		await applyPatch(
			{
				path: "order.txt",
				operation: "update",
				diff: "@@ second\n-keep\n+KEEP2\n@@ first\n-keep\n+KEEP1",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("first\nKEEP1\nsecond\nKEEP2\n");
	});

	test("rejects ambiguous changeContext matches", async () => {
		const filePath = join(tempDir, "ambiguous-context.ts");
		await Bun.write(filePath, "if (a) {\n  return foo;\n}\nif (b) {\n  return foo;\n}\n");

		await expect(
			applyPatch(
				{
					path: "ambiguous-context.ts",
					operation: "update",
					diff: "@@ return foo;\n-  return foo;\n+  return bar;",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(ApplyPatchError);
	});

	test("rejects ambiguous prefix/substring matches", async () => {
		const filePath = join(tempDir, "ambiguous-prefix.ts");
		await Bun.write(filePath, "const enabled = true;\nconst enabled = true; // secondary\n");

		await expect(
			applyPatch(
				{
					path: "ambiguous-prefix.ts",
					operation: "update",
					diff: "@@\n-const enabled = true\n+const enabled = false",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(ApplyPatchError);
	});

	test("rejects out-of-range line hints for insertions", async () => {
		const filePath = join(tempDir, "line-hint.txt");
		await Bun.write(filePath, "a\nb\n");

		await expect(
			applyPatch(
				{
					path: "line-hint.txt",
					operation: "update",
					diff: "@@ -999,0 +999,1 @@\n+tail",
				},
				{ cwd: tempDir },
			),
		).rejects.toThrow(ApplyPatchError);
	});

	test("retains trailing blank context lines for disambiguation", async () => {
		const filePath = join(tempDir, "blank-context.txt");
		await Bun.write(filePath, "section\nvalue\nx\nsection\nvalue\n\n");

		await applyPatch(
			{
				path: "blank-context.txt",
				operation: "update",
				diff: "@@\n section\n-value\n+VALUE\n ",
			},
			{ cwd: tempDir },
		);

		expect(readFileSync(filePath, "utf-8")).toBe("section\nvalue\nx\nsection\nVALUE\n\n");
	});

	test("preserves CRLF endings and trailing newline", async () => {
		const filePath = join(tempDir, "crlf.txt");
		await Bun.write(filePath, "foo\r\nbar\r\n");

		await applyPatch({ path: "crlf.txt", operation: "update", diff: "@@\n-foo\n+FOO" }, { cwd: tempDir });

		const content = readFileSync(filePath, "utf-8");
		expect(content).toBe("FOO\r\nbar\r\n");
	});

	test("preserves UTF-8 BOM and CRLF endings", async () => {
		const filePath = join(tempDir, "bom.txt");
		await Bun.write(filePath, "\uFEFFfoo\r\nbar\r\n");

		await applyPatch({ path: "bom.txt", operation: "update", diff: "@@\n-foo\n+FOO" }, { cwd: tempDir });

		const content = readFileSync(filePath, "utf-8");
		expect(content).toBe("\uFEFFFOO\r\nbar\r\n");
	});

	test("preserves missing trailing newline", async () => {
		const filePath = join(tempDir, "nonewline.txt");
		await Bun.write(filePath, "foo\nbar");

		await applyPatch({ path: "nonewline.txt", operation: "update", diff: "@@\n-bar\n+baz" }, { cwd: tempDir });

		const content = readFileSync(filePath, "utf-8");
		expect(content).toBe("foo\nbaz");
	});
});
