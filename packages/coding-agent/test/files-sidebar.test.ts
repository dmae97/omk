import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { TUI, visibleWidth } from "omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import {
	formatCompactSize,
	isSecretFileName,
	listRepoDirectory,
	readSafeRepoFile,
	resolveSafeRepoPath,
	searchRepoFiles,
} from "../src/core/repo-files-fs.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { FilePreviewDrawerComponent } from "../src/modes/interactive/components/file-preview-drawer.ts";
import { FilesSidebarComponent } from "../src/modes/interactive/components/files-sidebar.ts";
import {
	FILES_SIDEBAR_DEFAULT_WIDTH,
	FILES_SIDEBAR_RAIL_WIDTH,
	FilesSidebarModel,
	filesSidebarGutterWidth,
} from "../src/modes/interactive/components/files-sidebar-model.ts";
import { handleFilesSidebarMouse, parseSgrMouse } from "../src/modes/interactive/components/files-sidebar-mouse.ts";
import { setupFilesSidebar } from "../src/modes/interactive/files-sidebar-setup.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("repo-files-fs and FilesSidebar TUI", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-files-sidebar-"));
		mkdirSync(join(root, "src", "auth"), { recursive: true });
		mkdirSync(join(root, "node_modules"));
		writeFileSync(join(root, "README.md"), "# Demo\nline two\n");
		writeFileSync(
			join(root, "src", "app.ts"),
			Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"),
		);
		writeFileSync(join(root, "src", "auth", "token.ts"), "export const token = true;\n");
		writeFileSync(join(root, ".env"), "SECRET_KEY=topsecret\n");
		writeFileSync(join(root, "bin.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("enforces containment, secret blocking, binary detection, compact sizes, and recursive search", () => {
		expect(() => resolveSafeRepoPath(root, "../outside")).toThrow(/outside/i);
		expect(() => resolveSafeRepoPath(root, "/etc/passwd")).toThrow(/outside/i);
		expect(isSecretFileName(".env")).toBe(true);
		expect(isSecretFileName("id_rsa")).toBe(true);
		expect(isSecretFileName("README.md")).toBe(false);
		expect(formatCompactSize(512)).toBe("512B");
		expect(formatCompactSize(1536)).toBe("1.5K");

		const listing = listRepoDirectory(root, "");
		expect(listing.entries.map((e) => e.name)).toEqual(["src", "bin.dat", "README.md"]);

		// Recursive search finds deeply nested files even when folders are collapsed
		const hits = searchRepoFiles(root, "token");
		expect(hits.map((e) => e.path)).toEqual(["src/auth/token.ts"]);

		const secretPreview = readSafeRepoFile(root, ".env");
		expect(secretPreview.blocked).toBe(true);
		const binPreview = readSafeRepoFile(root, "bin.dat");
		expect(binPreview.binary).toBe(true);
	});

	it("defaults showFilesSidebar to true and respects setting and env opt-out", () => {
		const prev = process.env.OMK_FILES_SIDEBAR;
		delete process.env.OMK_FILES_SIDEBAR;
		try {
			expect(SettingsManager.inMemory({}).getShowFilesSidebar()).toBe(true);
			expect(SettingsManager.inMemory({ showFilesSidebar: false }).getShowFilesSidebar()).toBe(false);
			process.env.OMK_FILES_SIDEBAR = "0";
			expect(SettingsManager.inMemory({}).getShowFilesSidebar()).toBe(false);
			expect(SettingsManager.inMemory({ showFilesSidebar: true }).getShowFilesSidebar()).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.OMK_FILES_SIDEBAR;
			else process.env.OMK_FILES_SIDEBAR = prev;
		}
	});

	it("supports recursive filter with live arrow nav, Tab/Space/@ insert, preview scroll, and collapsed rail", () => {
		const model = new FilesSidebarModel(root, "open", FILES_SIDEBAR_DEFAULT_WIDTH);
		const inserted: string[] = [];
		let returnedFocus = 0;

		const sidebar = new FilesSidebarComponent(model, {
			getRows: () => 24,
			requestRender: () => {},
			onInsertPath: (p) => inserted.push(p),
			onReturnFocus: () => {
				returnedFocus += 1;
			},
			onToggleMode: () => {
				model.toggleMode();
			},
		});
		sidebar.focused = true;

		const openLines = sidebar.render(28).map((l) => stripVTControlCharacters(l));
		expect(openLines.length).toBe(24);
		expect(openLines[0]).toContain("● FILES ·");
		expect(openLines[2]).toContain("/ Filter repo files...");
		for (const line of sidebar.render(28)) expect(visibleWidth(line)).toBeLessThanOrEqual(28);

		// Recursive filter finds src/auth/token.ts while collapsed, and Tab inserts directly
		sidebar.handleInput("/");
		for (const ch of "token") sidebar.handleInput(ch);
		expect(model.getVisibleRows().map((r) => r.entry.path)).toEqual(["src/auth/token.ts"]);
		sidebar.handleInput("\t");
		expect(inserted).toEqual(["src/auth/token.ts"]);

		// Clear filter, expand src, open app.ts preview, scroll with down arrow, insert with Space
		model.setFilter("");
		sidebar.handleInput("\r"); // expand src
		sidebar.handleInput("j"); // auth dir
		sidebar.handleInput("j"); // app.ts
		sidebar.handleInput("\r"); // open preview
		expect(model.getPreview()?.path).toBe("src/app.ts");
		sidebar.handleInput("j"); // scroll preview down 1 line
		expect(model.getPreviewScrollOffset()).toBe(1);

		const drawer = new FilePreviewDrawerComponent(model, () => 24);
		const drawerLines = drawer.render(80).map((l) => stripVTControlCharacters(l));
		expect(drawerLines[0]).toContain("src/app.ts");
		expect(drawerLines[0]).toContain("L2-");
		expect(drawerLines.some((l) => l.includes("export const line2 = 2;"))).toBe(true);

		sidebar.handleInput(" "); // Space inserts previewed path
		expect(inserted).toEqual(["src/auth/token.ts", "src/app.ts"]);

		// Escape closes preview first, second Escape returns focus
		sidebar.handleInput("\x1b");
		expect(model.getPreview()).toBeNull();
		expect(returnedFocus).toBe(0);
		sidebar.handleInput("\x1b");
		expect(returnedFocus).toBe(1);

		// Ctrl+B collapses to vertical rail
		sidebar.handleInput("\x02");
		expect(model.getMode()).toBe("collapsed");
		expect(filesSidebarGutterWidth("collapsed", 28, 120, 32)).toBe(FILES_SIDEBAR_RAIL_WIDTH);
	});

	it("handles SGR mouse click on rows, @ column, toolbar, wheel scroll, and workspace focus return", () => {
		const model = new FilesSidebarModel(root, "open", 28);
		const inserted: string[] = [];
		let focusSide = 0;
		let returnEd = 0;
		let toggled = 0;

		const ctx = {
			model,
			termWidth: 120,
			termHeight: 32,
			treeViewportRows: 24,
			onFocusSidebar: () => {
				focusSide += 1;
			},
			onReturnFocus: () => {
				returnEd += 1;
			},
			onToggleMode: () => {
				toggled += 1;
				model.toggleMode();
			},
			onInsertPath: (p: string) => inserted.push(p),
			onRequestRender: () => {},
		};

		// Click row 5 (first entry = src dir) -> expands src
		const clickDir = parseSgrMouse("\x1b[<0;8;5M");
		expect(clickDir).not.toBeNull();
		expect(handleFilesSidebarMouse(clickDir!, ctx)).toBe(true);
		expect(focusSide).toBe(1);
		expect(model.getVisibleRows().some((r) => r.entry.path === "src/app.ts")).toBe(true);

		// Click @ column on row 7 (src/app.ts) -> inserts path directly
		const clickAt = parseSgrMouse("\x1b[<0;27;7M");
		expect(handleFilesSidebarMouse(clickAt!, ctx)).toBe(true);
		expect(inserted).toEqual(["src/app.ts"]);

		// Click right workspace -> returns focus to prompt editor
		const clickWs = parseSgrMouse("\x1b[<0;60;10M");
		expect(handleFilesSidebarMouse(clickWs!, ctx)).toBe(false);
		expect(returnEd).toBe(1);

		// Click ◂ close icon on row 1 right side -> collapses rail
		const clickClose = parseSgrMouse("\x1b[<0;27;1M");
		expect(handleFilesSidebarMouse(clickClose!, ctx)).toBe(true);
		expect(toggled).toBe(1);
		expect(model.getMode()).toBe("collapsed");
	});

	it("mounts by default on 120x32 TUI and supports /files <query> instant search", async () => {
		const terminal = new VirtualTerminal(120, 32);
		const tui = new TUI(terminal);
		const settings = SettingsManager.inMemory({});
		const inserted: string[] = [];
		const fakeEditor = { invalidate() {}, render: (w: number) => ["EDITOR".padEnd(w)] };
		tui.addChild(fakeEditor);

		const ctrl = setupFilesSidebar({
			ui: tui,
			settingsManager: settings,
			getCwd: () => root,
			getEditor: () => fakeEditor,
			insertTextIntoEditor: (t) => inserted.push(t),
		});

		tui.start();
		await new Promise((r) => setTimeout(r, 15));
		await terminal.flush();

		expect(ctrl.model.getMode()).toBe("open");
		expect(tui.contentWidth).toBe(120 - FILES_SIDEBAR_DEFAULT_WIDTH - 1);

		const msg = ctrl.handleCommand("token");
		expect(msg).toContain('Searching files for "token"');
		expect(ctrl.model.isFiltering()).toBe(true);
		expect(ctrl.model.getVisibleRows().map((r) => r.entry.path)).toEqual(["src/auth/token.ts"]);

		ctrl.handleCommand("off");
		await terminal.flush();
		expect(tui.contentWidth).toBe(120);
		tui.stop();
	});
});
