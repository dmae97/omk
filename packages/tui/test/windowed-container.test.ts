import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Spacer } from "../src/components/spacer.ts";
import { Text } from "../src/components/text.ts";
import { type Component, Container } from "../src/tui.ts";
import { isRenderSettled, releaseRenderCache, WindowedContainer } from "../src/windowed-container.ts";

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

/**
 * Stand-in for a tool/assistant card that exposes the duck-typed settle +
 * generation hooks. Message-object replacement bumps generation the same way
 * updateContent/setMessage will once coding-agent wires the hooks.
 */
class SettlingMessage implements Component {
	private body: string;
	private settled: boolean;
	private generation = 0;
	private messageRef: object;

	constructor(body: string, settled = true, messageRef: object = { body }) {
		this.body = body;
		this.settled = settled;
		this.messageRef = messageRef;
	}

	isRenderSettled(): boolean {
		return this.settled;
	}

	getRenderGeneration(): number {
		return this.generation;
	}

	/** Simulate a late tool result while still the same component instance. */
	complete(body: string): void {
		this.body = body;
		this.settled = true;
		this.generation += 1;
	}

	/** Simulate agent-loop replacing the underlying message object. */
	setMessage(message: { text: string }, settled = true): void {
		this.messageRef = message;
		this.body = message.text;
		this.settled = settled;
		this.generation += 1;
	}

	/** Content mutate without settle flip (expand/collapse style). */
	setText(body: string): void {
		this.body = body;
		this.generation += 1;
	}

	getMessageRef(): object {
		return this.messageRef;
	}

	invalidate(): void {
		this.generation += 1;
	}

	render(width: number): string[] {
		const line =
			this.body.length > width ? this.body.slice(0, width) : this.body + " ".repeat(width - this.body.length);
		return [line];
	}
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
		assert.deepEqual(windowed.render(width), full.render(width));
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

	it("releaseRenderCache clears duck-typed streamCache without a hook", () => {
		const fake = {
			streamCache: { tokens: [1, 2, 3] },
			invalidate() {},
			render() {
				return [""];
			},
		};
		releaseRenderCache(fake as Component);
		assert.equal(fake.streamCache, undefined);
	});

	it("isRenderSettled defaults true when the hook is absent", () => {
		assert.equal(isRenderSettled(new Text("x", 0, 0)), true);
	});

	it("does not freeze past an unsettled child; late complete shows new content", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(8);
		const filler = "pad-".repeat(30);
		for (let i = 0; i < 12; i++) {
			full.addChild(new Text(`${i}:${filler}`, 0, 0));
			windowed.addChild(new Text(`${i}:${filler}`, 0, 0));
		}
		const pendingFull = new SettlingMessage("tool:pending", false);
		const pendingWin = new SettlingMessage("tool:pending", false);
		full.addChild(pendingFull);
		windowed.addChild(pendingWin);
		for (let i = 0; i < 12; i++) {
			full.addChild(new Text(`tail-${i}:${filler}`, 0, 0));
			windowed.addChild(new Text(`tail-${i}:${filler}`, 0, 0));
		}

		const before = windowed.render(60);
		assert.deepEqual(before, full.render(60));
		// Unsettled card must remain live (not in the frozen prefix).
		assert.ok(windowed.getFrozenChildCount() <= 12);
		assert.ok(
			windowed.children[windowed.getFrozenChildCount()] === pendingWin || windowed.getFrozenChildCount() < 12,
		);

		pendingFull.complete("tool:RESULT-OK");
		pendingWin.complete("tool:RESULT-OK");
		const after = windowed.render(60);
		assert.deepEqual(after, full.render(60));
		assert.ok(after.some((line) => line.includes("RESULT-OK")));
	});

	it("thaws when a frozen child's generation bumps (setText / expand)", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(6);
		const cards: SettlingMessage[] = [];
		for (let i = 0; i < 20; i++) {
			const body = `msg-${i}-`.repeat(8);
			const f = new SettlingMessage(body, true);
			const w = new SettlingMessage(body, true);
			full.addChild(f);
			windowed.addChild(w);
			cards.push(w);
		}
		assert.deepEqual(windowed.render(50), full.render(50));
		assert.ok(windowed.getFrozenChildCount() > 0);

		const frozenIndex = 0;
		assert.ok(frozenIndex < windowed.getFrozenChildCount());
		(full.children[frozenIndex] as SettlingMessage).setText("MUTATED-AFTER-FREEZE");
		cards[frozenIndex].setText("MUTATED-AFTER-FREEZE");
		const out = windowed.render(50);
		assert.deepEqual(out, full.render(50));
		assert.ok(out.some((line) => line.includes("MUTATED-AFTER-FREEZE")));
	});

	it("thaws when a frozen child's message object is replaced", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(6);
		for (let i = 0; i < 20; i++) {
			const body = `obj-${i}-`.repeat(8);
			full.addChild(new SettlingMessage(body, true, { id: i, text: body }));
			windowed.addChild(new SettlingMessage(body, true, { id: i, text: body }));
		}
		assert.deepEqual(windowed.render(50), full.render(50));
		assert.ok(windowed.getFrozenChildCount() > 0);

		const idx = 1;
		assert.ok(idx < windowed.getFrozenChildCount());
		const replacement = { id: 99, text: "REPLACED-MESSAGE-OBJECT" };
		(full.children[idx] as SettlingMessage).setMessage(replacement);
		(windowed.children[idx] as SettlingMessage).setMessage(replacement);
		const out = windowed.render(50);
		assert.deepEqual(out, full.render(50));
		assert.ok(out.some((line) => line.includes("REPLACED-MESSAGE-OBJECT")));
		assert.notEqual((windowed.children[idx] as SettlingMessage).getMessageRef(), { id: idx });
	});

	it("randomized equivalence vs full Container including late old-child mutation", () => {
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

			const settlingFull: SettlingMessage[] = [];
			const settlingWin: SettlingMessage[] = [];
			for (let i = 0; i < messages; i++) {
				const f = new SettlingMessage(`${i}:${body}`, true);
				const w = new SettlingMessage(`${i}:${body}`, true);
				full.addChild(f);
				windowed.addChild(w);
				settlingFull.push(f);
				settlingWin.push(w);
				full.addChild(new Spacer(1));
				windowed.addChild(new Spacer(1));
			}
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// append
			full.addChild(new Text(`extra-${seed}`, 1, 0));
			windowed.addChild(new Text(`extra-${seed}`, 1, 0));
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// late mutation of an early (likely frozen) child
			const early = seed % settlingWin.length;
			settlingFull[early].setText(`late-${seed}-${body}`);
			settlingWin[early].setText(`late-${seed}-${body}`);
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;

			// message object swap on another early child
			const swapAt = (early + 1) % settlingWin.length;
			const msg = { text: `swap-${seed}` };
			settlingFull[swapAt].setMessage(msg);
			settlingWin[swapAt].setMessage(msg);
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
		assert.ok(trials >= 144);
	});
});
