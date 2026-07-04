import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { type AutocompleteProvider, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const resolveFdPath = (): string | null => {
	const command = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(command, ["fd"], { encoding: "utf-8" });
	if (result.status !== 0 || !result.stdout) {
		return null;
	}

	const firstLine = result.stdout.split(/\r?\n/).find(Boolean);
	return firstLine ? firstLine.trim() : null;
};

type FolderStructure = {
	dirs?: string[];
	files?: Record<string, string>;
};

const setupFolder = (baseDir: string, structure: FolderStructure = {}): void => {
	const dirs = structure.dirs ?? [];
	const files = structure.files ?? {};

	dirs.forEach((dir) => {
		mkdirSync(join(baseDir, dir), { recursive: true });
	});
	Object.entries(files).forEach(([filePath, contents]) => {
		const fullPath = join(baseDir, filePath);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, contents);
	});
};

const fdPath = resolveFdPath();
const isFdInstalled = Boolean(fdPath);

const requireFdPath = (): string => {
	if (!fdPath) {
		throw new Error("fd is not available");
	}
	return fdPath;
};

const getSuggestions = (
	provider: CombinedAutocompleteProvider,
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	force: boolean = false,
) => provider.getSuggestions(lines, cursorLine, cursorCol, { signal: new AbortController().signal, force });

describe("CombinedAutocompleteProvider", () => {
	describe("extractPathPrefix", () => {
		it("extracts / from 'hey /' when forced", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["hey /"];
			const cursorLine = 0;
			const cursorCol = 5; // After the "/"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			assert.notEqual(result, null, "Should return suggestions for root directory");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});

		it("extracts /A from '/A' when forced", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/A"];
			const cursorLine = 0;
			const cursorCol = 2; // After the "A"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			// This might return null if /A doesn't match anything, which is fine
			// We're mainly testing that the prefix extraction works
			if (result) {
				assert.strictEqual(result.prefix, "/A", "Prefix should be '/A'");
			}
		});

		it("does not trigger for slash commands", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/model"];
			const cursorLine = 0;
			const cursorCol = 6; // After "model"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			assert.strictEqual(result, null, "Should not trigger for slash commands");
		});

		it("triggers for absolute paths after slash command argument", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/command /"];
			const cursorLine = 0;
			const cursorCol = 10; // After the second "/"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			assert.notEqual(result, null, "Should trigger for absolute paths in command arguments");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});

		it("uses slash command argument completions on explicit tab", async () => {
			const provider = new CombinedAutocompleteProvider(
				[
					{
						name: "model",
						description: "Select model",
						getArgumentCompletions: () => [{ value: "anthropic/", label: "anthropic", description: "provider" }],
					},
				],
				"/tmp",
			);
			const lines = ["/model "];
			const cursorLine = 0;
			const cursorCol = 7; // After the command-space

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			assert.notEqual(result, null, "Should use command argument completions before file fallback");
			assert.strictEqual(result?.prefix, "");
			assert.strictEqual(result?.items[0]?.value, "anthropic/");
		});
	});

	describe("bang skill completion", () => {
		const provider = new CombinedAutocompleteProvider(
			[
				{ name: "skill:browser-feedback", description: "Review browser UI state" },
				{ name: "skill:agentmemory", description: "Use saved memory" },
				{ name: "skill:omk-skills", description: "Route through OMK role hubs" },
				{ name: "model", description: "Select model" },
			],
			"/tmp",
		);

		it("lists skills for bare bang trigger", async () => {
			const result = await getSuggestions(provider, ["!"], 0, 1);

			assert.notEqual(result, null);
			assert.strictEqual(result?.prefix, "!");
			assert.ok(result?.items.some((item) => item.value === "!skill:browser-feedback "));
			assert.ok(result?.items.some((item) => item.label === "agentmemory"));
			assert.ok(result?.items.some((item) => item.value === "!omk "));
		});

		it("filters OMK role hub shorthand by bang prefix", async () => {
			const result = await getSuggestions(provider, ["!om"], 0, 3);

			assert.notEqual(result, null);
			assert.strictEqual(result?.prefix, "!om");
			assert.strictEqual(result?.items[0]?.value, "!omk ");

			if (!result) {
				assert.fail("expected bang skill suggestions");
			}
			const item = result.items[0];
			if (!item) {
				assert.fail("expected first bang suggestion");
			}
			const applied = provider.applyCompletion(["!om"], 0, 3, item, result.prefix);
			assert.strictEqual(applied.lines[0], "!omk ");
			assert.strictEqual(applied.cursorCol, "!omk ".length);
		});

		it("filters skills by bang prefix and applies explicit skill insertion", async () => {
			const result = await getSuggestions(provider, ["!bro"], 0, 4);

			assert.notEqual(result, null);
			assert.strictEqual(result?.prefix, "!bro");
			assert.strictEqual(result?.items[0]?.value, "!skill:browser-feedback ");

			if (!result) {
				assert.fail("expected bang skill suggestions");
			}
			const item = result.items[0];
			if (!item) {
				assert.fail("expected first bang skill suggestion");
			}
			const applied = provider.applyCompletion(["!bro"], 0, 4, item, result.prefix);
			assert.strictEqual(applied.lines[0], "!skill:browser-feedback ");
			assert.strictEqual(applied.cursorCol, "!skill:browser-feedback ".length);
		});

		it("does not list skills for bang-space bash commands", async () => {
			const result = await getSuggestions(provider, ["! git"], 0, 5);

			assert.strictEqual(result, null);
		});
	});

	describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
		let rootDir = "";
		let baseDir = "";
		let outsideDir = "";

		beforeEach(() => {
			rootDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-root-"));
			baseDir = join(rootDir, "cwd");
			outsideDir = join(rootDir, "outside");
			mkdirSync(baseDir, { recursive: true });
			mkdirSync(outsideDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(rootDir, { recursive: true, force: true });
		});

		test("returns all files and folders for empty @ query", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"README.md": "readme",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value).sort();
			assert.deepStrictEqual(values, ["@README.md", "@src/"].sort());
		});

		test("matches file with extension in query", async () => {
			setupFolder(baseDir, {
				files: {
					"file.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@file.txt";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@file.txt"));
		});

		test("filters are case insensitive", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"README.md": "readme",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@re";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value).sort();
			assert.deepStrictEqual(values, ["@README.md"]);
		});

		test("ranks directories before files", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"src.txt": "text",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@src";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const firstValue = result?.items[0]?.value;
			const hasSrcFile = result?.items?.some((item) => item.value === "@src.txt");
			assert.strictEqual(firstValue, "@src/");
			assert.ok(hasSrcFile);
		});

		test("returns nested file paths", async () => {
			setupFolder(baseDir, {
				files: {
					"src/index.ts": "export {};\n",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@index";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@src/index.ts"));
		});

		test("matches deeply nested paths", async () => {
			setupFolder(baseDir, {
				files: {
					"packages/tui/src/autocomplete.ts": "export {};",
					"packages/ai/src/autocomplete.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@tui/src/auto";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@packages/tui/src/autocomplete.ts"));
			assert.ok(!values?.includes("@packages/ai/src/autocomplete.ts"));
		});

		test("matches directory in middle of path with --full-path", async () => {
			setupFolder(baseDir, {
				files: {
					"src/components/Button.tsx": "export {};",
					"src/utils/helpers.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@components/";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@src/components/Button.tsx"));
			assert.ok(!values?.includes("@src/utils/helpers.ts"));
		});

		test("scopes fuzzy search to relative directories and searches recursively", async () => {
			setupFolder(outsideDir, {
				files: {
					"nested/alpha.ts": "export {};",
					"nested/deeper/also-alpha.ts": "export {};",
					"nested/deeper/zzz.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@../outside/a";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@../outside/nested/alpha.ts"));
			assert.ok(values?.includes("@../outside/nested/deeper/also-alpha.ts"));
			assert.ok(!values?.includes("@../outside/nested/deeper/zzz.ts"));
		});

		test("quotes paths with spaces for @ suggestions", async () => {
			setupFolder(baseDir, {
				dirs: ["my folder"],
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@my";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('@"my folder/"'));
		});

		test("includes hidden paths but excludes .git", async () => {
			setupFolder(baseDir, {
				dirs: [".omk", ".github", ".git"],
				files: {
					".omk/config.json": "{}",
					".github/workflows/ci.yml": "name: ci",
					".git/config": "[core]",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@.omk/"));
			assert.ok(values.includes("@.github/"));
			assert.ok(!values.some((value) => value === "@.git" || value.startsWith("@.git/")));
		});

		test("follows symlinked directories for fuzzy @ search", async () => {
			setupFolder(baseDir, {
				files: {
					"dir/some_file.txt": "real",
				},
			});
			setupFolder(outsideDir, {
				files: {
					"some_file.txt": "symlinked",
				},
			});
			symlinkSync("../outside", join(baseDir, "symlinked_dir"));

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@some";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@dir/some_file.txt"));
			assert.ok(values.includes("@symlinked_dir/some_file.txt"));
		});

		test("returns symlinked directories when matching their name", async () => {
			setupFolder(outsideDir, {
				files: {
					"nested/file.txt": "symlinked",
				},
			});
			symlinkSync("../outside", join(baseDir, "symlinked_dir"));

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@symlinked";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@symlinked_dir/"));
		});

		test("returns symlinked files without requiring type l", async () => {
			setupFolder(baseDir, {
				files: {
					"original.txt": "content",
				},
			});
			const linkPath = join(baseDir, "link.txt");
			symlinkSync("original.txt", linkPath);

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@link";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@link.txt"));
		});

		test("returns the same @ suggestions when the cwd path contains the query", async () => {
			const normalBaseDir = join(rootDir, "cwd-normal");
			const queryInPathBaseDir = join(rootDir, "cwd-plan-repro");
			mkdirSync(normalBaseDir, { recursive: true });
			mkdirSync(queryInPathBaseDir, { recursive: true });

			const structure = {
				dirs: ["packages/coding-agent/examples/extensions/plan-mode"],
				files: {
					"packages/coding-agent/examples/extensions/plan-mode/README.md": "readme",
					"packages/tui/docs/plan.md": "plan",
				},
			};
			setupFolder(normalBaseDir, structure);
			setupFolder(queryInPathBaseDir, structure);

			const query = "@plan";
			const normalProvider = new CombinedAutocompleteProvider([], normalBaseDir, requireFdPath());
			const queryInPathProvider = new CombinedAutocompleteProvider([], queryInPathBaseDir, requireFdPath());

			const normalResult = await getSuggestions(normalProvider, [query], 0, query.length);
			const queryInPathResult = await getSuggestions(queryInPathProvider, [query], 0, query.length);

			const normalize = (result: Awaited<ReturnType<typeof getSuggestions>>) =>
				(result?.items ?? []).map((item) => `${item.label} :: ${item.description ?? ""}`).sort();

			assert.deepStrictEqual(normalize(queryInPathResult), normalize(normalResult));
			assert.ok(
				normalize(normalResult).includes("plan-mode/ :: packages/coding-agent/examples/extensions/plan-mode"),
			);
			assert.ok(normalize(normalResult).includes("plan.md :: packages/tui/docs/plan.md"));
		});

		test("continues autocomplete inside quoted @ paths", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
					"my folder/other.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = '@"my folder/"';
			const result = await getSuggestions(provider, [line], 0, line.length - 1);

			assert.notEqual(result, null, "Should return suggestions for quoted folder path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('@"my folder/test.txt"'));
			assert.ok(values?.includes('@"my folder/other.txt"'));
		});

		test("applies quoted @ completion without duplicating closing quote", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = '@"my folder/te"';
			const cursorCol = line.length - 1;
			const result = await getSuggestions(provider, [line], 0, cursorCol);

			assert.notEqual(result, null, "Should return suggestions for quoted @ path");
			if (!result) {
				assert.fail("Should return suggestions for quoted @ path");
			}
			const item = result?.items.find((entry) => entry.value === '@"my folder/test.txt"');
			if (!item) {
				assert.fail("Should find test.txt suggestion");
			}

			const applied = provider.applyCompletion([line], 0, cursorCol, item, result.prefix);
			assert.strictEqual(applied.lines[0], '@"my folder/test.txt" ');
		});
	});

	describe("dot-slash path completion", () => {
		let baseDir = "";

		beforeEach(() => {
			baseDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-"));
		});

		afterEach(() => {
			rmSync(baseDir, { recursive: true, force: true });
		});

		test("preserves ./ prefix when completing paths", async () => {
			setupFolder(baseDir, {
				files: {
					"update.sh": "#!/bin/bash",
					"utils.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "./up";
			const result = await getSuggestions(provider, [line], 0, line.length, true);

			assert.notEqual(result, null, "Should return suggestions for ./ path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("./update.sh"), `Expected ./update.sh in ${JSON.stringify(values)}`);
		});

		test("preserves ./ prefix for directory completions", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"src/index.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "./sr";
			const result = await getSuggestions(provider, [line], 0, line.length, true);

			assert.notEqual(result, null, "Should return suggestions for ./ directory path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("./src/"), `Expected ./src/ in ${JSON.stringify(values)}`);
		});
	});

	describe("quoted path completion", () => {
		let baseDir = "";

		beforeEach(() => {
			baseDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-"));
		});

		afterEach(() => {
			rmSync(baseDir, { recursive: true, force: true });
		});

		test("quotes paths with spaces for direct completion", async () => {
			setupFolder(baseDir, {
				dirs: ["my folder"],
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "my";
			const result = await getSuggestions(provider, [line], 0, line.length, true);

			assert.notEqual(result, null, "Should return suggestions for path completion");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('"my folder/"'));
		});

		test("continues completion inside quoted paths", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
					"my folder/other.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = '"my folder/"';
			const result = await getSuggestions(provider, [line], 0, line.length - 1, true);

			assert.notEqual(result, null, "Should return suggestions for quoted folder path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('"my folder/test.txt"'));
			assert.ok(values?.includes('"my folder/other.txt"'));
		});

		test("applies quoted completion without duplicating closing quote", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = '"my folder/te"';
			const cursorCol = line.length - 1;
			const result = await getSuggestions(provider, [line], 0, cursorCol, true);

			assert.notEqual(result, null, "Should return suggestions for quoted path");
			if (!result) {
				assert.fail("Should return suggestions for quoted path");
			}
			const item = result?.items.find((entry) => entry.value === '"my folder/test.txt"');
			if (!item) {
				assert.fail("Should find test.txt suggestion");
			}

			const applied = provider.applyCompletion([line], 0, cursorCol, item, result.prefix);
			assert.strictEqual(applied.lines[0], '"my folder/test.txt"');
		});
	});
});

// The "!" skill launcher only executes when the whole message starts with "!"
// (parseBangInvocation), so the editor must gate WHERE its autocomplete may
// fire. These regressions exercise that gate through the Editor (the provider
// extracts a bang prefix from any token boundary, so gating lives in the
// editor's trigger logic, not in CombinedAutocompleteProvider).
describe("Editor bang launcher trigger gating", () => {
	const createTestTUI = (): TUI => new TUI(new VirtualTerminal(80, 24));

	// "!" and "/" trigger with no debounce; "@"/"#" use a ~20ms attachment debounce.
	const flushAutocomplete = async (): Promise<void> => {
		await Promise.resolve();
		await new Promise((resolve) => setImmediate(resolve));
	};
	const settleAutocomplete = async (): Promise<void> => {
		await new Promise((resolve) => setTimeout(resolve, 50));
		await flushAutocomplete();
	};

	const applyCompletion = (
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: { value: string },
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } => {
		const line = lines[cursorLine] || "";
		const before = line.slice(0, cursorCol - prefix.length);
		const after = line.slice(cursorCol);
		const newLines = [...lines];
		newLines[cursorLine] = before + item.value + after;
		return { lines: newLines, cursorLine, cursorCol: cursorCol - prefix.length + item.value.length };
	};

	// Editor wired to a provider that always offers a suggestion and records how
	// many times it was queried, so tests can assert whether the editor decided to
	// fire a trigger at all.
	const createRecordingEditor = (): { editor: Editor; getCalls: () => number } => {
		let calls = 0;
		const provider: AutocompleteProvider = {
			getSuggestions: async (lines, cursorLine, cursorCol) => {
				calls += 1;
				const text = (lines[cursorLine] || "").slice(0, cursorCol);
				return { items: [{ value: `${text}x `, label: "x" }], prefix: text };
			},
			applyCompletion,
		};
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(provider);
		return { editor, getCalls: () => calls };
	};

	const type = (editor: Editor, text: string): void => {
		for (const char of text) {
			editor.handleInput(char);
		}
	};

	it("triggers bang skill autocomplete at the start of the message", async () => {
		const { editor, getCalls } = createRecordingEditor();
		editor.handleInput("!");
		await flushAutocomplete();
		assert.strictEqual(getCalls(), 1);
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("keeps bang autocomplete active while typing at the start of the message", async () => {
		const { editor } = createRecordingEditor();
		editor.handleInput("!");
		await flushAutocomplete();
		editor.handleInput("s");
		editor.handleInput("k");
		await flushAutocomplete();
		assert.strictEqual(editor.getText(), "!sk");
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("does not trigger bang autocomplete after a space mid-message", async () => {
		const { editor, getCalls } = createRecordingEditor();
		type(editor, "hey !");
		await settleAutocomplete();
		assert.strictEqual(getCalls(), 0);
		assert.strictEqual(editor.isShowingAutocomplete(), false);

		// Continuation typing after a mid-message bang must stay silent as well.
		editor.handleInput("s");
		editor.handleInput("k");
		await settleAutocomplete();
		assert.strictEqual(getCalls(), 0);
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("does not trigger bang autocomplete on the second line", async () => {
		const { editor, getCalls } = createRecordingEditor();
		editor.setText("hi\n");
		// isSlashMenuAllowed()/isAtStartOfMessage() are false off the first line.
		assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
		editor.handleInput("!");
		await settleAutocomplete();
		assert.strictEqual(getCalls(), 0);
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("still triggers @ autocomplete mid-message", async () => {
		const { editor, getCalls } = createRecordingEditor();
		type(editor, "hi @");
		await settleAutocomplete();
		assert.strictEqual(getCalls(), 1);
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("still triggers # autocomplete mid-message", async () => {
		const { editor, getCalls } = createRecordingEditor();
		type(editor, "hi #");
		await settleAutocomplete();
		assert.strictEqual(getCalls(), 1);
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});
});
