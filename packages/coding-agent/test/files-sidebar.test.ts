import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { TUI, visibleWidth } from "omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import {
	isSecretFileName,
	listRepoDirectory,
	readSafeRepoFile,
	resolveSafeRepoPath,
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
import { setupFilesSidebar } from "../src/modes/interactive/files-sidebar-setup.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("repo-files-fs and FilesSidebar TUI", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-files-sidebar-"));
		mkdirSync(join(root, "src"));
		mkdirSync(join(root, "node_modules"));
		writeFileSync(join(root, "README.md"), "# Demo\nline two\n");
		writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
		writeFileSync(join(root, ".env"), "SECRET_KEY=topsecret\n");
		writeFileSync(join(root, "bin.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("enforces repository root containment, secret blocking, and binary detection", () => {
		expect(() => resolveSafeRepoPath(root, "../outside")).toThrow(/outside/i);
		expect(() => resolveSafeRepoPath(root, "/etc/passwd")).toThrow(/outside/i);
		expect(isSecretFileName(".env")).toBe(true);
		expect(isSecretFileName("id_rsa")).toBe(true);
		expect(isSecretFileName("README.md")).toBe(false);

		const listing = listRepoDirectory(root, "");
		expect(listing.entries.map((e) => e.name)).toEqual(["src", "bin.dat", "README.md"]);

		const hiddenListing = listRepoDirectory(root, "", { includeHidden: true });
		expect(hiddenListing.entries.map((e) => e.name)).toContain(".env");

		const secretPreview = readSafeRepoFile(root, ".env");
		expect(secretPreview.blocked).toBe(true);
		expect(secretPreview.content).toBe("");

		const binPreview = readSafeRepoFile(root, "bin.dat");
		expect(binPreview.binary).toBe(true);
		expect(binPreview.content).toBe("");

		const textPreview = readSafeRepoFile(root, "src/app.ts");
		expect(textPreview.blocked).toBe(false);
		expect(textPreview.binary).toBe(false);
		expect(textPreview.content).toContain("export const x = 1;");
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

	it("renders Paper Academic open sidebar, collapsed vertical rail, filter, preview drawer, and @ insertion", () => {
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
		expect(openLines[0]).toContain("REPO ·");
		expect(openLines[2]).toContain("Filter repo files...");
		expect(openLines.some((l) => l.includes("▸ ▣ src"))).toBe(true);
		for (const line of sidebar.render(28)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(28);
		}

		// Expand src directory with Enter, move down to app.ts, open preview, insert with @
		sidebar.handleInput("\r");
		expect(model.getVisibleRows().some((r) => r.entry.path === "src/app.ts")).toBe(true);
		sidebar.handleInput("j");
		expect(model.getSelectedEntry()?.path).toBe("src/app.ts");
		sidebar.handleInput("\r");
		expect(model.getPreview()?.path).toBe("src/app.ts");

		const drawer = new FilePreviewDrawerComponent(model, () => 24);
		const drawerLines = drawer.render(80).map((l) => stripVTControlCharacters(l));
		expect(drawerLines[0]).toContain("src/app.ts");
		expect(drawerLines.some((l) => l.includes("export const x = 1;"))).toBe(true);

		sidebar.handleInput("@");
		expect(inserted).toEqual(["src/app.ts"]);

		// Escape closes preview first, second Escape returns focus
		sidebar.handleInput("\x1b");
		expect(model.getPreview()).toBeNull();
		expect(returnedFocus).toBe(0);
		sidebar.handleInput("\x1b");
		expect(returnedFocus).toBe(1);

		// Toggle collapsed rail
		sidebar.handleInput("\x02");
		expect(model.getMode()).toBe("collapsed");
		expect(filesSidebarGutterWidth("collapsed", 28, 120, 32)).toBe(FILES_SIDEBAR_RAIL_WIDTH);
		const railLines = sidebar.render(3).map((l) => stripVTControlCharacters(l));
		expect(railLines[0]).toContain("▸");
		expect(railLines[2]).toContain("F");
		expect(railLines[6]).toContain("S");
	});

	it("mounts by default on 120x32 TUI and reserves left gutter cleanly", async () => {
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
		const viewport = terminal.getViewport().join("\n");
		expect(viewport).toContain("REPO ·");
		expect(viewport).toContain("README.md");

		ctrl.handleCommand("off");
		await terminal.flush();
		expect(tui.contentWidth).toBe(120);
		expect(settings.getShowFilesSidebar()).toBe(false);
		tui.stop();
	});
});
