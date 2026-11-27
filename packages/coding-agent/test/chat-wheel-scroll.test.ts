import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type Component, Container, type Focusable, Text, TUI, visibleWidth, WindowedContainer } from "omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	type ChatScrollState,
	reduceChatScrollState,
	resolveChatScrollSlice,
} from "../src/modes/interactive/components/chat-wheel-scroll.ts";
import {
	hasSgrFastScrollModifier,
	isSgrWheelDown,
	isSgrWheelUp,
	parseSgrMouse,
} from "../src/modes/interactive/components/files-sidebar-mouse.ts";
import { setupFilesSidebar } from "../src/modes/interactive/files-sidebar-setup.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

class FakeFocusableEditor implements Component, Focusable {
	focused = false;
	public receivedInputs: string[] = [];
	private text = "";

	getText(): string {
		return this.text;
	}

	setText(next: string): void {
		this.text = next;
	}

	handleInput(data: string): void {
		this.receivedInputs.push(data);
		if (data === "\r") {
			this.text = "";
			return;
		}
		if (!data.startsWith("\x1b")) {
			this.text += data;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const border = "─".repeat(Math.max(0, width - 2));
		const body = `PROMPT> ${this.text}`.slice(0, Math.max(0, width - 2));
		return [`┌${border}┐`, `│${body.padEnd(Math.max(0, width - 2))}│`, `└${border}┘`];
	}
}

describe("chat session mouse wheel up/down scrolling", () => {
	let root: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-chat-wheel-"));
		mkdirSync(join(root, "src"), { recursive: true });
		for (let i = 1; i <= 25; i++) {
			writeFileSync(join(root, "src", `file-${String(i).padStart(2, "0")}.ts`), `export const v = ${i};\n`);
		}
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("parses SGR wheel up/down events including Shift/Alt/Ctrl modifiers and ignores releases", () => {
		const wheelUp = parseSgrMouse("\x1b[<64;50;12M")!;
		const wheelDown = parseSgrMouse("\x1b[<65;50;12M")!;
		const shiftWheelUp = parseSgrMouse("\x1b[<68;50;12M")!;
		const ctrlWheelDown = parseSgrMouse("\x1b[<81;50;12M")!;
		const wheelRelease = parseSgrMouse("\x1b[<64;50;12m")!;
		const leftClick = parseSgrMouse("\x1b[<0;50;12M")!;

		expect(isSgrWheelUp(wheelUp)).toBe(true);
		expect(isSgrWheelDown(wheelUp)).toBe(false);
		expect(hasSgrFastScrollModifier(wheelUp)).toBe(false);

		expect(isSgrWheelDown(wheelDown)).toBe(true);
		expect(isSgrWheelUp(wheelDown)).toBe(false);

		expect(isSgrWheelUp(shiftWheelUp)).toBe(true);
		expect(hasSgrFastScrollModifier(shiftWheelUp)).toBe(true);

		expect(isSgrWheelDown(ctrlWheelDown)).toBe(true);
		expect(hasSgrFastScrollModifier(ctrlWheelDown)).toBe(true);

		expect(isSgrWheelUp(wheelRelease)).toBe(false);
		expect(isSgrWheelUp(leftClick)).toBe(false);
		expect(isSgrWheelDown(leftClick)).toBe(false);
	});

	it("reduces scroll state cleanly with top clamping, streaming scroll-lock, and tail recovery", () => {
		const lines60 = Array.from({ length: 60 }, (_, i) => `Row ${i + 1}`);
		const tail: ChatScrollState = { kind: "tail" };

		// Short transcript stays at tail
		expect(reduceChatScrollState(tail, -3, 10, 12)).toEqual({ kind: "tail" });
		expect(resolveChatScrollSlice(tail, lines60.slice(0, 10), 12)).toBeNull();

		// Wheel up 3 lines on 60-line transcript with 12-row viewport (11 content rows + 1 status bar)
		const up1 = reduceChatScrollState(tail, -3, 60, 12);
		expect(up1).toEqual({ kind: "scrolled", anchorEndLine: 57 });
		const slice1 = resolveChatScrollSlice(up1, lines60, 12)!;
		expect(slice1.visibleLines).toEqual(lines60.slice(46, 57));
		expect(slice1.startLine).toBe(47);
		expect(slice1.endLine).toBe(57);
		expect(slice1.linesBelow).toBe(3);

		// Streaming appends 15 new lines: anchorEndLine locks the user's reading position
		const lines75 = Array.from({ length: 75 }, (_, i) => `Row ${i + 1}`);
		const sliceDuringStream = resolveChatScrollSlice(up1, lines75, 12)!;
		expect(sliceDuringStream.visibleLines).toEqual(lines75.slice(46, 57));
		expect(sliceDuringStream.linesBelow).toBe(18);

		// Clamps cleanly at the very top (lines 1..11)
		const atTop = reduceChatScrollState(up1, -500, 60, 12);
		expect(atTop).toEqual({ kind: "scrolled", anchorEndLine: 11 });
		const topSlice = resolveChatScrollSlice(atTop, lines60, 12)!;
		expect(topSlice.startLine).toBe(1);
		expect(topSlice.endLine).toBe(11);
		expect(topSlice.visibleLines[0]).toBe("Row 1");

		// Scrolling down to or past the end returns to live tail
		const backToTail = reduceChatScrollState({ kind: "scrolled", anchorEndLine: 58 }, 3, 60, 12);
		expect(backToTail).toEqual({ kind: "tail" });
	});

	it("scrolls chat history up and down via mouse wheel in TUI while keeping sidebar and prompt intact", async () => {
		const terminal = new VirtualTerminal(120, 20);
		const tui = new TUI(terminal);
		const settings = SettingsManager.inMemory({});

		const header = new Container();
		header.addChild(new Text("HEADER_TOP_BANNER", 0, 0));

		const chat = new WindowedContainer();
		chat.setLiveLineBudget(16);
		chat.setPrefixSeed(8);
		for (let i = 1; i <= 40; i++) {
			chat.addChild(new Text(`CHAT_LINE_${String(i).padStart(2, "0")}`, 0, 0));
		}

		const pending = new Container();
		const status = new Container();
		const editorContainer = new Container();
		const editor = new FakeFocusableEditor();
		editorContainer.addChild(editor);

		tui.addChild(header);
		tui.addChild(chat);
		tui.addChild(pending);
		tui.addChild(status);
		tui.addChild(editorContainer);
		tui.setFocus(editor);

		const ctrl = setupFilesSidebar({
			ui: tui,
			settingsManager: settings,
			getCwd: () => root,
			getEditor: () => editor,
			insertTextIntoEditor: (t) => editor.setText(`${editor.getText()}${t}`),
		});

		tui.start();
		await new Promise((r) => setTimeout(r, 20));
		await terminal.flush();

		const readViewport = () => terminal.getViewport().map((l) => stripVTControlCharacters(l));

		// Initially at tail: latest line visible, prompt visible, virtual prefix active on chat
		expect(chat.getVirtualChildCount()).toBeGreaterThan(0);
		let vp = readViewport();
		expect(vp.some((l) => l.includes("CHAT_LINE_40"))).toBe(true);
		expect(vp.some((l) => l.includes("PROMPT>"))).toBe(true);

		// Wheel up twice in the chat workspace (col 60, row 8)
		terminal.sendInput("\x1b[<64;60;8M");
		terminal.sendInput("\x1b[<64;60;8M");
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();

		vp = readViewport();
		expect(editor.receivedInputs).toEqual([]);
		expect(ctrl.model.getScrollOffset()).toBe(0);
		expect(vp.some((l) => l.includes("PROMPT>"))).toBe(true);
		expect(vp.some((l) => l.includes("HISTORY"))).toBe(true);
		expect(vp.some((l) => l.includes("CHAT_LINE_40"))).toBe(false);
		expect(vp.some((l) => l.includes("CHAT_LINE_34"))).toBe(true);
		for (const rawLine of terminal.getViewport()) {
			expect(visibleWidth(rawLine)).toBeLessThanOrEqual(120);
		}

		// Shift+Wheel up fast-scrolls all the way to virtualized prefix + header top
		for (let i = 0; i < 6; i++) {
			terminal.sendInput("\x1b[<68;60;8M");
		}
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();

		vp = readViewport();
		expect(vp.some((l) => l.includes("HEADER_TOP_BANNER"))).toBe(true);
		expect(vp.some((l) => l.includes("CHAT_LINE_01"))).toBe(true);
		expect(vp.some((l) => l.includes("PROMPT>"))).toBe(true);

		// Wheel down a couple ticks moves downward
		terminal.sendInput("\x1b[<65;60;8M");
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();
		vp = readViewport();
		expect(vp.some((l) => l.includes("HEADER_TOP_BANNER"))).toBe(false);

		// Clicking the scroll status hairline row (row 17 = 20 - 3 editor rows) jumps back to latest
		terminal.sendInput("\x1b[<0;80;17M");
		terminal.sendInput("\x1b[<0;80;17m");
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();

		vp = readViewport();
		expect(vp.some((l) => l.includes("HISTORY"))).toBe(false);
		expect(vp.some((l) => l.includes("CHAT_LINE_40"))).toBe(true);
		expect(editor.receivedInputs).toEqual([]);
		// Streaming an unsettled child while scrolled up keeps reading position locked and updates below count
		let streamedRows = ["STREAM_1", "STREAM_2"];
		const streamingChild: Component & { isRenderSettled(): boolean } = {
			isRenderSettled: () => false,
			invalidate() {},
			render: () => streamedRows,
		};
		chat.addChild(streamingChild);
		tui.requestRender();
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();

		terminal.sendInput("\x1b[<64;60;8M"); // wheel up 3 lines while streaming
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();
		vp = readViewport();
		expect(vp.some((l) => l.includes("↓ 3 below"))).toBe(true);

		// Stream appends 4 more lines without bumping renderGeneration
		streamedRows = ["STREAM_1", "STREAM_2", "STREAM_3", "STREAM_4", "STREAM_5", "STREAM_6"];
		tui.requestRender();
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();
		vp = readViewport();
		expect(vp.some((l) => l.includes("↓ 7 below"))).toBe(true);

		// Submitting a non-empty prompt via Enter automatically returns to live tail
		editor.setText("next prompt");
		terminal.sendInput("\r");
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();
		vp = readViewport();
		expect(vp.some((l) => l.includes("HISTORY"))).toBe(false);
		expect(vp.some((l) => l.includes("STREAM_6"))).toBe(true);

		// Forwarding wheel events to an active selector when editor does not hold focus
		const selectorInputs: string[] = [];
		const fakeSelector: Component & Focusable = {
			focused: false,
			handleInput(data: string) {
				selectorInputs.push(data);
			},
			invalidate() {},
			render: (w: number) => ["SELECTOR".padEnd(w)],
		};
		editorContainer.clear();
		editorContainer.addChild(fakeSelector);
		tui.setFocus(fakeSelector);

		terminal.sendInput("\x1b[<64;60;8M");
		terminal.sendInput("\x1b[<65;60;8M");
		await new Promise((r) => setTimeout(r, 25));
		await terminal.flush();
		expect(selectorInputs).toEqual(["\x1b[A", "\x1b[B"]);

		tui.stop();
	});
});
