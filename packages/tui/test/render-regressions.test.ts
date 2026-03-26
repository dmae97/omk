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

function longestBlankRun(lines: string[]): number {
	let longest = 0;
	let current = 0;
	for (const line of lines) {
		if (line.trim().length === 0) {
			current += 1;
			longest = Math.max(longest, current);
		} else {
			current = 0;
		}
	}
	return longest;
}

/** Count blank lines at the end of the buffer (after the last content line). */
function trailingBlanks(lines: string[]): number {
	let count = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim().length === 0) count++;
		else break;
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

		it("clears row 0 when content shrinks to empty without clearOnShrink", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(["A"]);
			tui.setClearOnShrink(false);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				component.setLines([]);
				tui.requestRender();
				await settle(term);

				const viewport = visible(term);
				expect(viewport[0]?.trim()).toBe("");
			} finally {
				tui.stop();
			}
		});
	});

	describe("resize + viewport behavior", () => {
		it("preserves preexisting shell rows across startup and resize redraws", async () => {
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
				expect(buffer.includes("shell-0")).toBeTruthy();
				expect(buffer.includes("shell-4")).toBeTruthy();
				expect(visible(term).join("\n").includes("shell-")).toBeFalsy();
			} finally {
				tui.stop();
			}
		});

		it("Termux no-op height increase does not replay overflowing viewport rows into scrollback", async () => {
			const previousTermuxVersion = process.env.TERMUX_VERSION;
			process.env.TERMUX_VERSION = "1";
			const term = new VirtualTerminal(40, 4);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("ui-", 12));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				expect(countMatches(term.getScrollBuffer(), /\bui-6\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-11\b/)).toBe(1);

				term.resize(40, 6);
				await settle(term);

				expect(countMatches(term.getScrollBuffer(), /\bui-6\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-7\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-8\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-9\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-10\b/)).toBe(1);
				expect(countMatches(term.getScrollBuffer(), /\bui-11\b/)).toBe(1);
			} finally {
				if (previousTermuxVersion === undefined) delete process.env.TERMUX_VERSION;
				else process.env.TERMUX_VERSION = previousTermuxVersion;
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

		it("maintains exact viewport rows across repeated width reflow on sparse mixed content", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines = [
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"Operation aborted",
				"",
				"Operation aborted",
				"",
				"┌──────────────┐",
				"",
				"┌──────────────┐",
				"│              │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"│ coding-agent │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"└───────┬──────┘",
				"        │",
				"        │",
			];
			tui.addChild(new MutableLinesComponent(lines));

			const expectedViewport = (width: number, height: number): string[] => {
				const rendered = lines.map(line => line.slice(0, width));
				const top = Math.max(0, rendered.length - height);
				const viewport = rendered.slice(top, top + height);
				while (viewport.length < height) viewport.push("");
				return viewport.map(line => line.trimEnd());
			};

			try {
				tui.start();
				await settle(term);
				expect(visible(term)).toEqual(expectedViewport(80, 18));

				const widths = [72, 64, 56, 68, 52, 80];
				for (const width of widths) {
					term.resize(width, 18);
					await settle(term);
					expect(visible(term)).toEqual(expectedViewport(width, 18));
				}
			} finally {
				tui.stop();
			}
		});
		it("aggressive resize storm does not duplicate viewport content", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines = [
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"Operation aborted",
				"",
				"Operation aborted",
				"",
				"┌──────────────┐",
				"",
				"┌──────────────┐",
				"│              │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"│ coding-agent │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"└───────┬──────┘",
				"        │",
				"        │",
			];
			tui.addChild(new MutableLinesComponent(lines));

			const expectedViewport = (width: number, height: number): string[] => {
				const rendered = lines.map(line => line.slice(0, width));
				const top = Math.max(0, rendered.length - height);
				const viewport = rendered.slice(top, top + height);
				while (viewport.length < height) viewport.push("");
				return viewport.map(line => line.trimEnd());
			};

			try {
				tui.start();
				await settle(term);

				const sizes: Array<[number, number]> = [];
				for (let i = 0; i < 240; i++) {
					sizes.push([i % 2 === 0 ? 79 : 80, i % 3 === 0 ? 17 : 18]);
				}

				for (const [w, h] of sizes) {
					term.resize(w, h);
				}
				await settle(term);

				const [finalWidth, finalHeight] = sizes[sizes.length - 1]!;
				expect(visible(term)).toEqual(expectedViewport(finalWidth, finalHeight));
			} finally {
				tui.stop();
			}
		});
		it("height-only resize recovers from cursor drift without duplicate rows", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines = [
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"Operation aborted",
				"",
				"Operation aborted",
				"",
				"┌──────────────┐",
				"",
				"┌──────────────┐",
				"│              │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"│ coding-agent │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"└───────┬──────┘",
				"        │",
				"        │",
			];
			tui.addChild(new MutableLinesComponent(lines));

			const expectedViewport = (width: number, height: number): string[] => {
				const rendered = lines.map(line => line.slice(0, width));
				const top = Math.max(0, rendered.length - height);
				const viewport = rendered.slice(top, top + height);
				while (viewport.length < height) viewport.push("");
				return viewport.map(line => line.trimEnd());
			};

			try {
				tui.start();
				await settle(term);

				// Simulate terminal-managed cursor relocation during aggressive UI changes/resizes.
				// TUI's internal cursor row bookkeeping does not observe this external movement.
				term.write("\x1b[18;1H");
				await settle(term);

				term.resize(80, 17);
				await settle(term);

				expect(visible(term)).toEqual(expectedViewport(80, 17));
			} finally {
				tui.stop();
			}
		});
		it("streaming content under aggressive resize keeps a single consistent viewport", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const source = [
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"Operation aborted",
				"",
				"Operation aborted",
				"",
				"┌──────────────┐",
				"",
				"┌──────────────┐",
				"│              │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"│ coding-agent │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"└───────┬──────┘",
				"        │",
				"        │",
				"        ├─────────┬─────────┬────────┬──────┬──────────────┬──────────────┐",
				"        │         │         │        │      │              │              │",
				"        ▼         │         ▼        │      ▼              ▼              ▼",
				"┌──────────────┐  │  ┌────────────┐  │  ┌───────┐     ┌─────────┐     ┌───────┐",
				"│    agent     │  │  │    tui     │  │  │ utils │     │ natives │     │ stats │",
				"└───────┬──────┘  │  └──────┬─────┘  │  └───────┘     └────┬────┘     └───────┘",
				"        ├─────────┘         └────────┘                     │",
				"        ▼                                                  │",
				"┌──────────────┐     ┌────────────┐                        │",
				"│      ai      │     │ pi-natives │◄───────────────────────┘",
				"└──────────────┘     └────────────┘",
			];
			const working: string[] = [];
			const component = new MutableLinesComponent(working);
			tui.addChild(component);

			const expectedViewport = (width: number, height: number): string[] => {
				const rendered = working.map(line => line.slice(0, width));
				const top = Math.max(0, rendered.length - height);
				const viewport = rendered.slice(top, top + height);
				while (viewport.length < height) viewport.push("");
				return viewport.map(line => line.trimEnd());
			};

			try {
				tui.start();
				await settle(term);

				let nextLine = 0;
				let finalWidth = term.columns;
				let finalHeight = term.rows;
				for (let i = 0; i < 180; i++) {
					if (i % 3 === 0 && nextLine < source.length) {
						working.push(source[nextLine++]!);
						component.setLines(working);
					}

					finalWidth = i % 2 === 0 ? 79 : 80;
					finalHeight = i % 4 < 2 ? 17 : 18;
					term.resize(finalWidth, finalHeight);
					tui.requestRender();
					await settle(term);
				}

				expect(visible(term)).toEqual(expectedViewport(finalWidth, finalHeight));
			} finally {
				tui.stop();
			}
		});
		it("forced renders during resize storm stay stable under cursor relocation", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines = Array.from({ length: 40 }, (_v, i) => `row-${i}`);
			const component = new MutableLinesComponent(lines);
			tui.addChild(component);

			const expectedViewport = (width: number, height: number): string[] => {
				const rendered = lines.map(line => line.slice(0, width));
				const top = Math.max(0, rendered.length - height);
				const viewport = rendered.slice(top, top + height);
				while (viewport.length < height) viewport.push("");
				return viewport.map(line => line.trimEnd());
			};

			try {
				tui.start();
				await settle(term);

				let finalWidth = term.columns;
				let finalHeight = term.rows;
				for (let i = 0; i < 80; i++) {
					finalWidth = i % 2 === 0 ? 79 : 80;
					finalHeight = i % 3 === 0 ? 17 : 18;
					term.resize(finalWidth, finalHeight);
					term.write("\x1b[18;1H");
					tui.requestRender(true);
					await settle(term);
				}

				expect(visible(term)).toEqual(expectedViewport(finalWidth, finalHeight));
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
		it("mixed width/height resize storm keeps scrollback bounded for static content", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines = [
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"",
				"",
				"doesnt matter",
				"",
				"doesnt matter",
				"",
				"",
				"Operation aborted",
				"",
				"Operation aborted",
				"",
				"┌──────────────┐",
				"",
				"┌──────────────┐",
				"│              │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"│ coding-agent │",
				"┌──────────────┐",
				"│              │",
				"│ coding-agent │",
				"│              │",
				"└───────┬──────┘",
				"        │",
				"        │",
				"        ├─────────┬─────────┬────────┬──────┬──────────────┬──────────────┐",
				"        │         │         │        │      │              │              │",
				"        ▼         │         ▼        │      ▼              ▼              ▼",
				"┌──────────────┐  │  ┌────────────┐  │  ┌───────┐     ┌─────────┐     ┌───────┐",
				"│    agent     │  │  │    tui     │  │  │ utils │     │ natives │     │ stats │",
				"└───────┬──────┘  │  └──────┬─────┘  │  └───────┘     └────┬────┘     └───────┘",
				"        ├─────────┘         └────────┘                     │",
				"        ▼                                                  │",
				"┌──────────────┐     ┌────────────┐                        │",
				"│      ai      │     │ pi-natives │◄───────────────────────┘",
				"└──────────────┘     └────────────┘",
			];
			tui.addChild(new MutableLinesComponent(lines));

			try {
				tui.start();
				await settle(term);
				const before = term.getScrollBuffer().length;

				for (let i = 0; i < 220; i++) {
					term.resize(i % 2 === 0 ? 79 : 80, i % 3 === 0 ? 17 : 18);
					await settle(term);
				}

				const after = term.getScrollBuffer().length;
				expect(after - before).toBeLessThan(120);
			} finally {
				tui.stop();
			}
		});
	});

	describe("scrollback integrity", () => {
		it("overflowing startup preserves shell scrollback while keeping each row unique across the full buffer", async () => {
			const term = new VirtualTerminal(32, 5);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
			await settle(term);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 10));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				const all = term.getScrollBuffer();
				const allText = all.join("\n");
				expect(allText.includes("shell-0")).toBeTruthy();
				expect(allText.includes("shell-4")).toBeTruthy();
				expect(visible(term).join("\n").includes("shell-")).toBeFalsy();
				for (let i = 0; i < 10; i++) {
					const pattern = new RegExp(`\\bline-${i}\\b`);
					expect(countMatches(all, pattern), `line-${i} should appear exactly once`).toBe(1);
				}
			} finally {
				tui.stop();
			}
		});

		it("appending lines during aggressive resize does not duplicate history rows", async () => {
			const term = new VirtualTerminal(80, 18);
			const tui = new TUI(term);
			const lines: string[] = [];
			const component = new MutableLinesComponent(lines);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let i = 0; i < 140; i++) {
					lines.push(`line-${i}`);
					component.setLines(lines);
					term.resize(i % 2 === 0 ? 79 : 80, i % 3 === 0 ? 17 : 18);
					tui.requestRender();
					await settle(term);
				}

				const scrollback = term.getScrollBuffer();
				const duplicated: number[] = [];
				let presentCount = 0;
				for (let i = 0; i < 140; i++) {
					const pattern = new RegExp(`\\bline-${i}\\b`);
					const count = countMatches(scrollback, pattern);
					if (count > 0) presentCount += 1;
					if (count > 1) duplicated.push(i);
				}
				expect(presentCount).toBeGreaterThan(30);
				expect(duplicated).toEqual([]);
			} finally {
				tui.stop();
			}
		});

		it("offscreen header changes preserve shell history during overflow growth", async () => {
			const term = new VirtualTerminal(32, 6);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
			await settle(term);
			const tui = new TUI(term);
			const logLines = rows("line-", 6);
			let tick = 0;
			const component = new MutableLinesComponent([`status-${tick}`, ...logLines]);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let i = 6; i < 70; i++) {
					tick += 1;
					logLines.push(`line-${i}`);
					component.setLines([`status-${tick}`, ...logLines]);
					tui.requestRender();
					await settle(term);
				}

				const scrollback = term.getScrollBuffer();
				const scrollbackText = scrollback.join("\n");
				expect(scrollbackText.includes("shell-0")).toBeTruthy();
				expect(scrollbackText.includes("shell-4")).toBeTruthy();
				for (let i = 0; i < 70; i++) {
					expect(countMatches(scrollback, new RegExp(`\\bline-${i}\\b`))).toBe(1);
				}
				for (let i = 0; i <= tick; i++) {
					expect(countMatches(scrollback, new RegExp(`\\bstatus-${i}\\b`))).toBeLessThanOrEqual(1);
				}

				const viewport = visible(term).map(line => line.trim());
				expect(viewport.join("\n").includes("shell-")).toBeFalsy();
				expect(viewport.at(-1)).toBe("line-69");
				for (let i = 1; i < viewport.length; i++) {
					const prev = Number.parseInt(viewport[i - 1]!.slice(5), 10);
					const next = Number.parseInt(viewport[i]!.slice(5), 10);
					expect(next - prev).toBe(1);
				}
			} finally {
				tui.stop();
			}
		});
		it("large delete fallback preserves shell scrollback without stale rows", async () => {
			const term = new VirtualTerminal(32, 5);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
			await settle(term);
			const tui = new TUI(term);
			tui.setClearOnShrink(false);
			const component = new MutableLinesComponent(rows("row-", 18));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				component.setLines(rows("row-", 4));
				tui.requestRender();
				await settle(term);

				const buffer = term.getScrollBuffer();
				const bufferText = buffer.join("\n");
				expect(bufferText.includes("shell-0")).toBeTruthy();
				expect(bufferText.includes("shell-4")).toBeTruthy();
				expect(visible(term).join("\n").includes("shell-")).toBeFalsy();
				expect(visible(term).filter(line => line.trim().length > 0)).toEqual(["row-0", "row-1", "row-2", "row-3"]);
				const viewportRows = visible(term).filter(line => line.trim().length > 0);
				for (let i = 0; i < 4; i++) {
					expect(
						viewportRows.filter(r => r === `row-${i}`).length,
						`viewport row-${i} should appear exactly once`,
					).toBe(1);
				}
			} finally {
				tui.stop();
			}
		});

		it("updates visible tail line when appending during overflow", async () => {
			const term = new VirtualTerminal(32, 5);
			const tui = new TUI(term);
			const lines = [...rows("line-", 7), "tail-0"];
			const component = new MutableLinesComponent(lines);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let tick = 1; tick <= 30; tick++) {
					lines[lines.length - 1] = `tail-${tick}`;
					lines.push(`new-${tick}`);
					component.setLines(lines);
					tui.requestRender();
					await settle(term);

					const viewport = visible(term).map(line => line.trim());
					const expectedViewport = lines.slice(Math.max(0, lines.length - term.rows)).map(line => line.trim());
					expect(viewport).toEqual(expectedViewport);
				}
			} finally {
				tui.stop();
			}
		});
		it("forced full redraws preserve shell history without duplicating overflowing content", async () => {
			const term = new VirtualTerminal(40, 5);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\nshell-4\r\n");
			await settle(term);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 14));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let i = 0; i < 5; i++) {
					tui.requestRender(true);
					await settle(term);
				}

				const all = term.getScrollBuffer();
				const allText = all.join("\n");
				expect(allText.includes("shell-0")).toBeTruthy();
				expect(allText.includes("shell-4")).toBeTruthy();
				expect(visible(term).join("\n").includes("shell-")).toBeFalsy();
				for (let i = 0; i < 14; i++) {
					expect(countMatches(all, new RegExp(`\\bline-${i}\\b`)), `line-${i} should appear exactly once`).toBe(1);
				}
				expect(visible(term).at(-1)?.trim()).toBe("line-13");
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

	describe("exit gap regression", () => {
		it("stop after tall content does not leave a large blank gap below content", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 60));
			tui.addChild(component);

			tui.start();
			await settle(term);
			expect(visible(term).at(-1)?.trim()).toBe("line-59");

			tui.stop();
			await settle(term);

			// After exit, the viewport should still show content with at most
			// 1-2 trailing blank rows (for the shell prompt boundary).
			const viewport = visible(term);
			const contentLines = viewport.filter(l => l.trim().length > 0);
			expect(contentLines.length).toBeGreaterThanOrEqual(8);
			expect(trailingBlanks(viewport)).toBeLessThanOrEqual(2);
		});

		it("stop after overflowing content with shell history does not add blank rows", async () => {
			const term = new VirtualTerminal(40, 8);
			term.write("shell-0\r\nshell-1\r\nshell-2\r\nshell-3\r\n");
			await settle(term);

			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 30));
			tui.addChild(component);

			tui.start();
			await settle(term);

			tui.stop();
			await settle(term);

			const scrollback = term.getScrollBuffer();
			// Shell history should survive
			expect(scrollback.join("\n").includes("shell-0")).toBeTruthy();
			// After stop, the viewport should have content, not a big blank gap
			const viewport = visible(term);
			expect(trailingBlanks(viewport)).toBeLessThanOrEqual(2);
		});

		it("stop after shrink does not push content off screen", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 40));
			tui.addChild(component);

			tui.start();
			await settle(term);

			// Shrink content dramatically
			component.setLines(["New session started"]);
			tui.requestRender(true);
			await settle(term);

			tui.stop();
			await settle(term);

			// After exit, the viewport should still show the shrunken content
			const viewport = visible(term);
			expect(viewport[0]?.trim()).toBe("New session started");
			// Content should not be scrolled off by exit
			expect(viewport.filter(l => l.trim().length > 0).length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("content shrink regression", () => {
		it("shrink from tall to tiny anchors prompt near content, not at terminal bottom", async () => {
			const term = new VirtualTerminal(40, 20);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 80));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				// Simulate /new: content collapses to just a few lines
				component.setLines(["New session started", "prompt>"]);
				tui.requestRender(true);
				await settle(term);

				const viewport = visible(term);
				// Content should be at the top of the viewport, not at the bottom
				expect(viewport[0]?.trim()).toBe("New session started");
				expect(viewport[1]?.trim()).toBe("prompt>");
				// The rest should be blank - no long blank run ABOVE the content
				for (let i = 2; i < 20; i++) {
					expect(viewport[i]?.trim()).toBe("");
				}
			} finally {
				tui.stop();
			}
		});

		it("repeated shrink cycles do not accumulate blank lines", async () => {
			const term = new VirtualTerminal(40, 12);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("line-", 50));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				for (let cycle = 0; cycle < 5; cycle++) {
					// Shrink to tiny
					component.setLines([`session-${cycle}`]);
					tui.requestRender(true);
					await settle(term);

					// Grow back to overflowing
					component.setLines(rows("line-", 50));
					tui.requestRender();
					await settle(term);
				}

				// After cycles, viewport should show the tail of content
				const viewport = visible(term);
				expect(viewport.at(-1)?.trim()).toBe("line-49");

				const scrollback = term.getScrollBuffer();
				// No giant blank run from accumulated drift
				expect(longestBlankRun(scrollback)).toBeLessThan(15);
			} finally {
				tui.stop();
			}
		});
	});

	describe("overlay dismiss cursor recovery", () => {
		it("overlay dismiss restores viewport without gap below content", async () => {
			const term = new VirtualTerminal(40, 12);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("base-", 8));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				// Show overlay taller than remaining viewport space
				const overlay = new MutableLinesComponent(rows("over-", 6));
				const handle = tui.showOverlay(overlay, { anchor: "center" });
				await settle(term);

				// Dismiss overlay
				handle.hide();
				await settle(term);

				// After dismiss, viewport should show base content without gaps
				const viewport = visible(term);
				expect(viewport[0]?.trim()).toBe("base-0");
				expect(viewport[7]?.trim()).toBe("base-7");
				// No content rows should be pushed below the viewport
				for (let i = 8; i < 12; i++) {
					expect(viewport[i]?.trim()).toBe("");
				}
			} finally {
				tui.stop();
			}
		});

		it("repeated overlay show/hide does not drift the cursor", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("base-", 10));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				const baseViewport = visible(term);

				for (let i = 0; i < 10; i++) {
					const handle = tui.showOverlay(new MutableLinesComponent([`overlay-${i}`]), {
						anchor: "center",
					});
					await settle(term);
					handle.hide();
					await settle(term);
				}

				// After 10 show/hide cycles, viewport must match the original base
				expect(visible(term)).toEqual(baseViewport);
			} finally {
				tui.stop();
			}
		});

		it("stop after content shrink moves the prompt to the visible content boundary", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("base-", 30));
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);

				component.setLines(rows("base-", 4));
				tui.requestRender();
				await settle(term);

				tui.stop();
				await settle(term);

				const viewport = visible(term);
				expect(viewport[0]?.trim()).toBe("base-0");
				expect(viewport[3]?.trim()).toBe("base-3");
				const active = (term as unknown as { xterm: { buffer: { active: { cursorY: number; baseY: number } } } })
					.xterm.buffer.active;
				expect(active.baseY).toBe(30);
				expect(active.cursorY).toBe(4);
			} finally {
				// stop() already ran in the main flow; keep finally for symmetry if the test fails early
			}
		});

		it("stop after overlay dismissal does not create scrollback gap", async () => {
			const term = new VirtualTerminal(40, 10);
			const tui = new TUI(term);
			const component = new MutableLinesComponent(rows("base-", 30));
			tui.addChild(component);

			tui.start();
			await settle(term);

			const handle = tui.showOverlay(new MutableLinesComponent(rows("over-", 5)), {
				anchor: "center",
			});
			await settle(term);

			handle.hide();
			await settle(term);

			tui.stop();
			await settle(term);

			// After stop, viewport should still have content
			const viewport = visible(term);
			expect(trailingBlanks(viewport)).toBeLessThanOrEqual(2);
			expect(viewport.filter(l => l.trim().length > 0).length).toBeGreaterThanOrEqual(8);
		});
	});
});
