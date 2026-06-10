import type { Component } from "@earendil-works/omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	buildTranscriptViewportLines,
	type CockpitLayout,
	consumeCockpitScrollInput,
	parseSgrWheelEvent,
	sliceFromBottom,
} from "../src/modes/interactive/cockpit-scroll.ts";
import { OmkControlLayout } from "../src/modes/interactive/components/omk-control-layout.ts";
import { ScrollableTranscriptComponent } from "../src/modes/interactive/components/scrollable-transcript.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

class StaticComponent implements Component {
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class MutableComponent implements Component {
	lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

beforeAll(() => {
	initTheme("omk-control", false);
});

describe("cockpit scroll helpers", () => {
	it("parseSgrWheelEvent parses wheel up and down", () => {
		expect(parseSgrWheelEvent("\x1b[<64;10;20M")).toMatchObject({ direction: "up", x: 10, y: 20 });
		expect(parseSgrWheelEvent("\x1b[<65;10;20M")).toMatchObject({ direction: "down", x: 10, y: 20 });
	});

	it("PageUp and PageDown are consumed before composer", () => {
		const layout: CockpitLayout = {
			width: 120,
			height: 30,
			mainWidth: 90,
			transcript: { x: 1, y: 1, w: 90, h: 20 },
			composer: { x: 1, y: 21, w: 90, h: 4 },
			working: { x: 1, y: 25, w: 90, h: 2 },
			footer: { x: 1, y: 27, w: 90, h: 3 },
			rightRail: { x: 93, y: 1, w: 28, h: 30 },
		};
		const pageUp = consumeCockpitScrollInput("\x1b[5~", {
			leftScrollFromBottom: 0,
			leftTranscriptLineCount: 200,
			leftTranscriptHeight: 20,
			followTail: true,
			currentLayout: layout,
		});
		const pageDown = consumeCockpitScrollInput("\x1b[6~", {
			leftScrollFromBottom: 40,
			leftTranscriptLineCount: 200,
			leftTranscriptHeight: 20,
			followTail: false,
			currentLayout: layout,
		});
		expect(pageUp).toMatchObject({ consumed: true, kind: "paging", pagingKey: "pageUp", target: "leftTranscript" });
		expect(pageUp?.nextScrollFromBottom).toBeGreaterThan(0);
		expect(pageDown).toMatchObject({
			consumed: true,
			kind: "paging",
			pagingKey: "pageDown",
			target: "leftTranscript",
		});
		expect(pageDown?.nextScrollFromBottom).toBeLessThan(40);
	});

	it("wheel over composer routes to left transcript before composer", () => {
		const result = consumeCockpitScrollInput("\x1b[<64;10;22M", {
			leftScrollFromBottom: 0,
			leftTranscriptLineCount: 100,
			leftTranscriptHeight: 20,
			followTail: true,
			currentLayout: {
				width: 120,
				height: 30,
				mainWidth: 90,
				transcript: { x: 1, y: 1, w: 90, h: 20 },
				composer: { x: 1, y: 21, w: 90, h: 4 },
				working: { x: 1, y: 25, w: 90, h: 2 },
				footer: { x: 1, y: 27, w: 90, h: 3 },
				rightRail: { x: 93, y: 1, w: 28, h: 30 },
			},
		});
		expect(result).toMatchObject({ consumed: true, kind: "wheel", target: "leftTranscript" });
		expect(result?.nextScrollFromBottom).toBeGreaterThan(0);
	});

	it("sliceFromBottom returns older transcript lines when scroll increases", () => {
		const lines = Array.from({ length: 8 }, (_, index) => `line-${index}`);
		expect(sliceFromBottom(lines, 3, 0)).toEqual(["line-5", "line-6", "line-7"]);
		expect(sliceFromBottom(lines, 3, 2)).toEqual(["line-3", "line-4", "line-5"]);
		expect(buildTranscriptViewportLines(["one"], 3, 0)).toEqual(["", "", "one"]);
	});
});

describe("ScrollableTranscriptComponent", () => {
	it("keeps composer sticky while transcript scroll changes and right rail pinned", () => {
		const source = new MutableComponent(Array.from({ length: 10 }, (_, index) => `msg-${index}`));
		let scrollFromBottom = 0;
		const transcript = new ScrollableTranscriptComponent(source, {
			getScrollFromBottom: () => scrollFromBottom,
			getViewportHeight: (_width, totalHeight) => Math.max(1, (totalHeight ?? 6) - 3),
		});
		const container = new OmkControlLayout(new StaticComponent(["RAIL-0", "RAIL-1", "RAIL-2"]), {
			dashboardWidth: 20,
			minWidth: 80,
		});
		container.addChild(transcript);
		container.addChild(new StaticComponent(["COMPOSER"]));
		container.addChild(new StaticComponent(["WORKING"]));
		container.addChild(new StaticComponent(["FOOTER"]));

		const initial = container.render(100, 6).map(stripAnsi);
		scrollFromBottom = 2;
		const scrolled = container.render(100, 6).map(stripAnsi);

		expect(initial.slice(3, 6)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("COMPOSER"),
				expect.stringContaining("WORKING"),
				expect.stringContaining("FOOTER"),
			]),
		);
		expect(scrolled.slice(3, 6)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("COMPOSER"),
				expect.stringContaining("WORKING"),
				expect.stringContaining("FOOTER"),
			]),
		);
		expect(initial.slice(0, 3).join("\n")).not.toContain("COMPOSER");
		expect(scrolled.slice(0, 3).join("\n")).not.toContain("COMPOSER");
		expect(initial.join("\n")).toContain("RAIL-0");
		expect(scrolled.join("\n")).toContain("RAIL-0");
		expect(initial.slice(0, 3)).not.toEqual(scrolled.slice(0, 3));
	});

	it("followTail false keeps transcript position when new output arrives", () => {
		const source = new MutableComponent(Array.from({ length: 10 }, (_, index) => `msg-${index}`));
		const state = { scroll: 2, previousLineCount: 10, followTail: false };
		const transcript = new ScrollableTranscriptComponent(source, {
			getScrollFromBottom: (lineCount) =>
				!state.followTail && lineCount > state.previousLineCount
					? state.scroll + (lineCount - state.previousLineCount)
					: state.scroll,
			getViewportHeight: () => 3,
			onMetrics: (metrics) => {
				state.scroll = metrics.clampedScrollFromBottom;
				state.previousLineCount = metrics.lineCount;
				state.followTail = metrics.clampedScrollFromBottom === 0;
			},
		});

		const before = transcript.render(80, 3);
		source.lines = [...source.lines, "msg-10", "msg-11"];
		const after = transcript.render(80, 3);

		expect(before.filter(Boolean)).toEqual(["msg-5", "msg-6", "msg-7"]);
		expect(after.filter(Boolean)).toEqual(["msg-5", "msg-6", "msg-7"]);
	});

	it("followTail true snaps to the latest output", () => {
		const source = new MutableComponent(Array.from({ length: 10 }, (_, index) => `msg-${index}`));
		const transcript = new ScrollableTranscriptComponent(source, {
			getScrollFromBottom: () => 0,
			getViewportHeight: () => 3,
		});

		const before = transcript.render(80, 3);
		source.lines = [...source.lines, "msg-10", "msg-11"];
		const after = transcript.render(80, 3);

		expect(before.filter(Boolean)).toEqual(["msg-7", "msg-8", "msg-9"]);
		expect(after.filter(Boolean)).toEqual(["msg-9", "msg-10", "msg-11"]);
	});
});
