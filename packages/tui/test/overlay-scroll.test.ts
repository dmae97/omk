import { describe, expect, it } from "bun:test";
import { type Component, TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

class LineComponent implements Component {
	constructor(
		private readonly prefix: string,
		private readonly count: number,
	) {}

	invalidate(): void {
		// No cached state
	}

	render(_width: number): string[] {
		return Array.from({ length: this.count }, (_v, i) => `${this.prefix}${i}`);
	}
}

class MutableLineComponent implements Component {
	#count: number;

	constructor(
		private readonly prefix: string,
		count: number,
	) {
		this.#count = count;
	}

	setCount(count: number): void {
		this.#count = count;
	}

	invalidate(): void {
		// No cached state
	}

	render(_width: number): string[] {
		return Array.from({ length: this.#count }, (_v, i) => `${this.prefix}${i}`);
	}
}

class MutableContentComponent implements Component {
	#lines: string[];

	constructor(lines: string[]) {
		this.#lines = [...lines];
	}

	setLines(lines: string[]): void {
		this.#lines = [...lines];
	}

	invalidate(): void {
		// No cached state
	}

	render(_width: number): string[] {
		return [...this.#lines];
	}
}

describe("TUI overlays", () => {
	it("does not scroll the terminal when an overlay is shown with a large historical working area", async () => {
		const term = new VirtualTerminal(80, 24);
		const tui = new TUI(term);

		tui.addChild(new LineComponent("base-", 5));

		tui.start();
		await Bun.sleep(0);
		await term.flush();

		// Simulate a large historical working area (max lines ever rendered) without actually
		// rendering that many lines in the current view.
		(tui as unknown as { maxLinesRendered: number; previousViewportTop: number }).maxLinesRendered = 1500;
		(tui as unknown as { maxLinesRendered: number; previousViewportTop: number }).previousViewportTop = Math.max(
			0,
			1500 - term.rows,
		);

		tui.showOverlay(new LineComponent("overlay-", 3), { anchor: "center" });
		await Bun.sleep(0);
		await term.flush();

		// The scroll buffer should stay small; we should not have printed hundreds/thousands of blank lines.
		expect(term.getScrollBuffer().length).toBeLessThan(200);
	});

	it("preserves terminal scrollback on non-forced full rerender", async () => {
		const term = new VirtualTerminal(40, 4);
		term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
		await term.flush();

		const tui = new TUI(term);
		const component = new MutableContentComponent(["ui-0", "ui-1", "ui-2", "ui-3", "ui-4", "ui-5"]);
		tui.addChild(component);

		tui.start();
		await Bun.sleep(0);
		await term.flush();

		term.resize(39, 4);
		await Bun.sleep(0);
		await term.flush();

		const scrollback = term.getScrollBuffer().join("\n");
		expect(scrollback.includes("shell-0")).toBeTruthy();

		tui.stop();
	});

	it("fully redraws on height increase to avoid stale viewport rows", async () => {
		const term = new VirtualTerminal(40, 4);
		term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
		await term.flush();

		const tui = new TUI(term);
		const component = new MutableContentComponent(["ui-0", "ui-1", "ui-2", "ui-3"]);
		tui.addChild(component);

		tui.start();
		await Bun.sleep(0);
		await term.flush();

		term.resize(40, 8);
		await Bun.sleep(0);
		await term.flush();

		const viewport = term.getViewport().join("\n");
		expect(viewport.includes("shell-")).toBeFalsy();

		tui.stop();
	});
	it("clears first row when shrinking to empty with clearOnShrink disabled", async () => {
		const term = new VirtualTerminal(40, 10);
		const tui = new TUI(term);
		const component = new MutableLineComponent("line-", 3);

		tui.setClearOnShrink(false);
		tui.addChild(component);

		tui.start();
		await Bun.sleep(0);
		await term.flush();

		component.setCount(0);
		tui.requestRender();
		await Bun.sleep(0);
		await term.flush();

		expect(term.getViewport().every(line => line.trim().length === 0)).toBeTruthy();

		tui.stop();
	});
});
