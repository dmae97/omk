import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Markdown, type MarkdownTheme } from "../src/components/markdown.ts";
import { Spacer } from "../src/components/spacer.ts";
import { Text } from "../src/components/text.ts";
import { isRenderSettled, releaseRenderCache } from "../src/render-generation.ts";
import { type Component, Container } from "../src/tui.ts";
import { WindowedContainer } from "../src/windowed-container.ts";

const identity = (text: string) => text;
const markdownTheme: MarkdownTheme = {
	heading: identity,
	link: identity,
	linkUrl: identity,
	code: identity,
	codeBlock: identity,
	codeBlockBorder: identity,
	quote: identity,
	quoteBorder: identity,
	hr: identity,
	listBullet: identity,
	bold: identity,
	italic: identity,
	strikethrough: identity,
	underline: identity,
};

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

class SettlingMessage implements Component {
	private body: string;
	private settled: boolean;
	private generation = 0;
	private messageRef: object;
	renderCount = 0;

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

	complete(body: string): void {
		this.body = body;
		this.settled = true;
		this.generation += 1;
	}

	setMessage(message: { text: string }, settled = true): void {
		this.messageRef = message;
		this.body = message.text;
		this.settled = settled;
		this.generation += 1;
	}

	setText(body: string): void {
		this.body = body;
		this.generation += 1;
	}

	markUnsettled(): void {
		this.settled = false;
		this.generation += 1;
	}

	getMessageRef(): object {
		return this.messageRef;
	}

	invalidate(): void {
		this.generation += 1;
	}

	render(width: number): string[] {
		this.renderCount += 1;
		const line =
			this.body.length > width
				? this.body.slice(0, width)
				: this.body + " ".repeat(Math.max(0, width - this.body.length));
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
		assert.deepEqual(windowed.render(80), full.render(80));
		assert.ok(windowed.getFrozenChildCount() > 0);
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
	});

	it("releases render caches on frozen children", () => {
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(20);
		fillChat(windowed, 40, "cache-".repeat(40));
		windowed.render(80);
		assert.ok(windowed.getFrozenChildCount() > 0);
		let frozenCache = 0;
		const frozen = new Set<number>();
		for (const range of windowed.getFrozenRanges()) {
			for (let i = range.from; i < range.to; i++) frozen.add(i);
		}
		assert.ok(frozen.size > 0);
		for (const i of frozen) {
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

	it("releaseRenderCache on Markdown keeps it renderable and does not count as a change", () => {
		const md = new Markdown("# Title\n\nSome **bold** text and a list:\n\n- a\n- b\n", 1, 0, markdownTheme);
		const before = md.render(60);
		const generation = md.getRenderGeneration();
		releaseRenderCache(md);
		assert.equal(cacheChars(md), 0);
		assert.equal(md.getRenderGeneration(), generation);
		assert.deepEqual(md.render(60), before);
	});

	it("isRenderSettled defaults true when the hook is absent", () => {
		assert.equal(isRenderSettled(new Text("x", 0, 0)), true);
	});

	it("does not freeze an unsettled child; late complete shows new content", () => {
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
		assert.deepEqual(windowed.render(60), full.render(60));
		pendingFull.complete("tool:RESULT-OK");
		pendingWin.complete("tool:RESULT-OK");
		const after = windowed.render(60);
		assert.deepEqual(after, full.render(60));
		assert.ok(after.some((line) => line.includes("RESULT-OK")));
	});

	it("freezes settled children AFTER an early unsettled tool (segment freeze)", () => {
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(6);
		const cards: SettlingMessage[] = [];
		for (let i = 0; i < 30; i++) {
			const settled = i !== 5;
			const m = new SettlingMessage(`card-${i}-`.repeat(6), settled);
			windowed.addChild(m);
			cards.push(m);
		}
		windowed.render(40);
		assert.ok(windowed.getFrozenSegmentCount() >= 2, "expect settled runs on both sides of gap");
		assert.ok(windowed.getFrozenChildCount() >= 20, `frozen=${windowed.getFrozenChildCount()}`);
		const earlyRenders = cards.slice(10, 20).map((c) => c.renderCount);
		windowed.render(40);
		windowed.render(40);
		for (let i = 10; i < 20; i++) {
			assert.equal(cards[i].renderCount, earlyRenders[i - 10], `child ${i} should not re-render while frozen`);
		}
		// Unsettled at 5 must keep re-rendering
		const unsettledBefore = cards[5].renderCount;
		windowed.render(40);
		assert.ok(cards[5].renderCount > unsettledBefore);
	});

	it("thaws only the changed child in a segment (setText / expand)", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(6);
		const cards: SettlingMessage[] = [];
		for (let i = 0; i < 20; i++) {
			const body = `msg-${i}-`.repeat(8);
			full.addChild(new SettlingMessage(body, true));
			const w = new SettlingMessage(body, true);
			windowed.addChild(w);
			cards.push(w);
		}
		assert.deepEqual(windowed.render(50), full.render(50));
		assert.ok(windowed.getFrozenChildCount() > 0);
		const countsBefore = cards.map((c) => c.renderCount);
		(full.children[0] as SettlingMessage).setText("MUTATED-AFTER-FREEZE");
		cards[0].setText("MUTATED-AFTER-FREEZE");
		const out = windowed.render(50);
		assert.deepEqual(out, full.render(50));
		assert.ok(out.some((line) => line.includes("MUTATED-AFTER-FREEZE")));
		// Only child 0 among frozen peers should have gained a render (plus maybe live tail)
		assert.equal(cards[0].renderCount, countsBefore[0] + 1);
		for (let i = 1; i < Math.min(10, cards.length); i++) {
			assert.equal(cards[i].renderCount, countsBefore[i], `sibling ${i} must not full-thaw`);
		}
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
		const replacement = { id: 99, text: "REPLACED-MESSAGE-OBJECT" };
		(full.children[1] as SettlingMessage).setMessage(replacement);
		(windowed.children[1] as SettlingMessage).setMessage(replacement);
		const out = windowed.render(50);
		assert.deepEqual(out, full.render(50));
		assert.ok(out.some((line) => line.includes("REPLACED-MESSAGE-OBJECT")));
	});

	it("segment freezing equivalence with unsettled at random positions then settle", () => {
		for (let seed = 0; seed < 16; seed++) {
			const full = new Container();
			const windowed = new WindowedContainer();
			// Small budget + multi-line bodies so settled runs above the tail freeze.
			windowed.setLiveLineBudget(6);
			const n = 28 + (seed % 10);
			const unsettledAt = new Set<number>();
			unsettledAt.add(2 + (seed % 5));
			unsettledAt.add(10 + (seed % 7));
			unsettledAt.add(18 + (seed % 5));
			const cardsF: SettlingMessage[] = [];
			const cardsW: SettlingMessage[] = [];
			for (let i = 0; i < n; i++) {
				const settled = !unsettledAt.has(i);
				const body = `s${seed}-c${i}-`.repeat(8);
				const f = new SettlingMessage(body, settled);
				const w = new SettlingMessage(body, settled);
				full.addChild(f);
				windowed.addChild(w);
				cardsF.push(f);
				cardsW.push(w);
			}
			assert.deepEqual(windowed.render(40), full.render(40));
			assert.ok(windowed.getFrozenSegmentCount() >= 2, `seed=${seed} segments=${windowed.getFrozenSegmentCount()}`);
			assert.ok(windowed.getFrozenChildCount() > n / 2);
			for (const idx of unsettledAt) {
				if (idx >= n) continue;
				cardsF[idx].complete(`done-${seed}-${idx}`);
				cardsW[idx].complete(`done-${seed}-${idx}`);
			}
			assert.deepEqual(windowed.render(40), full.render(40));
		}
	});

	it("randomized equivalence including late old-child mutation and swaps", () => {
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
			full.addChild(new Text(`extra-${seed}`, 1, 0));
			windowed.addChild(new Text(`extra-${seed}`, 1, 0));
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;
			const early = seed % settlingWin.length;
			settlingFull[early].setText(`late-${seed}-${body}`);
			settlingWin[early].setText(`late-${seed}-${body}`);
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;
			const swapAt = (early + 1) % settlingWin.length;
			const msg = { text: `swap-${seed}` };
			settlingFull[swapAt].setMessage(msg);
			settlingWin[swapAt].setMessage(msg);
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;
			full.invalidate();
			windowed.invalidate();
			assert.deepEqual(windowed.render(width), full.render(width));
			trials++;
			const other = widths[(seed + 1) % widths.length];
			assert.deepEqual(windowed.render(other), full.render(other));
			trials++;
		}
		assert.ok(trials >= 144);
	});
	it("refreshes only the changed segment, reporting it in render stats", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(20);
		const body = "segment-body-".repeat(12);
		fillChat(full, 400, body);
		fillChat(windowed, 400, body);
		assert.deepEqual(windowed.render(80), full.render(80));
		assert.ok(windowed.getFrozenSegmentCount() > 3, `segments=${windowed.getFrozenSegmentCount()}`);
		windowed.render(80);
		assert.equal(windowed.getLastRenderStats().refreshedSegments, 0);
		// Mutate a Text nested inside an early, frozen Box via the primitive API only.
		const boxF = full.children[4] as Box;
		const boxW = windowed.children[4] as Box;
		(boxF.children[0] as Text).setText("EARLY-NESTED-EDIT\nwith a second line");
		(boxW.children[0] as Text).setText("EARLY-NESTED-EDIT\nwith a second line");
		const out = windowed.render(80);
		assert.deepEqual(out, full.render(80));
		assert.ok(out.some((line) => line.includes("EARLY-NESTED-EDIT")));
		const stats = windowed.getLastRenderStats();
		assert.equal(stats.refreshedSegments, 1);
		assert.equal(stats.refreshedChildren, 1);
	});

	it("tracks structural edits inside frozen containers (addChild / removeChild / clear)", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(10);
		const make = (target: Container) => {
			const cards: Container[] = [];
			for (let i = 0; i < 30; i++) {
				const card = new Container();
				card.addChild(new Text(`card-${i}`, 0, 0));
				target.addChild(card);
				cards.push(card);
			}
			return cards;
		};
		const cardsF = make(full);
		const cardsW = make(windowed);
		assert.deepEqual(windowed.render(40), full.render(40));
		for (const cards of [cardsF, cardsW]) {
			cards[1].addChild(new Text("added-later", 0, 0));
			cards[2].clear();
			cards[3].removeChild(cards[3].children[0]);
			cards[3].addChild(new Text("replaced", 0, 0));
		}
		assert.deepEqual(windowed.render(40), full.render(40));
	});

	it("removeChild of a frozen child and foreign edits of children stay equivalent", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(12);
		fillChat(full, 60, "remove-".repeat(10));
		fillChat(windowed, 60, "remove-".repeat(10));
		assert.deepEqual(windowed.render(70), full.render(70));
		full.removeChild(full.children[5]);
		windowed.removeChild(windowed.children[5]);
		assert.deepEqual(windowed.render(70), full.render(70));
		assert.ok(windowed.getFrozenChildCount() > 0);
		// Direct splice bypasses removeChild: identity check must thaw, not misplace lines.
		full.children.splice(3, 2);
		windowed.children.splice(3, 2);
		assert.deepEqual(windowed.render(70), full.render(70));
	});

	it("frozen Markdown edited later renders the new text", () => {
		const full = new Container();
		const windowed = new WindowedContainer();
		windowed.setLiveLineBudget(10);
		const mdF: Markdown[] = [];
		const mdW: Markdown[] = [];
		for (let i = 0; i < 20; i++) {
			const text = `## Message ${i}\n\nParagraph with \`code\` and **bold** ${"words ".repeat(20)}`;
			const f = new Markdown(text, 1, 0, markdownTheme);
			const w = new Markdown(text, 1, 0, markdownTheme);
			full.addChild(f);
			windowed.addChild(w);
			mdF.push(f);
			mdW.push(w);
		}
		assert.deepEqual(windowed.render(60), full.render(60));
		assert.ok(windowed.getFrozenChildCount() > 5);
		mdF[1].setText("## Rewritten\n\n- one\n- two");
		mdW[1].setText("## Rewritten\n\n- one\n- two");
		assert.deepEqual(windowed.render(60), full.render(60));
	});

	it("randomized nested mutations, removals and appends stay equivalent", () => {
		let state = 12345;
		const rand = (n: number) => {
			state = (state * 1103515245 + 12345) & 0x7fffffff;
			return state % n;
		};
		for (let trial = 0; trial < 30; trial++) {
			const full = new Container();
			const windowed = new WindowedContainer();
			windowed.setLiveLineBudget([4, 16, 40][trial % 3]);
			const width = [30, 60, 100][rand(3)];
			const add = () => {
				const body = `t${trial}-${rand(1000)}-`.repeat(1 + rand(12));
				const kind = rand(3);
				const pad = rand(2);
				for (const target of [full, windowed]) {
					if (kind === 0) {
						const box = new Box(1, pad, (s) => s);
						box.addChild(new Text(body, 0, 0));
						target.addChild(box);
					} else if (kind === 1) {
						target.addChild(new Text(body, 1, pad));
					} else {
						target.addChild(new Spacer(1 + pad));
					}
				}
			};
			for (let i = 0; i < 20; i++) add();
			for (let step = 0; step < 25; step++) {
				const op = rand(4);
				const index = rand(full.children.length);
				if (op === 0) add();
				else if (op === 1 && full.children.length > 2) {
					full.removeChild(full.children[index]);
					windowed.removeChild(windowed.children[index]);
				} else {
					const text = `edit-${step}-`.repeat(1 + rand(10));
					const lines = 1 + rand(3);
					for (const target of [full, windowed]) {
						const child = target.children[index];
						if (child instanceof Text) child.setText(text);
						else if (child instanceof Box && child.children[0] instanceof Text) child.children[0].setText(text);
						else if (child instanceof Spacer) child.setLines(lines);
					}
				}
				assert.deepEqual(windowed.render(width), full.render(width), `trial=${trial} step=${step}`);
			}
		}
	});
});
