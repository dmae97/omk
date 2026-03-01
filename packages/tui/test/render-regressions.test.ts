import { describe, expect, it } from "bun:test";
import { type Component, TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

class MutableLinesComponent implements Component {
	#lines: string[];

	constructor(lines: string[]) {
		this.#lines = [...lines];
	}

	setLines(lines: string[]): void {
		this.#lines = [...lines];
	}

	invalidate(): void {}

	render(width: number): string[] {
		return this.#lines.map(line => line.slice(0, width));
	}
}

function rows(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_v, i) => `${prefix}${i}`);
}

async function settle(term: VirtualTerminal): Promise<void> {
	await Bun.sleep(0);
	await term.flush();
}

function visible(term: VirtualTerminal): string[] {
	return term.getViewport().map(line => line.trimEnd());
}

function countMatches(lines: string[], pattern: RegExp): number {
	let count = 0;
	for (const line of lines) {
		if (pattern.test(line)) count += 1;
	}
	return count;
}

describe("TUI terminal-state regressions", () => {
	describe("cursor + differential stability", () => {
		it("keeps stable output across repeated no-op renders", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["hello", "world", "stable"]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				const before = visible(term);

				for (let i = 0; i < 8; i++) {
					tui.requestRender();
					await settle(term);
				}

				expect(visible(term)).toEqual(before);
			} finally {
				tui.stop();
			}
		});

		it("updates only changed middle line without corrupting neighbors", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["AAA", "BBB", "CCC", "DDD", "EEE"]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				const before = visible(term);

				component.setLines(["AAA", "BBB", "XXX", "DDD", "EEE"]);
				tui.requestRender();
				await settle(term);

				const after = visible(term);
				expect(after[0]).toBe(before[0]);
				expect(after[1]).toBe(before[1]);
				expect(after[2]?.trim()).toBe("XXX");
				expect(after[3]).toBe(before[3]);
				expect(after[4]).toBe(before[4]);
			} finally {
				tui.stop();
			}
		});

		it("clears removed tail lines after shrink", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["A", "B", "C", "D", "E"]);
			tui.setClearOnShrink(true);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				component.setLines(["A", "B"]);
				tui.requestRender();
				await settle(term);

				const viewport = visible(term);
				expect(viewport[0]?.trim()).toBe("A");
				expect(viewport[1]?.trim()).toBe("B");
				expect(viewport[2]?.trim()).toBe("");
				expect(viewport[3]?.trim()).toBe("");
				expect(viewport[4]?.trim()).toBe("");
			} finally {
				tui.stop();
			}
		});
	});

	describe("resize + viewport behavior", () => {
		it("clears preexisting shell rows on startup and resize redraw", async () => {
			const term = new VirtualTerminal(50, 5);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
			await settle(term);

			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("ui-", 8));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				term.resize(49, 5);
				await settle(term);

				const buffer = term.getScrollBuffer().join("\n");
				expect(buffer.includes("shell-")).toBeFalsy();
			} finally {
				tui.stop();
			}
		});

		it("resizing width truncates visible lines without ghost wrap rows", async () => {
			const term = new VirtualTerminal(30, 6);
			const tui = new TUI(term);
			const component = new MutableLinesComponent([
				"012345678901234567890123456789012345",
				"ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
			]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				term.resize(16, 6);
				await settle(term);

				const viewport = visible(term);
				expect(viewport[0]!.length).toBeLessThanOrEqual(16);
				expect(viewport[1]!.length).toBeLessThanOrEqual(16);
				expect(viewport[2]?.trim()).toBe("");
			} finally {
				tui.stop();
			}
		});

		it("shrink then grow keeps tail anchored to latest rows", async () => {
			const term = new VirtualTerminal(24, 6);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("row-", 30));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				component.setLines(rows("row-", 16));
				tui.requestRender();
				await settle(term);

				component.setLines(rows("row-", 24));
				tui.requestRender();
				await settle(term);

				const viewport = visible(term).filter(line => line.trim().length > 0);
				expect(viewport).toHaveLength(6);
				expect(viewport[0]?.trim()).toBe("row-18");
				expect(viewport[5]?.trim()).toBe("row-23");
			} finally {
				tui.stop();
			}
		});
	});

	describe("scrollback integrity", () => {
		it("overflow content appears once across buffer without duplicate row IDs", async () => {
			const term = new VirtualTerminal(32, 5);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 10));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				const all = term.getScrollBuffer();
				for (let i = 0; i < 10; i++) {
					const pattern = new RegExp(`\\bline-${i}\\b`);
					expect(countMatches(all, pattern), `line-${i} should appear exactly once`).toBe(1);
				}
			} finally {
				tui.stop();
			}
		});

		it("forced full redraws do not duplicate persistent content", async () => {
			const term = new VirtualTerminal(40, 5);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["alpha", "beta", "gamma"]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let i = 0; i < 5; i++) {
					tui.requestRender(true);
					await settle(term);
				}

				const allText = term.getScrollBuffer().join("\n");
				expect((allText.match(/alpha/g) ?? []).length).toBe(1);
				expect((allText.match(/beta/g) ?? []).length).toBe(1);
				expect((allText.match(/gamma/g) ?? []).length).toBe(1);
			} finally {
				tui.stop();
			}
		});
	});

	describe("overlay compositing", () => {
		it("overlay show/hide restores underlying content", async () => {
			const term = new VirtualTerminal(40, 8);
			const tui = new TUI(term);
			const base = new MutableLinesComponent(rows("base-", 8));
			tui.addChild(base);

			try {
				tui.start();
				await settle(term);

				const handle = tui.showOverlay(new MutableLinesComponent(["OVERLAY-0", "OVERLAY-1"]), {
					anchor: "top-left",
					row: 2,
					col: 4,
				});
				await settle(term);

				expect(visible(term)[2]?.includes("OVERLAY-0")).toBeTruthy();
				expect(visible(term)[3]?.includes("OVERLAY-1")).toBeTruthy();

				handle.hide();
				await settle(term);

				const viewport = visible(term);
				expect(viewport[2]?.trim()).toBe("base-2");
				expect(viewport[3]?.trim()).toBe("base-3");
			} finally {
				tui.stop();
			}
		});
	});

	describe("stress scenarios", () => {
		it("rapid content mutations converge to final expected screen", async () => {
			const term = new VirtualTerminal(30, 8);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["init"]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let i = 0; i < 80; i++) {
					const n = (i % 7) + 1;
					component.setLines(Array.from({ length: n }, (_v, j) => `iter-${i}-line-${j}`));
					tui.requestRender();
					await settle(term);
				}

				const expected = Array.from({ length: 3 }, (_v, j) => `iter-79-line-${j}`);
				const viewport = visible(term);
				expect(viewport[0]?.trim()).toBe(expected[0]);
				expect(viewport[1]?.trim()).toBe(expected[1]);
				expect(viewport[2]?.trim()).toBe(expected[2]);
				expect(viewport[3]?.trim()).toBe("");
			} finally {
				tui.stop();
			}
		});
	});
});
