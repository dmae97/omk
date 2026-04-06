import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getLanguageFromPath } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { EditTool } from "@oh-my-pi/pi-coding-agent/patch";
import { HASHLINE_NIBBLE_ALPHABET } from "@oh-my-pi/pi-coding-agent/patch/hashline";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { resolveFileDisplayMode } from "@oh-my-pi/pi-coding-agent/utils/file-display-mode";
import { parseChunkTree } from "@oh-my-pi/pi-natives";
import { applyChunkEdits } from "../../src/tools/chunk-tree";

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
	};
}

function getChunkChecksum(source: string, language: string, chunkPath: string): string {
	const chunk = parseChunkTree(source, language).chunks.find(candidate => candidate.path === chunkPath);
	if (!chunk) {
		throw new Error(`Chunk not found in fixture: ${chunkPath}`);
	}
	return chunk.checksum;
}

function buildLargeTypescriptFixture(): string {
	const body = Array.from({ length: 60 }, (_, index) => `      total += ${index};`).join("\n");
	return `class Server {\n  private handleError(err: Error): string {\n    let total = 0;\n${body}\n    return err.message + total;\n  }\n}\n\nfunction main(): void {\n  console.log("boot");\n}\n`;
}

describe("chunk mode tools", () => {
	let tmpDir: string;
	let originalEditVariant: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-mode-test-"));
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: tmpDir });
		originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "chunk";
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetSettingsForTest();
		if (originalEditVariant === undefined) {
			delete Bun.env.PI_EDIT_VARIANT;
		} else {
			Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
	});

	it("reads a TypeScript file as a chunk listing in chunk mode", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-root", { path: filePath });
		const text = getText(result);

		expect(text).toContain("server.ts  ·");
		expect(text).toContain(":class_Server#");
		expect(text).toContain(":fn_main#");
		expect(text).not.toContain("ck:");
	});

	it("disables hashline display mode across shared tool renderers in chunk mode", () => {
		const displayMode = resolveFileDisplayMode(createSession(tmpDir));

		expect(displayMode.hashLines).toBe(false);
		expect(displayMode.lineNumbers).toBe(false);
	});

	it("reads a specific chunk path and previews large child leaves inline", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-branch", { path: `${filePath}:class_Server.fn_handleError` });
		const text = getText(result);

		expect(text).not.toContain("to expand ⋮");
		expect(text).toContain("let total = 0;");
		expect(text).toContain("29 │       total += 25;");
		expect(text).toContain("return err.message + total;");
	});

	it("renders line-range reads as range-scoped chunk output", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-lines", { path: filePath, sel: "L2-L4" });
		const text = getText(result);

		expect(text).toContain("[Notice: chunk view scoped to requested lines L2-L4; non-overlapping lines omitted.]");
		expect(text).toContain("server.ts  ·");
		expect(text).toContain(".fn_handleError#");
		expect(text).toContain(".var_total#");
		expect(text).toContain("3 │");
		expect(text).toContain("4 │");
		expect(text).not.toContain("⋯");
	});

	it("supports L selectors in the path fragment in chunk mode", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-lines-in-path", { path: `${filePath}:L2-L4` });
		const text = getText(result);

		expect(text).toContain("[Notice: chunk view scoped to requested lines L2-L4; non-overlapping lines omitted.]");
		expect(text).toContain("server.ts  ·");
		expect(text).toContain(".fn_handleError#");
		expect(text).toContain(".var_total#");
		expect(text).toContain(".var_total#");
		expect(text).toContain("3 │");
	});

	it("ignores a chunk selector checksum suffix on read", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const staleChecksum = getChunkChecksum(originalSource, "typescript", "class_Server.fn_handleError");
		await Bun.write(filePath, originalSource.replace("    return err.message + total;", "    return err.message;"));
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-stale-checksum", {
			path: `${filePath}:class_Server.fn_handleError#${staleChecksum}`,
		});
		const text = getText(result);

		expect(text).toContain("server.ts:class_Server.fn_handleError  ·");
		expect(text).not.toContain("[Warning: checksum #");
	});

	it("routes .tsx files to the TSX grammar in chunk mode", async () => {
		const filePath = path.join(tmpDir, "component.tsx");
		await Bun.write(filePath, 'export function App() { return <div className="ok">ok</div>; }\n');
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-tsx", { path: filePath });
		const text = getText(result);

		expect(text).toContain("component.tsx  ·");
		expect(text).toContain("tsx");
		expect(text).toContain(":fn_App#");
	});

	it("maps Handlebars and TLA+ file extensions for chunk mode", () => {
		expect(getLanguageFromPath("/tmp/template.hbs")).toBe("handlebars");
		expect(getLanguageFromPath("/tmp/template.hsb")).toBe("handlebars");
		expect(getLanguageFromPath("/tmp/spec.tla")).toBe("tlaplus");
		expect(getLanguageFromPath("/tmp/spec.tlaplus")).toBe("tlaplus");
	});

	it("annotates grep hits with chunk paths", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new GrepTool(createSession(tmpDir));

		const result = await tool.execute("chunk-grep", {
			pattern: "err\\.message",
			path: filePath,
		});
		const text = getText(result);

		expect(text).toContain("server.ts:class_Server.fn_handleError");
		expect(text).toContain("ln:");
		expect(text).toContain("err.message");
	});

	it("replaces a chunk using a copied selector in path", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const session = createSession(tmpDir);
		const readTool = new ReadTool(session);
		const editTool = new EditTool(session);

		const branchRead = await readTool.execute("chunk-read-before-edit", {
			path: `${filePath}:class_Server.fn_handleError`,
		});
		const branchText = getText(branchRead);
		const checksum = new RegExp(
			`server\\.ts:class_Server\\.fn_handleError[^\n]*#([${HASHLINE_NIBBLE_ALPHABET}]{4})`,
			"i",
		).exec(branchText)?.[1];
		expect(checksum).toBeDefined();

		const editResult = await editTool.execute("chunk-edit", {
			path: `${filePath}:class_Server.fn_handleError`,
			crc: checksum,
			operations: [
				{
					replace: {
						content: `  private handleError(err: Error): string {
    return \`normalized:\${err.message}\`;
  }
`,
					},
				},
			],
		} as never);
		const editText = getText(editResult);
		const updatedSource = await Bun.file(filePath).text();

		expect(updatedSource).toContain("normalized:");
		expect(updatedSource).not.toContain("total +=");
		expect(editText).toContain("server.ts  ·");
		expect(editText).toContain(":class_Server#");
	});

	it("applies omitted-sel batch splices when the second operation uses the post-first checksum", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const chunkPath = "class_Server.fn_handleError";
		const checksum = getChunkChecksum(originalSource, "typescript", chunkPath);
		const afterFirst = applyChunkEdits({
			source: originalSource,
			language: "typescript",
			cwd: tmpDir,
			filePath,
			operations: [
				{
					op: "replace",
					sel: chunkPath,
					crc: checksum,
					line: 63,
					endLine: 63,
					content: "return err.message.toUpperCase() + total;",
				},
			],
		}).diffSourceAfter;
		const checksum2 = getChunkChecksum(afterFirst, "typescript", chunkPath);

		await editTool.execute("chunk-edit-default-selector-batch", {
			path: `${filePath}:${chunkPath}`,
			crc: checksum,
			operations: [
				{
					replace: {
						line: 63,
						end_line: 63,
						content: "return err.message.toUpperCase() + total;",
					},
				},
				{
					replace: {
						crc: checksum2,
						line: 3,
						end_line: 3,
						content: "let total = 1;",
					},
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("let total = 1;");
		expect(updatedSource).toContain("return err.message.toUpperCase() + total;");
	});

	it("rejects L0 selector as invalid", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		await expect(tool.execute("chunk-read-L0", { path: filePath, sel: "L0" })).rejects.toThrow(
			/L0 is invalid.*1-indexed/,
		);
	});

	it("rejects reversed line range selector", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		await expect(tool.execute("chunk-read-reversed", { path: filePath, sel: "L30-L20" })).rejects.toThrow(
			/end must be >= start/,
		);
	});

	it("accepts string content for chunk insert operations", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);

		await editTool.execute("chunk-edit-string-content", {
			path: filePath,
			operations: [
				{
					append_child: {
						sel: "class_Server",
						content: 'status(): string {\n  return "ok";\n}\n',
					},
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("status(): string");
		expect(updatedSource).toContain('return "ok";');
	});

	it("supports explicit absolute-line zero-width splices", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const chunkPath = "class_Server.fn_handleError";
		const fileText = await Bun.file(filePath).text();
		const checksum = getChunkChecksum(fileText, "typescript", chunkPath);
		const afterInsertAfter = applyChunkEdits({
			source: fileText,
			language: "typescript",
			cwd: tmpDir,
			filePath,
			operations: [
				{
					op: "replace",
					sel: chunkPath,
					crc: checksum,
					line: 4,
					endLine: 3,
					content: "const end = Date.now();",
				},
			],
		}).diffSourceAfter;
		const checksum2 = getChunkChecksum(afterInsertAfter, "typescript", chunkPath);

		// Zero-width splices at larger `end` run first (bottom-up) so line numbers stay stable.
		await editTool.execute("chunk-edit-insert-lines", {
			path: filePath,
			operations: [
				{
					replace: {
						sel: chunkPath,
						crc: checksum,
						line: 4,
						end_line: 3,
						content: "const end = Date.now();",
					},
				},
				{
					replace: {
						sel: chunkPath,
						crc: checksum2,
						line: 3,
						end_line: 2,
						content: "const start = Date.now();",
					},
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("    const start = Date.now();");
		expect(updatedSource).toContain("    const end = Date.now();");
		expect(updatedSource).toContain("    let total = 0;");
	});

	it("treats empty replace content as delete", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "fn_main");

		await editTool.execute("chunk-edit-empty-replace-delete", {
			path: filePath,
			operations: [
				{
					replace: {
						sel: "fn_main",
						crc: checksum,
						content: "",
					},
				},
			],
		});

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).not.toContain("function main(): void");
	});

	it("returns structured status for missing chunk reads", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-missing", {
			path: `${filePath}:class_Server.fn_missing`,
		});

		expect(getText(result)).toContain("[Chunk not found]");
		expect(result.details?.chunk).toEqual({
			status: "not_found",
			selector: "class_Server.fn_missing",
		});
	});

	it("rejects reversed splice ranges without changing the file", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "class_Server.fn_handleError");

		await expect(
			editTool.execute("chunk-edit-invalid-splice-range", {
				path: filePath,
				operations: [
					{
						replace: {
							sel: "class_Server.fn_handleError",
							crc: checksum,
							line: 5,
							end_line: 2,
							content: "    let total = 1;",
						},
					},
				],
			}),
		).rejects.toThrow(/Invalid splice range L5-L2/);

		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("rolls back mixed-validity batches without changing the file", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);

		await expect(
			editTool.execute("chunk-edit-batch-rollback", {
				path: filePath,
				operations: [
					{
						append_child: {
							sel: "class_Server",
							content: '  status(): string {\n    return "ok";\n  }',
						},
					},
					{
						delete: {
							sel: "class_Server.fn_handleError",
							crc: "ZZZZ",
						},
					},
				],
			}),
		).rejects.toThrow(/No changes were saved/);

		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("leaves files unchanged when an edit is rejected for introducing parse errors", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "class_Server.fn_handleError");

		await expect(
			editTool.execute("chunk-edit-parse-reject", {
				path: filePath,
				operations: [
					{
						replace: {
							sel: "class_Server.fn_handleError",
							crc: checksum,
							content: "  private handleError(err: Error): string {\n    if (err) {\n",
						},
					},
				],
			}),
		).rejects.toThrow(/Parse errors:[\s\S]*L\d+:C\d+/i);

		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("reports stale mixed batches against the listed splice operation", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "class_Server.fn_handleError");

		await expect(
			editTool.execute("chunk-edit-stale-mixed-batch", {
				path: filePath,
				operations: [
					{
						replace: {
							sel: "class_Server.fn_handleError",
							crc: checksum,
							content: "  private handleError(err: Error): string {\n    return err.message;\n  }",
						},
					},
					{
						replace: {
							sel: "class_Server.fn_handleError",
							crc: checksum,
							line: 63,
							end_line: 63,
							content: "    return err.message.toUpperCase();",
						},
					},
				],
			}),
		).rejects.toThrow(
			/Edit operation 2\/2 failed \(replace on "class_Server\.fn_handleError"\): Chunk "class_Server\.fn_handleError" was changed by an earlier batch operation/,
		);

		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("rejects missing CRC", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);

		await expect(
			editTool.execute("chunk-edit-strong-crc", {
				path: filePath,
				operations: [
					{
						replace: {
							sel: "class_Server.fn_handleError",
							// no crc!
							line: 3,
							end_line: 3,
							content: "    let total = 1;",
						},
					} as never,
				],
			}),
		).rejects.toThrow(/Checksum required/);
		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("auto-resolves chunk selectors with missing name prefixes", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "fn_main");

		// Use bare "main" instead of "fn_main"
		const _result = await editTool.execute("chunk-edit-prefix-resolve", {
			path: filePath,
			operations: [
				{
					replace: {
						sel: "main",
						crc: checksum,
						content: 'function main(): void {\n  console.log("started");\n}\n',
					},
				},
			],
		});
		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain('console.log("started")');
		expect(updatedSource).not.toContain('console.log("boot")');
	});
});
