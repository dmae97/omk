import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { VimTool, vimToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/vim";
import { VimBuffer } from "@oh-my-pi/pi-coding-agent/vim/buffer";
import { VimEngine } from "@oh-my-pi/pi-coding-agent/vim/engine";
import { parseKeySequences } from "@oh-my-pi/pi-coding-agent/vim/parser";

function textResult(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text" && typeof block.text === "string")
		.map(block => block.text)
		.join("\n");
}

function createSession(cwd: string, overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "lsp.enabled": false }),
		...overrides,
	};
}

function createEngine(text: string): VimEngine {
	return new VimEngine(
		new VimBuffer({
			absolutePath: "/tmp/test.ts",
			displayPath: "test.ts",
			lines: text.split("\n"),
			trailingNewline: false,
			fingerprint: null,
		}),
		{
			beforeMutate: async () => {},
			loadBuffer: async inputPath => ({
				absolutePath: inputPath,
				displayPath: inputPath,
				lines: [""],
				trailingNewline: false,
				fingerprint: null,
			}),
			saveBuffer: async buffer => ({
				loaded: {
					absolutePath: buffer.filePath,
					displayPath: buffer.displayPath,
					lines: [...buffer.lines],
					trailingNewline: buffer.trailingNewline,
					fingerprint: null,
				},
			}),
		},
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("vim parser", () => {
	it("parses literal and special keys in order", () => {
		const tokens = parseKeySequences(["ciwnewName<Esc>", ":w<CR>"]);
		expect(tokens.map(token => token.value)).toEqual([
			"c",
			"i",
			"w",
			"n",
			"e",
			"w",
			"N",
			"a",
			"m",
			"e",
			"Esc",
			":",
			"w",
			"CR",
		]);
	});
});

describe("vim engine", () => {
	it("repeats the last change with dot", async () => {
		const engine = createEngine("foo foo");
		await engine.executeTokens(parseKeySequences(["ciwbar<Esc>", "w", "."]), "ciwbar<Esc> w .");
		expect(engine.buffer.getText()).toBe("bar bar");
	});

	it("streams dot-repeat replays through the step callback", async () => {
		const engine = createEngine("foo foo");
		await engine.executeTokens(parseKeySequences(["ciwbar<Esc>", "w"]), "ciwbar<Esc> w");

		const snapshots: string[] = [];
		await engine.executeTokens(parseKeySequences(["."]), ".", async () => {
			snapshots.push(`${engine.getPublicMode()}|${engine.buffer.cursor.col}|${engine.buffer.getText()}`);
		});

		expect(engine.buffer.getText()).toBe("bar bar");
		expect(snapshots.length).toBeGreaterThan(1);
		expect(snapshots.some(snapshot => snapshot.startsWith("INSERT|"))).toBe(true);
	});

	it("deletes lines and supports undo/redo", async () => {
		const engine = createEngine("one\ntwo\nthree\nfour");
		await engine.executeTokens(parseKeySequences(["2G", "2dd"]), "2G 2dd");
		expect(engine.buffer.getText()).toBe("one\nfour");
		await engine.executeTokens(parseKeySequences(["u"]), "u");
		expect(engine.buffer.getText()).toBe("one\ntwo\nthree\nfour");
		await engine.executeTokens(parseKeySequences(["<C-r>"]), "<C-r>");
		expect(engine.buffer.getText()).toBe("one\nfour");
	});

	it("surfaces undo counts in the status message", async () => {
		const engine = createEngine("alpha beta gamma");
		await engine.executeTokens(parseKeySequences(["dw", "dw"]), "dw dw");
		await engine.executeTokens(parseKeySequences(["2u"]), "2u");
		expect(engine.buffer.getText()).toBe("alpha beta gamma");
		expect(engine.statusMessage).toBe("Undid 2 changes");
	});

	it("accepts doubled indent operators in visual mode", async () => {
		const engine = createEngine("one\ntwo\nthree");
		await engine.executeTokens(parseKeySequences(["Vj>>"]), "Vj>>");
		expect(engine.buffer.getText()).toBe("\tone\n\ttwo\nthree");
	});

	it("applies file-wide substitution through ex commands", async () => {
		const engine = createEngine("alpha beta\nalpha gamma");
		await engine.executeTokens(parseKeySequences([":%s/alpha/delta/g<CR>"]), ":%s/alpha/delta/g<CR>");
		expect(engine.buffer.getText()).toBe("delta beta\ndelta gamma");
		expect(engine.statusMessage).toContain("2 substitution");
	});

	it("deletes all lines with :%d", async () => {
		const engine = createEngine("line one\nline two\nline three");
		await engine.executeTokens(parseKeySequences([":%d<CR>"]), ":%d<CR>");
		expect(engine.buffer.getText()).toBe("");
		expect(engine.statusMessage).toBe("Deleted 3 lines");
	});
});

describe("vim tool", () => {
	let tmpDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vim-tool-"));
		await Settings.init({ inMemory: true, cwd: tmpDir });
	});

	it("opens, edits, saves, and persists content", async () => {
		const filePath = path.join(tmpDir, "sample.ts");
		await Bun.write(filePath, "foo = 1;\nfoo = foo + 1;\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "sample.ts" });
		await tool.execute("edit", { file: "sample.ts", kbd: ["ciwbar<Esc>", "j", "."] });
		await tool.execute("save", { file: "sample.ts", kbd: [":w<CR>"] });

		const saved = await Bun.file(filePath).text();
		expect(saved).toContain("bar = 1;");
		expect(saved).toContain("bar = foo + 1;");
	});

	it("keeps the cursor line visible after large jumps", async () => {
		const filePath = path.join(tmpDir, "long.ts");
		await Bun.write(filePath, Array.from({ length: 1100 }, (_, index) => `line ${index + 1};`).join("\n"));
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "long.ts" });
		const moved = await tool.execute("jump", { file: "long.ts", kbd: ["1014G"] });
		const text = textResult(moved);
		expect(text).toContain(">1014│line 1014;");
		expect(moved.details?.cursor.line).toBe(1014);
	});

	it("centers the viewport on the cursor after a large edit", async () => {
		const filePath = path.join(tmpDir, "center.ts");
		await Bun.write(filePath, Array.from({ length: 500 }, (_, index) => `line ${index + 1};`).join("\n"));
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "center.ts" });
		const edited = await tool.execute("edit", { file: "center.ts", kbd: ["386Go"], insert: "inserted", pause: true });
		expect(edited.details?.cursor.line).toBe(387);
		expect(edited.details?.viewport.start).toBe(367);
		expect(edited.details?.viewport.end).toBe(406);
		expect(textResult(edited)).toContain("Diff:");
		expect(textResult(edited)).toContain("+inserted");
	});

	it("recenters the viewport and includes a diff after edits", async () => {
		const filePath = path.join(tmpDir, "long-edit.ts");
		await Bun.write(filePath, Array.from({ length: 1100 }, (_, index) => `line ${index + 1};`).join("\n"));
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "long-edit.ts" });
		const edited = await tool.execute("edit", { file: "long-edit.ts", kbd: ["1014G", "o"], insert: "inserted" });
		const text = textResult(edited);
		expect(edited.details?.cursor.line).toBe(1015);
		expect(edited.details?.viewport.start).toBe(995);
		expect(text).toContain("Diff:");
		expect(text).toContain("+inserted");
	});

	it("supports raw insert payloads after kbd enters insert mode", async () => {
		const filePath = path.join(tmpDir, "replace.ts");
		await Bun.write(filePath, "first\nsecond\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "replace.ts" });
		const replaced = await tool.execute("replace", { file: "replace.ts", kbd: ["cc"], insert: "alpha\nbeta" });
		await tool.execute("save", { file: "replace.ts", kbd: [":w<CR>"] });

		const saved = await Bun.file(filePath).text();
		expect(saved).toBe("alpha\nbeta\nsecond\n");
		expect(textResult(replaced)).toContain("Diff:");
		expect(textResult(replaced)).toContain("+beta");
	});

	it("rejects another kbd entry after entering insert mode", async () => {
		const filePath = path.join(tmpDir, "ambiguous.ts");
		await Bun.write(filePath, "first\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "ambiguous.ts" });
		await expect(tool.execute("bad", { file: "ambiguous.ts", kbd: ["o", "o"] })).rejects.toThrow(/left Vim in INSERT mode/i);
	});

	it("rejects additional kbd entries after entering insert mode", async () => {
		const filePath = path.join(tmpDir, "insert-boundary.ts");
		await Bun.write(filePath, "alpha\nbeta\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "insert-boundary.ts" });
		await expect(tool.execute("edit", { file: "insert-boundary.ts", kbd: ["2G", "o", "o"] })).rejects.toThrow(/insert field|<Esc>/i);
		const saved = await Bun.file(filePath).text();
		expect(saved).toBe("alpha\nbeta\n");
	});

	it("supports paused insert mode and resuming with a later insert payload", async () => {
		const filePath = path.join(tmpDir, "pause.ts");
		await Bun.write(filePath, "first\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "pause.ts" });
		const paused = await tool.execute("pause", { file: "pause.ts", kbd: ["cc"], pause: true });
		expect(paused.details?.mode).toBe("INSERT");
		expect(textResult(paused)).toContain("Pending: INSERT mode");

		await tool.execute("resume", { file: "pause.ts", kbd: [], insert: "replacement" });
		await tool.execute("save", { file: "pause.ts", kbd: [":w<CR>"] });
		const saved = await Bun.file(filePath).text();
		expect(saved).toBe("replacement\n");
	});

	it("rejects insert payloads outside insert mode with a snapshot error", async () => {
		const filePath = path.join(tmpDir, "bad-insert.ts");
		await Bun.write(filePath, "first\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "bad-insert.ts" });
		await expect(tool.execute("bad", { file: "bad-insert.ts", kbd: [], insert: "nope" })).rejects.toThrow(
			/Insert payload requires INSERT mode/i,
		);
	});

	it("renders visible tab markers and a caret-focused snapshot", async () => {
		const filePath = path.join(tmpDir, "tabs.ts");
		await Bun.write(filePath, "\treturn value;\n");
		const tool = new VimTool(createSession(tmpDir));

		const opened = await tool.execute("open", { file: "tabs.ts" });
		const text = textResult(opened);
		expect(text).toContain("Focus:");
		expect(text).toContain(" → return value;");
		expect(text).toContain("^");
	});

	it("shows paused search input in the snapshot", async () => {
		const filePath = path.join(tmpDir, "search.ts");
		await Bun.write(filePath, "alpha\nbeta\n");
		const tool = new VimTool(createSession(tmpDir));

		await tool.execute("open", { file: "search.ts" });
		const paused = await tool.execute("search", { file: "search.ts", kbd: ["/be"], pause: true });
		expect(paused.details?.pendingInput?.kind).toBe("search-forward");
		expect(textResult(paused)).toContain("Pending: /be");
	});

	it("streams ex command input through onUpdate while typing", async () => {
		const filePath = path.join(tmpDir, "command.ts");
		await Bun.write(filePath, "foo foo\n");
		const tool = new VimTool(createSession(tmpDir));
		const pendingInputs: string[] = [];

		await tool.execute("open", { file: "command.ts" });
		const result = await tool.execute("command", { file: "command.ts", kbd: [":%s/foo/bar/g<CR>"] }, undefined, update => {
			const pending = update.details?.pendingInput;
			if (pending?.kind === "command") {
				pendingInputs.push(pending.text);
			}
		});

		expect(pendingInputs).toContain("");
		expect(pendingInputs).toContain("%");
		expect(pendingInputs).toContain("%s/foo/bar/g");
		expect(textResult(result)).toContain("bar bar");
	});

	it("allows navigation in plan mode but blocks mutations", async () => {
		const filePath = path.join(tmpDir, "plan.ts");
		await Bun.write(filePath, "one\ntwo\nthree\n");
		const tool = new VimTool(
			createSession(tmpDir, {
				getPlanModeState: () => ({
					enabled: true,
					planFilePath: path.join(tmpDir, "PLAN.md"),
				}),
			}),
		);

		await tool.execute("open", { file: "plan.ts" });
		const moved = await tool.execute("move", { file: "plan.ts", kbd: ["2G"] });
		expect(textResult(moved)).toContain("L2:1");
		await expect(tool.execute("edit", { file: "plan.ts", kbd: ["dd"] })).rejects.toThrow(/Plan mode/i);
		await expect(tool.execute("insert", { file: "plan.ts", kbd: ["cc"], insert: "blocked" })).rejects.toThrow(/Plan mode/i);
	});
});

describe("vim renderer", () => {
	it("caches repeated renders for the same viewport snapshot", async () => {
		const theme = await themeModule.getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;
		const highlightSpy = vi.spyOn(themeModule, "highlightCode");

		const component = vimToolRenderer.renderResult(
			{
				content: [{ type: "text", text: "" }],
				details: {
					file: "sample.ts",
					mode: "NORMAL",
					cursor: { line: 1, col: 1 },
					totalLines: 2,
					modified: false,
					viewport: { start: 1, end: 2 },
					viewportLines: [
						{ line: 1, text: "const foo = 1;", isCursor: true, isSelected: false },
						{ line: 2, text: "return foo;", isCursor: false, isSelected: false },
					],
				},
			},
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			uiTheme,
		);

		component.render(120);
		component.render(120);

		expect(highlightSpy).toHaveBeenCalledTimes(1);
	});
});
