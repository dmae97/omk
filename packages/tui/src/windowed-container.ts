import { type Component, Container } from "./tui.ts";

type CacheNode = Component & {
	releaseRenderCache?: () => void;
	cachedLines?: string[];
	cachedText?: string;
	cachedWidth?: number;
	cache?: unknown;
	streamCache?: unknown;
	children?: Component[];
};

type SettledNode = Component & {
	isRenderSettled?: () => boolean;
	getRenderGeneration?: () => number;
};

/**
 * Duck-typed release of render caches for frozen (off-screen) components.
 * Prefer an explicit `releaseRenderCache()` hook when present (so #65 Markdown
 * can clear `streamCache` in one method). Otherwise clear known cache fields,
 * including `streamCache` if a future Markdown lands it without a hook yet.
 */
export function releaseRenderCache(component: Component): void {
	const node = component as CacheNode;
	if (typeof node.releaseRenderCache === "function") {
		node.releaseRenderCache();
		return;
	}
	if ("cachedLines" in node) {
		node.cachedLines = undefined;
		node.cachedText = undefined;
		node.cachedWidth = undefined;
	}
	if ("cache" in node) {
		node.cache = undefined;
	}
	if ("streamCache" in node) {
		node.streamCache = undefined;
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			releaseRenderCache(child);
		}
	}
}

/**
 * Optional duck-typed settle hook. Missing hook ⇒ treated as settled (plain
 * Text/Box/Spacer keep today's freeze behavior). Message components will wire
 * this via the shared settled predicate (spec 026) in a follow-up.
 */
export function isRenderSettled(component: Component): boolean {
	const node = component as SettledNode;
	if (typeof node.isRenderSettled === "function") {
		return node.isRenderSettled();
	}
	return true;
}

function renderGeneration(component: Component): number {
	const node = component as SettledNode;
	if (typeof node.getRenderGeneration === "function") {
		return node.getRenderGeneration();
	}
	return 0;
}

/** Contiguous settled children whose lines are reused until a child changes. */
type FrozenSegment = {
	from: number;
	to: number;
	lines: string[];
	lineCounts: number[];
	generations: number[];
};

/**
 * Container that freezes settled child *runs* (segments) above the live-line
 * budget into line buffers, including settled runs that sit *after* unsettled
 * children. Unsettled children always re-render. A generation bump updates
 * only that child inside its segment (no full thaw). Full thaw is reserved
 * for width resize and invalidate().
 *
 * Trade-off: freeze still calls `releaseRenderCache`, so a mutated frozen
 * child re-renders from source once; siblings in other segments keep their
 * stored lines. Segment line buffers are the retained display for frozen
 * content (AC2: component caches cleared).
 */
export class WindowedContainer extends Container {
	private segments: FrozenSegment[] = [];
	private frozenWidth = -1;
	private liveLineBudget = 120;

	setLiveLineBudget(lines: number): void {
		this.liveLineBudget = Math.max(1, Math.floor(lines));
	}

	getLiveLineBudget(): number {
		return this.liveLineBudget;
	}

	getFrozenChildCount(): number {
		let n = 0;
		for (const seg of this.segments) n += seg.to - seg.from;
		return n;
	}

	getFrozenLineCount(): number {
		let n = 0;
		for (const seg of this.segments) n += seg.lines.length;
		return n;
	}

	/** Test/diagnostics: number of frozen settled runs. */
	getFrozenSegmentCount(): number {
		return this.segments.length;
	}

	/** Test/diagnostics: frozen child index ranges [from, to). */
	getFrozenRanges(): ReadonlyArray<{ from: number; to: number }> {
		return this.segments.map((seg) => ({ from: seg.from, to: seg.to }));
	}

	override removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1 && this.segmentCovering(index)) {
			this.dropSegmentsOverlapping(index, index + 1);
		}
		super.removeChild(component);
		this.reindexSegmentsAfterRemoval(index);
	}

	override clear(): void {
		this.thaw();
		super.clear();
	}

	override invalidate(): void {
		this.thaw();
		super.invalidate();
	}

	/** Full thaw — resize / invalidate only. */
	thaw(): void {
		this.segments = [];
		this.frozenWidth = -1;
	}

	private segmentCovering(childIndex: number): FrozenSegment | undefined {
		for (const seg of this.segments) {
			if (childIndex >= seg.from && childIndex < seg.to) return seg;
		}
		return undefined;
	}

	private dropSegmentsOverlapping(from: number, to: number): void {
		this.segments = this.segments.filter((seg) => seg.to <= from || seg.from >= to);
	}

	private reindexSegmentsAfterRemoval(removed: number): void {
		if (removed < 0) return;
		const next: FrozenSegment[] = [];
		for (const seg of this.segments) {
			if (seg.to <= removed) {
				next.push(seg);
			} else if (seg.from > removed) {
				next.push({
					...seg,
					from: seg.from - 1,
					to: seg.to - 1,
				});
			}
			// Segment that contained the removed child was already dropped.
		}
		this.segments = next;
	}

	/**
	 * Per-segment reconcile: drop if any child unsettled; otherwise splice
	 * freshly rendered lines for generation-bumped children only.
	 */
	private reconcileSegments(width: number): void {
		const next: FrozenSegment[] = [];
		for (const seg of this.segments) {
			if (seg.to > this.children.length) continue;

			let unsettled = false;
			const dirty: number[] = [];
			for (let i = 0; i < seg.to - seg.from; i++) {
				const child = this.children[seg.from + i];
				if (!isRenderSettled(child)) {
					unsettled = true;
					break;
				}
				if (renderGeneration(child) !== seg.generations[i]) dirty.push(i);
			}
			if (unsettled) continue;
			if (dirty.length === 0) {
				next.push(seg);
				continue;
			}

			const parts: string[][] = [];
			const newCounts = seg.lineCounts.slice();
			const newGens = seg.generations.slice();
			let offset = 0;
			for (let i = 0; i < seg.to - seg.from; i++) {
				const prevCount = seg.lineCounts[i];
				if (dirty.includes(i)) {
					const fresh = this.children[seg.from + i].render(width);
					parts.push(fresh);
					newCounts[i] = fresh.length;
					newGens[i] = renderGeneration(this.children[seg.from + i]);
					releaseRenderCache(this.children[seg.from + i]);
				} else {
					parts.push(seg.lines.slice(offset, offset + prevCount));
				}
				offset += prevCount;
			}
			const lines: string[] = [];
			for (const part of parts) {
				for (const line of part) lines.push(line);
			}
			next.push({
				from: seg.from,
				to: seg.to,
				lines,
				lineCounts: newCounts,
				generations: newGens,
			});
		}
		this.segments = next;
	}

	override render(width: number): string[] {
		if (this.frozenWidth !== -1 && width !== this.frozenWidth) {
			this.thaw();
		} else if (this.segments.length > 0) {
			this.reconcileSegments(width);
		}

		const n = this.children.length;
		const childLines: (string[] | undefined)[] = new Array(n);

		for (const seg of this.segments) {
			let offset = 0;
			for (let j = 0; j < seg.to - seg.from; j++) {
				const count = seg.lineCounts[j];
				childLines[seg.from + j] = seg.lines.slice(offset, offset + count);
				offset += count;
			}
		}

		for (let i = 0; i < n; i++) {
			if (!childLines[i]) {
				childLines[i] = this.children[i].render(width);
			}
		}

		let acc = 0;
		let liveTailStart = n;
		for (let i = n - 1; i >= 0; i--) {
			acc += childLines[i]!.length;
			liveTailStart = i;
			if (acc >= this.liveLineBudget) break;
		}

		// Freeze maximal settled runs in [0, liveTailStart), including after gaps.
		const newSegments: FrozenSegment[] = [];
		let i = 0;
		while (i < liveTailStart) {
			if (!isRenderSettled(this.children[i])) {
				i += 1;
				continue;
			}
			const from = i;
			while (i < liveTailStart && isRenderSettled(this.children[i])) i += 1;
			const to = i;

			const existing = this.segments.find((s) => s.from === from && s.to === to);
			if (existing) {
				newSegments.push(existing);
				continue;
			}

			const lineCounts: number[] = [];
			const lines: string[] = [];
			const generations: number[] = [];
			for (let j = from; j < to; j++) {
				const linesJ = childLines[j]!;
				lineCounts.push(linesJ.length);
				for (const line of linesJ) lines.push(line);
				generations.push(renderGeneration(this.children[j]));
				releaseRenderCache(this.children[j]);
			}
			newSegments.push({ from, to, lines, lineCounts, generations });
		}
		this.segments = newSegments;
		this.frozenWidth = width;

		const out: string[] = [];
		for (let c = 0; c < n; c++) {
			for (const line of childLines[c]!) out.push(line);
		}
		return out;
	}
}
