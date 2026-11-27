import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listRepoDirectory, readSafeRepoFile, searchRepoFilesWithMeta } from "../src/core/repo-files-fs.ts";
import { FilePreviewDrawerComponent } from "../src/modes/interactive/components/file-preview-drawer.ts";
import { FilesSidebarComponent } from "../src/modes/interactive/components/files-sidebar.ts";
import { FilesSidebarModel } from "../src/modes/interactive/components/files-sidebar-model.ts";
import { handleFilesSidebarMouse } from "../src/modes/interactive/components/files-sidebar-mouse.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("N13: repo files listing/search limits surface partial status and expansion path", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-n13-limits-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("reports truncation metadata on directory listing (>300) and supports expansion while preserving read cap", () => {
		for (let i = 0; i < 320; i++) {
			writeFileSync(join(root, `f-${String(i).padStart(4, "0")}.txt`), "x");
		}
		writeFileSync(join(root, "big.txt"), "a".repeat(80_000));

		const listing = listRepoDirectory(root, "");
		expect(listing.truncated).toBe(true);
		expect(listing.entries).toHaveLength(300);
		expect(listing.totalEntries).toBe(321);

		// Read limit (64 KiB) remains enforced
		const preview = readSafeRepoFile(root, "big.txt");
		expect(preview.truncated).toBe(true);
		expect(Buffer.byteLength(preview.content, "utf8")).toBe(65_536);

		const model = new FilesSidebarModel(root, "open");
		expect(model.getTruncationStatus().truncated).toBe(true);
		expect(model.getTruncationStatus().canExpand).toBe(true);

		expect(model.expandExplorationLimit()).toBe(true);
		expect(model.getVisibleRows().length).toBe(321);
		expect(model.getTruncationStatus().truncated).toBe(false);
	});

	it("surfaces partial search status instead of 'No matching files' when match lies beyond scan cap and expands search", () => {
		// Create 1600 files so a file near the end lies past the default 1500-entry scan cap
		mkdirSync(join(root, "a-batch"), { recursive: true });
		for (let i = 0; i < 1550; i++) {
			writeFileSync(join(root, "a-batch", `item-${String(i).padStart(4, "0")}.txt`), "x");
		}
		mkdirSync(join(root, "z-tail"), { recursive: true });
		writeFileSync(join(root, "z-tail", "needle-target.ts"), "export const needle = 1;\n");

		const firstPass = searchRepoFilesWithMeta(root, "needle-target", { maxScanned: 1500 });
		expect(firstPass.truncated).toBe(true);
		expect(firstPass.truncationReasons).toContain("scan_limit");

		const model = new FilesSidebarModel(root, "open");
		model.setFilter("needle-target");
		const sidebar = new FilesSidebarComponent(model, {
			getRows: () => 24,
			requestRender: () => {},
			onInsertPath: () => {},
			onReturnFocus: () => {},
			onToggleMode: () => {},
		});

		const renderedPartial = sidebar
			.render(32)
			.map((l) => stripVTControlCharacters(l))
			.join("\n");
		expect(renderedPartial).not.toContain("No matching files");
		expect(renderedPartial).toMatch(/partial|cap|limit|\+/i);

		// Expanding exploration limit finds the target past 1500 scanned entries
		expect(model.expandExplorationLimit()).toBe(true);
		const rowsAfter = model.getVisibleRows();
		expect(rowsAfter.some((r) => r.entry.path === "z-tail/needle-target.ts")).toBe(true);
	});
});

describe("N14: files sidebar wheel scroll persistence and 24-row preview tail reachability", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-n14-scroll-"));
		for (let i = 1; i <= 40; i++) {
			writeFileSync(join(root, `file-${String(i).padStart(2, "0")}.ts`), `export const n = ${i};\n`);
		}
		writeFileSync(
			join(root, "thirty.ts"),
			Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"),
		);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("preserves wheel-scrolled offset across re-renders without snapping back to selectedIndex", () => {
		const model = new FilesSidebarModel(root, "open");
		const sidebar = new FilesSidebarComponent(model, {
			getRows: () => 20,
			requestRender: () => {},
			onInsertPath: () => {},
			onReturnFocus: () => {},
			onToggleMode: () => {},
		});

		sidebar.render(28);
		expect(model.getScrollOffset()).toBe(0);

		// Wheel scroll down 6 rows while selectedIndex stays at 0
		model.scrollTree(6, sidebar.getTreeViewportRows());
		expect(model.getScrollOffset()).toBe(6);

		// Re-rendering MUST NOT snap scrollOffset back to 0!
		const rendered = sidebar
			.render(28)
			.map((l) => stripVTControlCharacters(l))
			.join("\n");
		expect(model.getScrollOffset()).toBe(6);
		expect(rendered).toContain("file-07.ts");
		expect(rendered).not.toContain("file-01.ts");

		// Keyboard selection movement resumes following selection cleanly
		model.moveSelection(1, sidebar.getTreeViewportRows());
		sidebar.render(28);
		expect(model.getScrollOffset()).toBeLessThanOrEqual(1);
	});

	it("reaches all 30 lines (including lines 27-30) of a 30-line file in a 24-row terminal via keyboard and mouse wheel", () => {
		const termHeight = 24;
		const termWidth = 120;
		const model = new FilesSidebarModel(root, "open");
		model.openPreview("thirty.ts");

		const drawer = new FilePreviewDrawerComponent(model, () => termHeight);
		const sidebar = new FilesSidebarComponent(model, {
			getRows: () => termHeight,
			requestRender: () => {},
			onInsertPath: () => {},
			onReturnFocus: () => {},
			onToggleMode: () => {},
		});

		// Scroll down repeatedly via keyboard input ("j")
		for (let i = 0; i < 40; i++) sidebar.handleInput("j");
		const afterKeys = drawer
			.render(88)
			.map((l) => stripVTControlCharacters(l))
			.join("\n");
		expect(afterKeys).toContain("line30 = 30");
		expect(afterKeys).toContain("L23-30/30");

		// Reset and scroll down repeatedly via mouse wheel in preview drawer
		model.openPreview("thirty.ts");
		for (let i = 0; i < 15; i++) {
			handleFilesSidebarMouse(
				{ button: 65, col: 60, row: 20, release: false },
				{
					model,
					termWidth,
					termHeight,
					treeViewportRows: sidebar.getTreeViewportRows(),
					onFocusSidebar: () => {},
					onReturnFocus: () => {},
					onToggleMode: () => {},
					onInsertPath: () => {},
					onRequestRender: () => {},
				},
			);
		}
		const afterWheel = drawer
			.render(88)
			.map((l) => stripVTControlCharacters(l))
			.join("\n");
		expect(afterWheel).toContain("line30 = 30");
		expect(afterWheel).toContain("L23-30/30");
	});
});
