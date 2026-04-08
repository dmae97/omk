import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { HASHLINE_NIBBLE_ALPHABET } from "@oh-my-pi/pi-coding-agent/edit/line-hash";
import { getLanguageFromPath } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { resolveFileDisplayMode } from "@oh-my-pi/pi-coding-agent/utils/file-display-mode";
import { ChunkReadStatus, ChunkState } from "@oh-my-pi/pi-natives";
import { applyChunkEdits } from "../../src/edit/modes/chunk";

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
	const chunk = ChunkState.parse(source, language).chunk(chunkPath);
	if (!chunk) {
		throw new Error(`Chunk not found in fixture: ${chunkPath}`);
	}
	return chunk.checksum;
}

function buildLargeTypescriptFixture(): string {
	const body = Array.from({ length: 60 }, (_, index) => `      total += ${index};`).join("\n");
	return `class Server {\n  private handleError(err: Error): string {\n    let total = 0;\n${body}\n    return err.message + total;\n  }\n}\n\nfunction main(): void {\n  console.log("boot");\n}\n`;
}

function buildHandleErrorMethod(options: { totalInitLine?: string; returnLine?: string } = {}): string {
	const body = Array.from({ length: 60 }, (_, index) => `      total += ${index};`).join("\n");
	const totalInit = options.totalInitLine ?? "    let total = 0;";
	const ret = options.returnLine ?? "    return err.message + total;";
	return `  private handleError(err: Error): string {
${totalInit}
${body}
${ret}
  }`;
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

		expect(text).toContain("server.ts·");
		expect(text).toContain("class_Server#");
		expect(text).toContain("fn_main#");
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
		expect(text).toContain("server.ts:class_Server.fn_handleError·");
		expect(text).toContain("let total = 0;");
		expect(text).toContain("29| \t\t\ttotal += 25;");
		expect(text).toContain("return err.message + total;");
	});

	it("renders line-range reads as range-scoped chunk output", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-lines", { path: filePath, sel: "L2-L4" });
		const text = getText(result);

		expect(text).toContain("[Notice: chunk view scoped to requested lines L2-L4; non-overlapping lines omitted.]");
		expect(text).toContain("server.ts·");
		expect(text).toContain("class_Server.fn_handleError#");
		expect(text).toContain("class_Server.fn_handleError.var_total#");
		expect(text).toContain("3|");
		expect(text).toContain("4|");
		expect(text).not.toContain("⋯");
	});

	it("supports L selectors in the path fragment in chunk mode", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		await Bun.write(filePath, buildLargeTypescriptFixture());
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-lines-in-path", { path: `${filePath}:L2-L4` });
		const text = getText(result);

		expect(text).toContain("[Notice: chunk view scoped to requested lines L2-L4; non-overlapping lines omitted.]");
		expect(text).toContain("server.ts·");
		expect(text).toContain("class_Server.fn_handleError#");
		expect(text).toContain("class_Server.fn_handleError.var_total#");
		expect(text).toContain("3|");
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

		expect(text).toContain("server.ts:class_Server.fn_handleError·");
		expect(text).not.toContain("[Warning: checksum #");
	});

	it("routes .tsx files to the TSX grammar in chunk mode", async () => {
		const filePath = path.join(tmpDir, "component.tsx");
		await Bun.write(filePath, 'export function App() { return <div className="ok">ok</div>; }\n');
		const tool = new ReadTool(createSession(tmpDir));

		const result = await tool.execute("chunk-read-tsx", { path: filePath });
		const text = getText(result);

		expect(text).toContain("component.tsx·");
		expect(text).toContain("tsx");
		expect(text).toContain("fn_App#");
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
		expect(text).toContain(".ret>64|");
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
			path: filePath,
			edits: [
				{
					sel: `class_Server.fn_handleError#${checksum}`,
					op: "replace",
					content: `  private handleError(err: Error): string {
    return \`normalized:\${err.message}\`;
  }
`,
				},
			],
		} as never);
		const editText = getText(editResult);
		const updatedSource = await Bun.file(filePath).text();

		expect(updatedSource).toContain("normalized:");
		expect(updatedSource).not.toContain("total +=");
		expect(editText).toContain("server.ts·");
		expect(editText).toContain("@@ -3,62 +3,1 @@");
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
					sel: `${chunkPath}#${checksum}`,
					content: buildHandleErrorMethod({ returnLine: "    return err.message.toUpperCase() + total;" }),
				},
			],
		}).diffSourceAfter;
		const checksum2 = getChunkChecksum(afterFirst, "typescript", chunkPath);

		await editTool.execute("chunk-edit-default-selector-batch", {
			path: filePath,
			edits: [
				{
					sel: `${chunkPath}#${checksum}`,
					op: "replace",
					content: buildHandleErrorMethod({ returnLine: "    return err.message.toUpperCase() + total;" }),
				},
				{
					sel: `${chunkPath}#${checksum2}`,
					op: "replace",
					content: buildHandleErrorMethod({
						totalInitLine: "    let total = 1;",
						returnLine: "    return err.message.toUpperCase() + total;",
					}),
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
			edits: [
				{
					sel: "class_Server@body",
					op: "append",
					content: 'status(): string {\n  return "ok";\n}\n',
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("status(): string");
		expect(updatedSource).toContain('return "ok";');
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
			edits: [{ sel: `fn_main#${checksum}`, op: "replace", content: "" }],
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

		expect(getText(result)).toContain("Chunk path not found");
		expect(result.details?.chunk).toEqual({
			status: ChunkReadStatus.NotFound,
			selector: "class_Server.fn_missing",
		});
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
				edits: [
					{ sel: "class_Server", op: "append", content: '  status(): string {\n    return "ok";\n  }' },
					{ sel: "class_Server.fn_handleError#ZZZZ", op: "replace", content: "" },
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
				edits: [
					{
						sel: `class_Server.fn_handleError#${checksum}`,
						op: "replace",
						content: "  private handleError(err: Error): string {\n    if (err) {\n",
					},
				],
			}),
		).rejects.toThrow(/Parse errors:[\s\S]*L\d+-L\d+.*parse error introduced/i);

		expect(await Bun.file(filePath).text()).toBe(originalSource);
	});

	it("auto-accepts stale CRC in mixed batches on the same chunk", async () => {
		const filePath = path.join(tmpDir, "server.ts");
		const originalSource = buildLargeTypescriptFixture();
		await Bun.write(filePath, originalSource);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const checksum = getChunkChecksum(originalSource, "typescript", "class_Server.fn_handleError");

		const _result = await editTool.execute("chunk-edit-stale-mixed-batch", {
			path: filePath,
			edits: [
				{
					sel: `class_Server.fn_handleError#${checksum}`,
					op: "replace",
					content: "  private handleError(err: Error): string {\n    return err.message;\n  }",
				},
				{
					sel: `class_Server.fn_handleError#${checksum}`,
					op: "replace",
					content: "  private handleError(err: Error): string {\n    return err.message.toUpperCase();\n  }",
				},
			],
		});

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("toUpperCase");
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
				edits: [
					{
						sel: "class_Server.fn_handleError",
						op: "replace",
						content: buildHandleErrorMethod({ totalInitLine: "    let total = 1;" }),
					},
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
			edits: [
				{
					sel: `main#${checksum}`,
					op: "replace",
					content: 'function main(): void {\n  console.log("started");\n}\n',
				},
			],
		});
		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain('console.log("started")');
		expect(updatedSource).not.toContain('console.log("boot")');
	});

	it("preserves sibling headings when replacing a whole markdown section", async () => {
		const filePath = path.join(tmpDir, "CONTRIBUTING.md");
		const source = [
			"# Contributing to uLua",
			"",
			"## Building and Testing",
			"",
			"```bash",
			"cmake -S . -B build",
			"```",
			"",
			"## Code Style",
			"",
			"- Follow .clang-format.",
			"",
			"## Commit Messages",
			"",
			"- Use imperative mood.",
			"",
		].join("\n");
		await Bun.write(filePath, source);
		const session = createSession(tmpDir);
		const editTool = new EditTool(session);
		const language = getLanguageFromPath(filePath);
		if (!language) {
			throw new Error("expected markdown language");
		}
		const state = ChunkState.parse(source, language);
		const building = state
			.chunks()
			.find(chunk => chunk.path === "section_Contributing_to_uLua.section_Building_and_Testing");
		if (!building) {
			throw new Error("expected section_Building_and_Testing chunk");
		}

		await editTool.execute("chunk-edit-section-replace", {
			path: filePath,
			edits: [
				{
					sel: `${building.path}#${building.checksum}`,
					op: "replace",
					content: "## Building and Testing\n\nUse `just verify` instead. It wraps cmake and ctest.\n",
				},
			],
		});

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("## Code Style");
		expect(updatedSource).toContain("## Commit Messages");
		expect(updatedSource).toContain("Use `just verify`");
		expect(updatedSource).not.toContain("cmake -S . -B build");
	});

	it("reads a Jupyter notebook as cell-based chunks in chunk mode", async () => {
		const filePath = path.join(tmpDir, "analysis.ipynb");
		const notebook = JSON.stringify(
			{
				cells: [
					{
						cell_type: "code",
						source: ["def greet(name):\n", "    return f'Hello {name}'\n"],
						metadata: {},
						outputs: [],
						execution_count: 1,
					},
					{
						cell_type: "markdown",
						source: ["# Results\n", "Below are the results.\n"],
						metadata: {},
					},
					{
						cell_type: "code",
						source: ["class Model:\n", "    def train(self):\n", "        pass\n"],
						metadata: {},
						outputs: [],
						execution_count: null,
					},
				],
				metadata: { kernelspec: { language: "python" } },
				nbformat: 4,
				nbformat_minor: 5,
			},
			null,
			" ",
		);
		await Bun.write(filePath, notebook);

		// Read the notebook in chunk mode
		const readTool = new ReadTool(createSession(tmpDir));
		const result = await readTool.execute("read-ipynb", { path: filePath });
		const text = getText(result);

		// Should show cell-level anchors
		expect(text).toContain("cell_1");
		expect(text).toContain("cell_2");
		expect(text).toContain("cell_3");
		// Should show sub-chunks within code cells
		expect(text).toContain("cell_1.fn_greet");
		expect(text).toContain("cell_3.class_Model");
		// Should show cell content
		expect(text).toContain("def greet(name):");
		expect(text).toContain("# Results");
	});
});
