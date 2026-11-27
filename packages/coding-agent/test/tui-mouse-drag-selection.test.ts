import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type Component, type Focusable, Text, TUI, visibleWidth } from "omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	isSgrLeftDrag,
	isSgrLeftRelease,
	parseSgrMouse,
	setProcessMouseMode,
} from "../src/modes/interactive/components/files-sidebar-mouse.ts";
import { setupFilesSidebar } from "../src/modes/interactive/files-sidebar-setup.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

class FakeEditor implements Component, Focusable {
	focused = false;
	public received: string[] = [];
	private text = "";

	getText(): string {
		return this.text;
	}

	setText(next: string): void {
		this.text = next;
	}

	handleInput(data: string): void {
		this.received.push(data);
		if (!data.startsWith("\x1b") && data !== "\x03") this.text += data;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		return [
			`┌${"─".repeat(inner)}┐`,
			`│${`> ${this.text}`.slice(0, inner).padEnd(inner)}│`,
			`└${"─".repeat(inner)}┘`,
		];
	}
}

describe("OMK TUI mouse drag text selection", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-drag-select-"));
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "demo.ts"), "export const greeting = 'hello preview';\nexport const two = 2;\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("enables and disables SGR button-motion tracking (?1002h/?1002l) and parses left drag/release", () => {
		const origIsTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		const writes: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		process.stdout.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		try {
			setProcessMouseMode(true, true);
			setProcessMouseMode(false, true);
		} finally {
			process.stdout.write = origWrite;
			if (origIsTty) Object.defineProperty(process.stdout, "isTTY", origIsTty);
			else delete (process.stdout as { isTTY?: boolean }).isTTY;
		}
		expect(writes[0]).toContain("\x1b[?1000h");
		expect(writes[0]).toContain("\x1b[?1002h");
		expect(writes[0]).toContain("\x1b[?1006h");
		expect(writes[1]).toContain("\x1b[?1002l");
		expect(writes[1]).toContain("\x1b[?1000l");
		expect(writes[1]).toContain("\x1b[?1006l");

		const drag = parseSgrMouse("\x1b[<32;45;5M")!;
		const release = parseSgrMouse("\x1b[<0;45;5m")!;
		expect(isSgrLeftDrag(drag)).toBe(true);
		expect(isSgrLeftRelease(drag)).toBe(false);
		expect(isSgrLeftRelease(release)).toBe(true);
		expect(isSgrLeftDrag(release)).toBe(false);
	});

	it("highlights and copies single-line, multi-line, backward, and Korean text clamped to the main workspace pane", async () => {
		const term = new VirtualTerminal(120, 16);
		const rawWrites: string[] = [];
		const origTermWrite = term.write.bind(term);
		term.write = (data: string) => {
			rawWrites.push(data);
			origTermWrite(data);
		};
		const ui = new TUI(term);
		const editor = new FakeEditor();
		const copied: string[] = [];
		const settings = SettingsManager.inMemory({ showFilesSidebar: true });

		ui.addChild(new Text("TOP HEADER LINE", 0, 0));
		ui.addChild(new Text("Hello world from OMK drag test", 0, 0));
		ui.addChild(new Text("\x1b[32m안녕하세요\x1b[0m OMK 드래그 복사", 0, 0));
		ui.addChild(new Text("third line alpha beta", 0, 0));
		ui.addChild(editor);

		setupFilesSidebar({
			ui,
			settingsManager: settings,
			getCwd: () => root,
			getEditor: () => editor,
			insertTextIntoEditor: (t) => editor.setText(`${editor.getText()}${t}`),
			onCopySelection: (text) => {
				copied.push(text);
			},
		});

		ui.setFocus(editor);
		ui.start();
		await new Promise((r) => setTimeout(r, 20));
		await term.flush();

		const flushUi = async () => {
			await new Promise((r) => setTimeout(r, 20));
			await term.flush();
		};

		// Find where "Hello world" is rendered (left gutter is 29 cols: 28 sidebar + 1 gap -> col 30 is 'H').
		const screenBefore = term.getViewport().map((l) => stripVTControlCharacters(l));
		const row1Idx = screenBefore.findIndex((line) => line.includes("Hello world"));
		expect(row1Idx).toBeGreaterThanOrEqual(0);
		const row1 = row1Idx + 1;
		const helloCol = visibleWidth(screenBefore[row1Idx]!.slice(0, screenBefore[row1Idx]!.indexOf("Hello"))) + 1;

		// 1) Simple click without drag should NOT copy anything.
		term.sendInput(`\x1b[<0;${helloCol};${row1}M`);
		term.sendInput(`\x1b[<0;${helloCol};${row1}m`);
		await flushUi();
		expect(copied).toEqual([]);

		// 2) Drag forward across "Hello world" on row 1.
		term.sendInput(`\x1b[<0;${helloCol};${row1}M`);
		term.sendInput(`\x1b[<32;${helloCol + 10};${row1}M`);
		await flushUi();
		const rawDuringDrag = rawWrites.join("");
		expect(rawDuringDrag).toContain("\x1b[7mHello world\x1b[0m");
		term.sendInput(`\x1b[<0;${helloCol + 10};${row1}m`);
		await flushUi();
		expect(copied).toEqual(["Hello world"]);

		// 3) Ctrl+C while selected re-copies and clears selection without reaching the editor.
		term.sendInput("\x03");
		await flushUi();
		expect(copied).toEqual(["Hello world", "Hello world"]);
		expect(editor.received).not.toContain("\x03");

		// 4) Multi-line drag spanning row 1 -> row 2 (Korean wide chars), dragging past left sidebar col 5,
		// must stay clamped to the main workspace pane and never include sidebar files or borders.
		const row2 = row1 + 1;
		term.sendInput(`\x1b[<0;${helloCol + 6};${row1}M`);
		term.sendInput(`\x1b[<32;5;${row2}M`);
		term.sendInput(`\x1b[<32;${helloCol + 14};${row2}M`);
		term.sendInput(`\x1b[<0;${helloCol + 14};${row2}m`);
		await flushUi();
		expect(copied[2]).toBe("world from OMK drag test\n안녕하세요 OMK");
		expect(copied[2]).not.toContain("FILES");
		expect(copied[2]).not.toContain("│");

		// 5) Backward drag (right-to-left on Korean line) copies cleanly.
		term.sendInput(`\x1b[<0;${helloCol + 9};${row2}M`);
		term.sendInput(`\x1b[<32;${helloCol};${row2}M`);
		term.sendInput(`\x1b[<0;${helloCol};${row2}m`);
		await flushUi();
		expect(copied[3]).toBe("안녕하세요");

		// 6) Typing a regular key clears selection and passes the key to the editor.
		term.sendInput("x");
		await flushUi();
		expect(editor.getText()).toBe("x");

		ui.stop();
	});

	it("allows dragging text inside the File Preview Drawer body while keeping header close click working", async () => {
		const term = new VirtualTerminal(120, 24);
		const ui = new TUI(term);
		const editor = new FakeEditor();
		const copied: string[] = [];
		const settings = SettingsManager.inMemory({ showFilesSidebar: true });

		ui.addChild(new Text("chat line", 0, 0));
		ui.addChild(editor);

		const ctrl = setupFilesSidebar({
			ui,
			settingsManager: settings,
			getCwd: () => root,
			getEditor: () => editor,
			insertTextIntoEditor: (t) => editor.setText(`${editor.getText()}${t}`),
			onCopySelection: (text) => {
				copied.push(text);
			},
		});
		ctrl.model.openPreview("src/demo.ts");
		ui.setFocus(editor);
		ui.start();
		await new Promise((r) => setTimeout(r, 20));
		await term.flush();

		const flushUi = async () => {
			await new Promise((r) => setTimeout(r, 20));
			await term.flush();
		};

		const viewport = term.getViewport().map((l) => stripVTControlCharacters(l));
		const previewRowIdx = viewport.findIndex((l) => l.includes("hello preview"));
		expect(previewRowIdx).toBeGreaterThanOrEqual(0);
		const previewRow = previewRowIdx + 1;
		const startCol =
			visibleWidth(viewport[previewRowIdx]!.slice(0, viewport[previewRowIdx]!.indexOf("hello preview"))) + 1;

		term.sendInput(`\x1b[<0;${startCol};${previewRow}M`);
		term.sendInput(`\x1b[<32;${startCol + 12};${previewRow}M`);
		term.sendInput(`\x1b[<0;${startCol + 12};${previewRow}m`);
		await flushUi();
		expect(copied).toEqual(["hello preview"]);

		// Clicking top-right close button on preview drawer still closes preview.
		const drawerHeight = Math.max(6, Math.min(16, Math.floor(24 * 0.42)));
		const drawerTop = 24 - drawerHeight + 1;
		expect(ctrl.model.getPreview()).not.toBeNull();
		term.sendInput(`\x1b[<0;118;${drawerTop}M`);
		await flushUi();
		expect(ctrl.model.getPreview()).toBeNull();
		ui.stop();
	});
});
