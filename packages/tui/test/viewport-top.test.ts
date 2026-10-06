import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class Lines implements Component {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

function mkLines(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `L${index + 1}`);
}

describe("TUI.viewportTop", () => {
	it("is 0 while the frame fits and the first visible buffer row once it scrolls", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new Lines();
		tui.addChild(component);
		component.lines = mkLines(5);
		tui.start();
		await terminal.waitForRender();
		assert.strictEqual(tui.viewportTop, 0);

		component.lines = mkLines(25);
		tui.requestRender();
		await terminal.waitForRender();
		assert.strictEqual(tui.viewportTop, 15);
		tui.stop();
	});
});
