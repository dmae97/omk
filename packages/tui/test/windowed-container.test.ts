import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Spacer } from "../src/components/spacer.ts";
import { Text } from "../src/components/text.ts";
import { Container } from "../src/tui.ts";
import { releaseRenderCache, WindowedContainer } from "../src/windowed-container.ts";

function fillChat(target: Container, messages: number, body: string): void {
	for (let i = 0; i < messages; i++) {
		if (i % 2 === 0) {
			const box = new Box(1, 1, (s) => s);
			box.addChild(new Text(`${i}:${body}`, 0, 0));
			target.addChild(box);
		} else {
			target.addChild(new Text(`${i}:${body}`, 1, 0));
		}
		target.addChild(new Spacer(1));
	}
}

function cacheChars(component: unknown): number {
	let total = 0;
	const walk = (c: unknown) => {
		if (!c || typeof c !== "object") return;
		const o = c as Record<string, unknown>;
		if (Array.isArray(o.cachedLines)) {
			for (const line of o.cachedLines as string[]) total += line.length;
		}
		if (o.cache && typeof o.cache === "object") {
			const lines = (o.cache as { lines?: string[] }).lines;
			if (Array.isArray(lines)) {
				for (const line of lines) total += line.length;
			}
		}
		if (Array.isArray(o.children)) {
			for (const child of o.children) walk(child);
		}
	};
	walk(component);
	return total;
}

describe("WindowedContainer", () => {
	it("matches a full Container render after freeze", () => {
		const body = "The quick brown fox jumps over the lazy dog. ".repeat(4);
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(40);
		fillChat(full, 30, body);
		fillChat(windowed, 30, body);
		const width = 80;
		const a = full.render(width);
		const b = windowed.render(width);
		assert.deepEqual(b, a);
		assert.ok(windowed.getFrozenChildCount() > 0);
		assert.ok(windowed.getFrozenLineCount() > 0);
	});

	it("matches after width resize (thaw + re-layout)", () => {
		const body = "resize-body-".repeat(20);
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(30);
		fillChat(full, 25, body);
		fillChat(windowed, 25, body);
		assert.deepEqual(windowed.render(100), full.render(100));
		assert.ok(windowed.getFrozenChildCount() > 0);
		assert.deepEqual(windowed.render(60), full.render(60));
	});

	it("matches after invalidate (theme path)", () => {
		const body = "theme-".repeat(30);
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(30);
		fillChat(full, 20, body);
		fillChat(windowed, 20, body);
		windowed.render(80);
		full.invalidate();
		windowed.invalidate();
		assert.equal(windowed.getFrozenChildCount(), 0);
		assert.deepEqual(windowed.render(80), full.render(80));
	});

	it("matches after live-tail streaming append / expand-like setText", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(40);
		const body = "stream-".repeat(25);
		fillChat(full, 20, body);
		fillChat(windowed, 20, body);
		assert.deepEqual(windowed.render(80), full.render(80));

		const liveFull = full.children[full.children.length - 2] as Text;
		const liveWin = windowed.children[windowed.children.length - 2] as Text;
		liveFull.setText(`${body}\nexpanded-tool-output\nline2`);
		liveWin.setText(`${body}\nexpanded-tool-output\nline2`);
		assert.deepEqual(windowed.render(80), full.render(80));

		liveFull.setText(`${body}\nexpanded-tool-output\nline2\nappended`);
		liveWin.setText(`${body}\nexpanded-tool-output\nline2\nappended`);
		assert.deepEqual(windowed.render(80), full.render(80));
	});

	it("releases render caches on frozen children", () => {
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(20);
		fillChat(windowed, 40, "cache-".repeat(40));
		windowed.render(80);
		assert.ok(windowed.getFrozenChildCount() > 0);
		let frozenCache = 0;
		for (let i = 0; i < windowed.getFrozenChildCount(); i++) {
			frozenCache += cacheChars(windowed.children[i]);
		}
		assert.equal(frozenCache, 0);
	});

	it("releaseRenderCache clears Text cachedLines", () => {
		const text = new Text("hello world ".repeat(20), 1, 0);
		text.render(40);
		assert.ok(cacheChars(text) > 0);
		releaseRenderCache(text);
		assert.equal(cacheChars(text), 0);
	});

	it("randomized equivalence vs full Container", () => {
		const widths = [40, 80, 120] as const;
		const budgets = [20, 48, 96] as const;
		let trials = 0;
		for (let seed = 0; seed < 24; seed++) {
			const messages = 8 + (seed % 17);
			const body = `r${seed}-`.repeat(3 + (seed % 9));
			const width = widths[seed % widths.length];
			const budget = budgets[seed % budgets.length];
			const full = new Container();
			const windowed = new WindowedContainer();
			windowed.setLiveLineBudget(budget);
			fillChat(full, messages, body);
			fillChat(windowed, messages, body);
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// append
			const tFull = new Text(`extra-${seed}`, 1, 0);
			const tWin = new Text(`extra-${seed}`, 1, 0);
			full.addChild(tFull);
			windowed.addChild(tWin);
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// invalidate
			full.invalidate();
			windowed.invalidate();
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// resize
			const other = widths[(seed + 1) % widths.length];
			assert.deepEqual(windowed.render(other), full.render(other));
			trials++;
		}
		assert.ok(trials >= 96);
	});
});
