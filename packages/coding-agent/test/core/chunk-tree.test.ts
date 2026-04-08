import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ChunkState } from "@oh-my-pi/pi-natives";
import { applyChunkEdits, formatChunkedRead, parseChunkReadPath } from "../../src/edit/modes/chunk";

// ═══════════════════════════════════════════════════════════════════════════
// parseChunkReadPath
// ═══════════════════════════════════════════════════════════════════════════

describe("parseChunkReadPath", () => {
	test("plain file path returns filePath only", () => {
		expect(parseChunkReadPath("file.ts")).toEqual({ filePath: "file.ts" });
	});

	test("path with chunk selector returns both", () => {
		expect(parseChunkReadPath("file.ts:class_Foo")).toEqual({
			filePath: "file.ts",
			selector: "class_Foo",
		});
	});

	test("path with raw line selector", () => {
		expect(parseChunkReadPath("file.ts:L42")).toEqual({
			filePath: "file.ts",
			selector: "L42",
		});
	});

	test("path with chunk checksum suffix normalizes selector", () => {
		expect(parseChunkReadPath("file.ts:class_Foo.fn_bar#ZZPM")).toEqual({
			filePath: "file.ts",
			selector: "class_Foo.fn_bar",
		});
	});

	test("trailing colon with no selector yields undefined selector", () => {
		const result = parseChunkReadPath("file.ts:");
		expect(result.filePath).toBe("file.ts");
		expect(result.selector).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// applyChunkEdits
// ═══════════════════════════════════════════════════════════════════════════

const testSource = `class Worker {
\tconstructor(name: string) {
\t\tthis.name = name;
\t}

\trun(): void {
\t\tconsole.log(this.name);
\t}
}
`;

let tmpDir: string | undefined;

afterEach(async () => {
	if (tmpDir) {
		await fs.rm(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

function edit(operations: Parameters<typeof applyChunkEdits>[0]["operations"], source = testSource) {
	return applyEdit({
		source,
		language: "typescript",
		operations,
	});
}

function applyEdit(params: {
	source: string;
	language: string;
	operations: Parameters<typeof applyChunkEdits>[0]["operations"];
	filePath?: string;
}) {
	return applyChunkEdits({
		source: params.source,
		language: params.language,
		cwd: "/tmp",
		filePath: params.filePath ?? `/tmp/source.${params.language}`,
		operations: params.operations,
	});
}

function getChecksum(source: string, chunkPath: string, language = "typescript"): string {
	const chunk = ChunkState.parse(source, language).chunk(chunkPath);
	if (!chunk) {
		throw new Error(`Chunk not found in test fixture: ${chunkPath}`);
	}
	return chunk.checksum;
}

describe("applyChunkEdits", () => {
	test("replace accepts a copied chunk header with checksum suffix", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([
			{
				op: "replace",
				...ac,
				content: `\tstop(): void {\n\t\tconsole.log("stopped");\n\t}`,
			},
		]);

		expect(result.diffSourceAfter).toContain("stop()");
		expect(result.diffSourceAfter).not.toContain("run()");
		const newChecksum = getChecksum(result.diffSourceAfter, "class_Worker.fn_stop");
		expect(newChecksum).not.toBe(ac.crc);
	});

	test("replace with wrong checksum throws with mismatch", () => {
		expect(() =>
			edit([
				{
					op: "replace",
					sel: "class_Worker.fn_run",
					crc: "ZZZZ",
					content: "replacement",
				},
			]),
		).toThrow(/Checksum mismatch/);
	});

	test("append_child on branch inserts after existing members", () => {
		const result = edit([
			{
				op: "append_child",
				sel: "class_Worker",
				content: `\tstatus(): string {\n\t\treturn "active";\n\t}`,
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).toContain("status()");
		const runPos = after.indexOf("run()");
		const statusPos = after.indexOf("status()");
		expect(statusPos).toBeGreaterThan(runPos);
		expect(after).toContain("class Worker");
	});

	test("append_child on an empty container inserts inside the container", () => {
		const result = edit(
			[
				{
					op: "append_child",
					sel: "class_Empty",
					content: "method(): void {}\n",
				},
			],
			"class Empty {}\n",
		);

		expect(result.diffSourceAfter).toContain("class Empty {");
		expect(result.diffSourceAfter).toContain("method(): void {}");
		expect(result.diffSourceAfter).toMatch(/class Empty \{[\s\S]*method\(\): void \{\}[\s\S]*\}/);
		expect(result.diffSourceAfter).not.toEndWith("}\nmethod(): void {}\n");
	});

	test("replace with empty content removes the target chunk", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([{ op: "replace", ...ac, content: "" }]);

		expect(result.diffSourceAfter).not.toContain("run()");
		expect(result.diffSourceAfter).toContain("constructor");
	});

	test("replace preserves attached doc comments when replacement starts at the declaration", () => {
		const source = `class Worker {\n\t/** restart note */\n\trestart(): void {\n\t\tboot();\n\t}\n}\n`;
		const checksum = getChecksum(source, "class_Worker.fn_restart");
		const result = edit(
			[
				{
					op: "replace",
					sel: "class_Worker.fn_restart",
					crc: checksum,
					content: `\trestart(): void {\n\t\tshutdown();\n\t}`,
				},
			],
			source,
		);

		expect(result.diffSourceAfter).toContain("\t/** restart note */\n\trestart(): void {");
		expect(result.diffSourceAfter).toContain("\t\tshutdown();");
		expect(result.diffSourceAfter).not.toContain("\t\tboot();");
	});

	test("replace does not duplicate attached doc comments when replacement includes a new one", () => {
		const source = `class Worker {\n\t/** restart note */\n\trestart(): void {\n\t\tboot();\n\t}\n}\n`;
		const checksum = getChecksum(source, "class_Worker.fn_restart");
		const result = edit(
			[
				{
					op: "replace",
					sel: "class_Worker.fn_restart",
					crc: checksum,
					content: `\t/** updated restart note */\n\trestart(): void {\n\t\tshutdown();\n\t}`,
				},
			],
			source,
		);

		expect(result.diffSourceAfter).toContain("\t/** updated restart note */\n\trestart(): void {");
		expect(result.diffSourceAfter).not.toContain("/** restart note */");
		expect(result.diffSourceAfter.match(/updated restart note/g)).toHaveLength(1);
	});

	test("sibling chunk crc from before the batch still validates after an unrelated sibling is replaced first", () => {
		const ctorCrc = getChecksum(testSource, "class_Worker.constructor");
		const runCrc = getChecksum(testSource, "class_Worker.fn_run");
		const result = applyChunkEdits({
			source: testSource,
			language: "typescript",
			cwd: "/tmp",
			filePath: "/tmp/worker.ts",
			operations: [
				{
					op: "replace",
					sel: "class_Worker.constructor",
					crc: ctorCrc,
					content: `\tconstructor(name: string) {\n\t\tthis.name = name.trim();\n\t}`,
				},
				{
					op: "replace",
					sel: "class_Worker.fn_run",
					crc: runCrc,
					content: `\trun(): void {\n\t\tconsole.log(this.name + "!");\n\t}`,
				},
			],
		});

		expect(result.parseValid).toBe(true);
		expect(result.diffSourceAfter).toContain("name.trim()");
		expect(result.diffSourceAfter).toMatch(/this\.name\s*\+\s*"!"/);
	});

	test("prepend_child on branch inserts before existing members", () => {
		const result = edit([
			{
				op: "prepend_child",
				sel: "class_Worker",
				content: `\tid = 0;`,
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).toContain("id = 0");
		const idPos = after.indexOf("id = 0");
		const ctorPos = after.indexOf("constructor");
		expect(idPos).toBeGreaterThan(-1);
		expect(idPos).toBeLessThan(ctorPos);
	});
});

describe("insertion boundaries", () => {
	test("keeps prepend_child separated from the first existing TypeScript class member", () => {
		const source = `class Box<T> {\n  value(): T {\n    return this.current;\n  }\n}\n`;
		const result = applyEdit({
			source,
			language: "typescript",
			filePath: "/tmp/box.ts",
			operations: [
				{
					op: "prepend_child",
					sel: "class_Box",
					content: `  items(): T[] {\n    return [];\n  }`,
				},
			],
		});

		expect(result.diffSourceAfter).toContain("  }\n\n  value(): T {");
		expect(result.diffSourceAfter).not.toContain("}\n  value(): T {");
	});

	test("keeps prepend_child separated from the first existing Rust impl member", () => {
		const source = `impl Widget {\n    fn old(&self) -> bool {\n        true\n    }\n}\n`;
		const result = applyEdit({
			source,
			language: "rust",
			filePath: "/tmp/widget.rs",
			operations: [
				{
					op: "prepend_child",
					sel: "impl_Widget",
					content: `    fn build(&self) -> bool {\n        false\n    }`,
				},
			],
		});

		expect(result.diffSourceAfter).toContain("    }\n\n    fn old(&self) -> bool {");
		expect(result.diffSourceAfter).not.toContain("}\n    fn old(&self) -> bool {");
	});

	test("keeps prepend_sibling separated before a Go top-level function", () => {
		const source = `package main\n\nfunc format() {}\n`;
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/format.go",
			operations: [
				{
					op: "prepend_sibling",
					sel: "fn_format",
					content: "func formatLog() {}",
				},
			],
		});

		expect(result.diffSourceAfter).toContain("func formatLog() {}\n\nfunc format() {}");
		expect(result.diffSourceAfter).not.toContain("func formatLog() {}\nfunc format() {}");
	});

	test("keeps append_sibling separated from the next Go top-level function", () => {
		const source = `package main\n\nfunc first() {}\nfunc second() {}\n`;
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/functions.go",
			operations: [
				{
					op: "append_sibling",
					sel: "fn_first",
					content: "func middle() {}",
				},
			],
		});

		expect(result.diffSourceAfter).toContain("func first() {}\n\nfunc middle() {}\n\nfunc second() {}");
		expect(result.diffSourceAfter).not.toContain("func middle() {}\nfunc second() {}");
	});

	test("append_child on a Go receiver type inserts after the last receiver method", () => {
		const source = `package main\n\ntype Server struct {}\n\nfunc (s *Server) Start() {}\nfunc (s *Server) Stop() {}\n`;
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/server.go",
			operations: [
				{
					op: "append_child",
					sel: "type_Server",
					content: "func (s *Server) Restart() {}",
				},
			],
		});

		expect(result.diffSourceAfter).toContain(
			"func (s *Server) Start() {}\nfunc (s *Server) Stop() {}\n\nfunc (s *Server) Restart() {}",
		);
		expect(result.diffSourceAfter).not.toContain("type Server struct {\nfunc (s *Server) Restart() {}");
	});

	test("append_child on Go type_Server with struct fields still inserts file-scope func at column 0", () => {
		const source = `package main

type Server struct {
    Addr string
}
`;
		const crc = ChunkState.parse(source, "go").chunk("type_Server")?.checksum;
		expect(crc).toBeDefined();
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/server.go",
			operations: [
				{
					op: "append_child",
					sel: "type_Server",
					crc,
					content: "func (s *Server) Ping() {}",
				},
			],
		});

		expect(result.parseValid).toBe(true);
		expect(result.diffSourceAfter).toContain("func (s *Server) Ping() {}");
		expect(result.diffSourceAfter).not.toMatch(/Addr string\n[ \t]+func \(s \*Server\) Ping/);
	});

	test("append_child on Go type_Server keeps receiver method body indentation relative to column 0", () => {
		const source = `package main

	type Server struct {
	    Addr string
	}
	`;
		const crc = ChunkState.parse(source, "go").chunk("type_Server")?.checksum;
		expect(crc).toBeDefined();
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/server.go",
			operations: [
				{
					op: "append_child",
					sel: "type_Server",
					crc,
					content: "func (s *Server) LogCount() int {\n\ts.mu.Lock()\n\tdefer s.mu.Unlock()\n\treturn 0\n}",
				},
			],
		});

		expect(result.parseValid).toBe(true);
		expect(result.diffSourceAfter).toContain(
			"\nfunc (s *Server) LogCount() int {\n\ts.mu.Lock()\n\tdefer s.mu.Unlock()\n\treturn 0\n}\n",
		);
		expect(result.diffSourceAfter).not.toContain("\n\tfunc (s *Server) LogCount() int {");
	});
	test("keeps append_child separated from the closing delimiter when adding the last child", () => {
		const result = edit([
			{
				op: "append_child",
				sel: "class_Worker",
				content: '\tstatus(): string {\n\t\treturn "active";\n\t}',
			},
		]);

		expect(result.diffSourceAfter).toContain('\t}\n\n\tstatus(): string {\n\t\treturn "active";\n\t}\n}');
		expect(result.diffSourceAfter).not.toContain("\t}\n\tstatus(): string {");
	});

	test("replace with empty content on last impl method collapses extra whitespace-only lines before the closing brace", () => {
		const source = `impl S {
    fn a() {}

    fn b() {}

}
`;
		const crc = getChecksum(source, "impl_S.fn_b", "rust");
		const result = applyEdit({
			source,
			language: "rust",
			filePath: "/tmp/impl.rs",
			operations: [{ op: "replace", sel: "impl_S.fn_b", crc, content: "" }],
		});

		expect(result.diffSourceAfter).toBe("impl S {\n    fn a() {}\n\n}\n");
	});
});

describe("edit safety invariants", () => {
	const runChunkPath = "class_Worker.fn_run";

	function buildStaleRunFixture(): { source: string; staleChecksum: string; currentChecksum: string } {
		const staleChecksum = getChecksum(testSource, runChunkPath);
		const source = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: staleChecksum,
				content: '\trun(): void {\n\t\tconsole.log("updated");\n\t}',
			},
		]).diffSourceAfter;
		return {
			source,
			staleChecksum,
			currentChecksum: getChecksum(source, runChunkPath),
		};
	}

	for (const operation of ["replace", "replace_empty"] as const) {
		test(`rejects stale checksum for ${operation} with current and provided checksums in the error`, () => {
			const { source, staleChecksum } = buildStaleRunFixture();

			const invoke = () => {
				if (operation === "replace") {
					return edit(
						[
							{
								op: "replace",
								sel: runChunkPath,
								crc: staleChecksum,
								content: '\trun(): void {\n\t\tconsole.log("again");\n\t}',
							},
						],
						source,
					);
				}
				return edit([{ op: "replace", sel: runChunkPath, crc: staleChecksum, content: "" }], source);
			};

			expect(invoke).toThrow(new RegExp(`got "${staleChecksum}"`));
		});
	}

	test("auto-accepts stale CRC for a second same-path replace in one batch", () => {
		const checksum = getChecksum(testSource, runChunkPath);
		const result = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: '\trun(): void {\n\t\tconsole.log("first");\n\t}',
			},
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: '\trun(): void {\n\t\tconsole.log("second");\n\t}',
			},
		]);
		expect(result.diffSourceAfter).toContain('console.log("second")');
		expect(result.diffSourceAfter).not.toContain('console.log("first")');
	});

	test("applies two same-path replaces in one batch when the second checksum matches the post-first state", () => {
		const checksum = getChecksum(testSource, runChunkPath);
		const firstContent = '\trun(): void {\n\t\tconsole.log("first");\n\t}';
		const afterFirst = edit([
			{ op: "replace", sel: runChunkPath, crc: checksum, content: firstContent },
		]).diffSourceAfter;
		const checksum2 = getChecksum(afterFirst, runChunkPath);
		const result = edit([
			{ op: "replace", sel: runChunkPath, crc: checksum, content: firstContent },
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum2,
				content: '\trun(): void {\n\t\tconsole.log("second");\n\t}',
			},
		]);

		expect(result.diffSourceAfter).toContain('console.log("second")');
		expect(result.diffSourceAfter).not.toContain('console.log("first")');
	});

	test("auto-accepts stale CRC when a second whole-chunk replace refines the same method", () => {
		const checksum = getChecksum(testSource, runChunkPath);
		const result = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: '\trun(task = "default"): void {\n\t\tconsole.log(this.name);\n\t}',
			},
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: '\trun(task = "default"): void {\n\t\tconsole.log(task);\n\t}',
			},
		]);
		expect(result.diffSourceAfter).toContain('run(task = "default")');
		expect(result.diffSourceAfter).toContain("console.log(task)");
	});

	test("second whole-chunk replace uses post-first checksum when refining signature and body", () => {
		const checksum = getChecksum(testSource, runChunkPath);
		const afterFirst = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: "\trun(): void {\n\t\tconsole.log(task);\n\t}",
			},
		]).diffSourceAfter;
		const checksum2 = getChecksum(afterFirst, runChunkPath);
		const result = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum,
				content: "\trun(): void {\n\t\tconsole.log(task);\n\t}",
			},
			{
				op: "replace",
				sel: runChunkPath,
				crc: checksum2,
				content: '\trun(task = "default"): void {\n\t\tconsole.log(task);\n\t}',
			},
		]);

		expect(result.diffSourceAfter).toContain('run(task = "default"): void {');
		expect(result.diffSourceAfter).toContain("\t\tconsole.log(task)");
		expect(result.diffSourceAfter).not.toContain("console.log(this.name)");
	});

	test("reports batch rollback when a later operation is invalid", () => {
		expect(() =>
			edit([
				{
					op: "append_child",
					sel: "class_Worker",
					content: '\tstatus(): string {\n\t\treturn "active";\n\t}',
				},
				{
					op: "replace",
					sel: "class_Worker.fn_run",
					crc: "ZZZZ",
					content: "",
				},
			]),
		).toThrow(/Edit operation 2\/2 failed.*Checksum mismatch/s);
	});

	test("keeps untouched sibling checksums stable after a nearby edit", () => {
		const before = getChecksum(testSource, "class_Worker.constructor");
		const after = edit([
			{
				op: "replace",
				sel: runChunkPath,
				crc: getChecksum(testSource, runChunkPath),
				content: '\trun(): void {\n\t\tconsole.log("nearby");\n\t}',
			},
		]).diffSourceAfter;

		expect(getChecksum(after, "class_Worker.constructor")).toBe(before);
	});
	test("preserves a chunk checksum after unrelated file changes outside the chunk", () => {
		const checksum = getChecksum(testSource, runChunkPath);
		const sourceWithExternalTail = `${testSource}// externally appended line\n`;

		const result = edit(
			[
				{
					op: "replace",
					sel: runChunkPath,
					crc: checksum,
					content: '\trun(): void {\n\t\tconsole.log("updated");\n\t}',
				},
			],
			sourceWithExternalTail,
		);

		expect(result.diffSourceAfter).toContain("// externally appended line");
		expect(result.diffSourceAfter).toContain('console.log("updated")');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Content prefix stripping
// ═══════════════════════════════════════════════════════════════════════════

describe("content prefix stripping", () => {
	test("line-number prefixes are stripped from replacement content", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([
			{
				op: "replace",
				...ac,
				content: `  120 │ \texec(): void {\n  121 │ \t\tconsole.log("exec");\n  122 │ \t}`,
			},
		]);

		expect(result.diffSourceAfter).not.toMatch(/\d+\s*[|│]/);
		expect(result.diffSourceAfter).toContain("exec()");
	});

	test("hashline prefixes are stripped from replacement content", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([
			{
				op: "replace",
				...ac,
				content: '1#ZP:exec(): void {\n2#PM:\tconsole.log("exec");\n3#QV:}',
			},
		]);

		expect(result.diffSourceAfter).not.toContain("#ZP:");
		expect(result.diffSourceAfter).not.toMatch(/\b\d+#[A-Z]{2}:/);
		expect(result.diffSourceAfter).toContain("exec(): void");
	});
});

describe("chunk path resolution errors", () => {
	test("unknown leaf under an existing parent lists every direct child path", () => {
		let message = "";
		try {
			applyEdit({
				source: testSource,
				language: "typescript",
				filePath: "/tmp/worker.ts",
				operations: [
					{
						op: "prepend_sibling",
						sel: "class_Worker.fn_ghost",
						content: "\tghost(): void {}",
					},
				],
			});
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toContain('Direct children of "class_Worker"');
		expect(message).toContain("class_Worker.constructor");
		expect(message).toContain("class_Worker.fn_run");
	});
});

describe("formatChunkedRead", () => {
	test("root read uses recursive chunk headers without legacy labels", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "worker.ts");
		await Bun.write(filePath, `${testSource}\nconst READY = true;\n`);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "typescript",
		});

		expect(result.text).toContain("worker.ts·");
		expect(result.text).toContain("[class_Worker#");
		expect(result.text).toContain("[class_Worker.fn_run#");
		expect(result.text).not.toContain("ck:");
		expect(result.text).not.toContain("[branch");
	});

	test("root read header reports the full file line count", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "with-tail.ts");
		const body = `${testSource}\n${Array.from({ length: 40 }, () => "// trailing\n").join("")}`;
		await Bun.write(filePath, body);
		const totalLines = body.split("\n").length;
		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "typescript",
		});

		expect(result.text).toMatch(new RegExp(`with-tail\\.ts·${totalLines}L`));
	});

	test("leaf read shows absolute file lines and raw source indentation", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "worker.ts");
		await Bun.write(filePath, testSource);

		const result = await formatChunkedRead({
			filePath,
			readPath: `${filePath}:class_Worker.fn_run`,
			cwd: tmpDir,
			language: "typescript",
		});

		expect(result.text).toContain("worker.ts:class_Worker.fn_run·");
		expect(result.text).toContain("[class_Worker.fn_run#");
		expect(result.text).toContain("run(): void {");
		expect(result.text).toContain("6| ");
		expect(result.text).toContain("run(): void {");
		expect(result.text).toContain("7| ");
		expect(result.text).toContain("console.log(this.name);");
	});

	test("large child leaves stay expanded under the default preview threshold", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "service.ts");
		const longBody = Array.from({ length: 40 }, (_, index) => `    step(${index});`).join("\n");
		await Bun.write(filePath, `class Service {\n  handle(): void {\n${longBody}\n    done();\n  }\n}\n`);

		const result = await formatChunkedRead({
			filePath,
			readPath: `${filePath}:class_Service.fn_handle`,
			cwd: tmpDir,
			language: "typescript",
		});

		expect(result.text).not.toContain("to expand ⋮");
		expect(result.text).toContain("3|     step(0);");
		expect(result.text).toContain("27|     step(24);");
		expect(result.text).toContain("done();");
	});
});

describe("leaf insert indentation", () => {
	test("prepend_sibling on a nested method uses the method's indent level", () => {
		const result = edit([
			{
				op: "prepend_sibling",
				sel: "class_Worker.fn_run",
				content: "validate(): boolean {\n\treturn true;\n}",
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).toContain("\tvalidate(): boolean {");
		expect(after).toContain("\trun(): void {");
		const validatePos = after.indexOf("validate()");
		const runPos = after.indexOf("run()");
		expect(validatePos).toBeLessThan(runPos);
	});

	test("append_sibling on a nested method uses the method's indent level", () => {
		const result = edit([
			{
				op: "append_sibling",
				sel: "class_Worker.fn_run",
				content: 'stop(): void {\n\tconsole.log("stopped");\n}',
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).toContain("\tstop(): void {");
		const runPos = after.indexOf("run()");
		const stopPos = after.indexOf("stop()");
		expect(stopPos).toBeGreaterThan(runPos);
	});
});

describe("replace last child formatting", () => {
	test("replacing last method does not merge with closing brace", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([
			{
				op: "replace",
				...ac,
				content: '\texec(): void {\n\t\tconsole.log("exec");\n\t}',
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).not.toContain("}}");
		expect(after).toContain("\texec(): void {");
		expect(after).toMatch(/\t\}\n\}/);
	});

	test("replace dedents uniformly over-indented content so the chunk column is not applied twice", () => {
		const ac = { sel: "class_Worker.fn_run", crc: getChecksum(testSource, "class_Worker.fn_run") };
		const result = edit([
			{
				op: "replace",
				...ac,
				content: '\t\texec(): void {\n\t\t\tconsole.log("exec");\n\t\t}',
			},
		]);

		const after = result.diffSourceAfter;
		expect(after).toContain("\texec(): void {");
		expect(after).toContain('\t\tconsole.log("exec");');
		expect(after).not.toContain("\t\texec(): void");
	});
});

describe("addressable member rendering", () => {
	test("renders trivial Rust enum variants as addressable children", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "log.rs");
		await Bun.write(filePath, `pub enum LogLevel {\n    Debug,\n    Info,\n    Warn,\n    Error,\n}\n`);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "rust",
		});

		expect(result.text).toContain("[enum_LogLevel#");
		expect(result.text).toContain("[enum_LogLevel.variant_Debug#");
		expect(result.text).toContain("[enum_LogLevel.variant_Error#");
	});

	test("renders a single-method Go interface inline on the parent chunk", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "handler.go");
		await Bun.write(
			filePath,
			`package main\n\ntype Handler interface {\n    Handle(method, path string) Result\n}\n`,
		);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "go",
		});

		expect(result.text).toContain("[type_Handler#");
		expect(result.text).toContain("3| type Handler interface {");
		expect(result.text).toContain("4|     Handle(method, path string) Result");
	});

	test("renders Go receiver methods beneath their receiver type", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "server.go");
		await Bun.write(
			filePath,
			`package main\n\ntype Server struct {\n    Addr string\n}\n\nfunc (s *Server) Start() {}\nfunc (s Server) Stop() {}\n`,
		);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "go",
		});

		expect(result.text).toContain("[type_Server#");
		expect(result.text).toContain("[type_Server.field_Addr#");
		expect(result.text).toContain("[type_Server.fn_Start#");
		expect(result.text).toContain("[type_Server.fn_Stop#");
	});

	test("line range filter shows receiver methods under a type even when the range skips the type header", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "server.go");
		await Bun.write(
			filePath,
			`package main\n\ntype Server struct {\n    Addr string\n}\n\nfunc (s *Server) Start() {}\nfunc (s Server) Stop() {}\n`,
		);

		const result = await formatChunkedRead({
			filePath,
			readPath: `${filePath}:L7-L8`,
			cwd: tmpDir,
			language: "go",
		});

		expect(result.text).toContain("L7-L8");
		expect(result.text).toContain("[type_Server.fn_Start#");
		expect(result.text).toContain("[type_Server.fn_Stop#");
	});

	test("renders trivial TypeScript enum variants as addressable children", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "status.ts");
		await Bun.write(filePath, `enum Status {\n  Idle = "idle",\n  Busy = "busy",\n}\n`);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "typescript",
		});

		expect(result.text).toContain("[enum_Status#");
		expect(result.text).toContain("[enum_Status.variant_Idle#");
		expect(result.text).toContain("[enum_Status.variant_Busy#");
	});

	test("keeps non-trivial containers expanded", () => {
		const classState = ChunkState.parse(
			`class Tiny {\n  foo() {\n    return 1;\n  }\n\n  bar() {\n    return 2;\n  }\n}\n`,
			"typescript",
		);
		const classChildren = classState.children("class_Tiny").map((chunk: { path: string }) => chunk.path);
		expect(classChildren).toContain("class_Tiny.fn_foo");
		expect(classChildren).toContain("class_Tiny.fn_bar");

		const enumSource = Array.from({ length: 35 }, (_, i) => `  V${i} = ${i},`).join("\n");
		const enumState = ChunkState.parse(`enum Big {\n${enumSource}\n}\n`, "typescript");
		const enumChunk = enumState.chunk("enum_Big");
		expect(enumChunk?.leaf).toBe(false);
	});
});

describe("grouped Go receiver chunk headers", () => {
	test("reports grouped receiver chunk line counts from rendered lines", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-core-"));
		const filePath = path.join(tmpDir, "server.go");
		await Bun.write(
			filePath,
			`package main\n\ntype Server struct {\n    Addr string\n}\n\nfunc (s *Server) Start() {}\nfunc (s Server) Stop() {}\n`,
		);

		const result = await formatChunkedRead({
			filePath,
			readPath: `${filePath}:type_Server`,
			cwd: tmpDir,
			language: "go",
		});

		expect(result.text).toContain("server.go:type_Server·6L");
		expect(result.text).toContain("[type_Server.fn_Start#");
		expect(result.text).toContain("[type_Server.fn_Stop#");
	});
});

describe("addressable member editing", () => {
	const enumSource = `enum Status {\n  Idle = "idle",\n  Busy = "busy",\n}\n`;

	test("replace accepts full-source edits on the parent enum container", () => {
		const ac = { sel: "enum_Status", crc: getChecksum(enumSource, "enum_Status") };
		const result = edit(
			[
				{
					op: "replace",
					...ac,
					content: `enum Status {\n  Idle = "idle",\n  Done = "done",\n}\n`,
				},
			],
			enumSource,
		);

		expect(result.diffSourceAfter).toContain('Done = "done"');
		expect(result.diffSourceAfter).not.toContain('Busy = "busy"');
	});

	test("append_sibling inserts beside an individually addressable enum variant", () => {
		const result = edit(
			[
				{
					op: "append_sibling",
					sel: "enum_Status.variant_Idle",
					content: 'Paused = "paused",',
				},
			],
			enumSource,
		);

		expect(result.diffSourceAfter).toContain('  Idle = "idle",\n\n  Paused = "paused",\n\n  Busy = "busy",');
	});

	test("replace with empty content removes an individually addressable enum variant", () => {
		const busy = { sel: "enum_Status.variant_Busy", crc: getChecksum(enumSource, "enum_Status.variant_Busy") };
		const result = edit([{ op: "replace", ...busy, content: "" }], enumSource);

		expect(result.diffSourceAfter).toContain('Idle = "idle"');
		expect(result.diffSourceAfter).not.toContain('Busy = "busy"');
	});
});

describe("Go receiver render ownership", () => {
	test("omits unrelated top-level siblings from grouped receiver output", () => {
		const source = `package main\n\ntype Server struct {\n    Addr string\n}\n\nfunc (s *Server) Start() {}\nfunc (s Server) Stop() {}\n`;
		const result = applyEdit({
			source,
			language: "go",
			filePath: "/tmp/server.go",
			operations: [
				{
					op: "prepend_sibling",
					sel: "type_Server.fn_Start",
					content: "func DefaultServer() *Server {\n    return &Server{}\n}",
				},
			],
		});

		expect(result.responseText).toContain("func DefaultServer() *Server");
		expect(result.responseText).toContain("[fn_DefaultServer#");
		expect(result.responseText).toContain("[type_Server.fn_Start#");
	});
});

describe("blank-line cleanup", () => {
	const commentedSource = `class Worker {
	stop(): void {
		cleanup();
	}

	// restart note
	restart(): void {
		boot();
	}
}
`;

	test("replace with empty content collapses triple newlines at the edit seam", () => {
		const checksum = getChecksum(commentedSource, "class_Worker.fn_restart");
		const result = edit(
			[
				{
					op: "replace",
					sel: "class_Worker.fn_restart",
					crc: checksum,
					content: "",
				},
			],
			commentedSource,
		);

		expect(result.diffSourceAfter).toContain("\t}\n\n}");
		expect(result.diffSourceAfter).not.toContain("\t}\n\n\n}");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// splice
// ═══════════════════════════════════════════════════════════════════════════

describe("prepend_child warnings", () => {
	test("warns when comment-only prepend_child may merge into the next chunk", () => {
		const source = `package main\n\nimport "fmt"\n`;
		const state = ChunkState.parse(source, "go");
		const root = state.root();
		if (!root) {
			throw new Error("expected root chunk");
		}
		const result = applyChunkEdits({
			source,
			language: "go",
			cwd: "/",
			filePath: "main.go",
			operations: [{ op: "prepend_child", sel: "", crc: root.checksum, content: "// AUTO-GENERATED\n" }],
		});
		expect(result.warnings.some(w => w.includes("Comment-only prepend_child"))).toBe(true);
	});
});

describe("chunk selector auto-resolution", () => {
	test("warns on suffix auto-resolution", () => {
		const result = edit([
			{
				op: "replace",
				sel: "fn_run",
				crc: getChecksum(testSource, "class_Worker.fn_run"),
				content: "run(): void {\n\tconsole.log(this.name);\n}",
			},
		]);
		expect(
			result.warnings.some(w => w.includes('Auto-resolved chunk selector "fn_run" to "class_Worker.fn_run"')),
		).toBe(true);
	});

	test("warns on prefix auto-resolution", () => {
		const result = edit([
			{
				op: "replace",
				sel: "run",
				crc: getChecksum(testSource, "class_Worker.fn_run"),
				content: "run(): void {\n\tconsole.log(this.name);\n}",
			},
		]);
		expect(result.warnings.some(w => w.includes('Auto-resolved chunk selector "run" to "class_Worker.fn_run"'))).toBe(
			true,
		);
	});

	test("errors on ambiguous suffix matches", () => {
		const source = `class Foo {\n\trun(): void {}\n}\nclass Bar {\n\trun(): void {}\n}\n`;
		expect(() =>
			applyEdit({
				source,
				language: "typescript",
				operations: [
					{
						op: "replace",
						sel: "fn_run",
						crc: getChecksum(source, "class_Foo.fn_run"),
						content: "",
					},
				],
			}),
		).toThrow(/Ambiguous chunk selector "fn_run" matches 2 chunks/);
	});
});

describe("prepend_child preamble guard", () => {
	test("errors when comment-only prepend_child targets root with preamble", () => {
		// JS source with a leading comment block that becomes preamble
		const source = `/**\n * License header\n */\nconst x = 1;\n`;
		const state = ChunkState.parse(source, "javascript");
		const hasPreamble = state.chunks().some((chunk: { path: string }) => chunk.path === "preamble");
		if (!hasPreamble) {
			// Skip if parser doesn't produce preamble for this source
			return;
		}
		const root = state.root();
		if (!root) throw new Error("expected root chunk");
		expect(() =>
			applyChunkEdits({
				source,
				language: "javascript",
				cwd: "/",
				filePath: "index.js",
				operations: [{ op: "prepend_child", sel: "", crc: root.checksum, content: "// AUTO-GENERATED\n" }],
			}),
		).toThrow(/Comment-only prepend_child on root is not allowed when the file has a preamble/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// move
// ═══════════════════════════════════════════════════════════════════════════

describe("tlaplus chunk rendering", () => {
	const tlaplusSource = `---- MODULE Spec ----\nVARIABLE x\n\nInit == x = 0\n\n(* --algorithm Demo\nvariables x = 0;\nbegin\n  Inc:\n    x := x + 1;\nend algorithm; *)\n\\* BEGIN TRANSLATION\nVARIABLES pc\nNext == pc' = pc\n\\* END TRANSLATION\n====\n`;

	test("formatChunkedRead hides translated content behind a synthetic translation chunk", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-tree-tlaplus-read-"));
		const filePath = path.join(tmpDir, "Spec.tla");
		await Bun.write(filePath, tlaplusSource);

		const result = await formatChunkedRead({
			filePath,
			readPath: filePath,
			cwd: tmpDir,
			language: "tlaplus",
		});

		expect(result.text).toContain("[mod_Spec.translation_12#");
		expect(result.text).toContain("\\* [translation hidden]");
		expect(result.text).not.toContain("Next == pc' = pc");
	});

	test("applyChunkEdits keeps translated content hidden in responseText", () => {
		const state = ChunkState.parse(tlaplusSource, "tlaplus");
		const initChunk = state
			.chunks()
			.find((chunk: { path: string; checksum: string }) => chunk.path.endsWith("operator_Init"));
		if (!initChunk) throw new Error("Expected operator_Init chunk in tlaplus fixture");

		const result = applyChunkEdits({
			source: tlaplusSource,
			language: "tlaplus",
			cwd: "/tmp",
			filePath: "/tmp/Spec.tla",
			operations: [{ op: "replace", sel: initChunk.path, crc: initChunk.checksum, content: "Start == x = 0" }],
		});

		expect(result.diffSourceAfter).toContain("Start == x = 0");
		// The scoped response tree includes the touched chunk and adjacent siblings,
		// but not distant ones like translation_12. The translation content must
		// still be hidden from any chunk that IS visible.
		expect(result.responseText).toContain("[mod_Spec.operator_Start#");
		expect(result.responseText).not.toContain("Next == pc' = pc");
	});
});
