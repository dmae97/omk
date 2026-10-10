import { isRenderSettled, releaseRenderCache, renderGeneration } from "./render-generation.ts";
import { type Component, Container } from "./tui.ts";

/**
 * A frozen segment never grows past this many lines (a single larger child
 * gets a segment of its own). Bounds the work of refreshing one changed child:
 * only its segment's line buffer is rebuilt, never the whole frozen history.
 */
const SEGMENT_MAX_LINES = 512;

/**
 * Live-line budget: the bottom `max(120, 2 × terminal rows)` lines always
 * render live. Two viewports keep components that change without announcing
 * it (animations, stateful extension renderers) live wherever the user can
 * see them, also after scrolling back one screen; the 120 floor is the budget
 * when no viewport is attached and on small terminals.
 */
const MIN_LIVE_LINE_BUDGET = 120;
const LIVE_VIEWPORTS = 2;

/** Contiguous settled children whose rendered lines are reused verbatim. */
type FrozenSegment = {
	/** Index in `children` of the first frozen child. */
	from: number;
	/** The frozen children themselves (identity-checked every frame). */
	children: Component[];
	lineCounts: number[];
	/** `getRenderGeneration()` of each child when its lines were taken. */
	generations: number[];
	/** Concatenation of the children's lines. */
	lines: string[];
};

export interface WindowedRenderStats {
	/** Children rendered live this frame (live tail plus unsettled gaps). */
	liveChildren: number;
	/** Frozen children re-rendered because their generation moved. */
	refreshedChildren: number;
	/** Frozen segments whose line buffer was rebuilt this frame. */
	refreshedSegments: number;
}

/**
 * Container that freezes settled children above a live-line budget into
 * bounded line segments and stops re-rendering them.
 *
 * - Settledness comes from `isRenderSettled()` (missing ⇒ settled). Unsettled
 *   children always render live; settled runs on both sides of them freeze.
 * - Each frozen child remembers its `getRenderGeneration()`. When it moves,
 *   only that child is re-rendered and only its segment is rebuilt.
 * - An unsettled frozen child drops just its segment. Width changes,
 *   `invalidate()`, `clear()` and foreign edits of `children` thaw everything.
 * - Freezing releases the child's render caches (frozen lines are the only
 *   retained copy); a later change re-renders that one child from source.
 */
export class WindowedContainer extends Container {
	private segments: FrozenSegment[] = [];
	private frozenWidth = -1;
	private liveLineBudget = MIN_LIVE_LINE_BUDGET;
	private viewportRows?: () => number;
	private lastLiveLineBudget = MIN_LIVE_LINE_BUDGET;
	private stats: WindowedRenderStats = { liveChildren: 0, refreshedChildren: 0, refreshedSegments: 0 };

	/** Fixed budget (tests, embedders); detaches any viewport set by `setViewportRows`. */
	setLiveLineBudget(lines: number): void {
		this.viewportRows = undefined;
		this.liveLineBudget = Math.max(1, Math.floor(lines));
	}

	/**
	 * Follow the terminal height: budget = max(120, 2 × rows), re-read on every
	 * render so a resize applies on the next frame.
	 */
	setViewportRows(rows: () => number): void {
		this.viewportRows = rows;
	}

	getLiveLineBudget(): number {
		if (!this.viewportRows) return this.liveLineBudget;
		const rows = Math.floor(this.viewportRows());
		return Math.max(MIN_LIVE_LINE_BUDGET, Number.isFinite(rows) ? rows * LIVE_VIEWPORTS : 0);
	}

	getFrozenChildCount(): number {
		let count = 0;
		for (const segment of this.segments) count += segment.children.length;
		return count;
	}

	getFrozenLineCount(): number {
		let count = 0;
		for (const segment of this.segments) count += segment.lines.length;
		return count;
	}

	/** Diagnostics: number of frozen segments. */
	getFrozenSegmentCount(): number {
		return this.segments.length;
	}

	/** Diagnostics: frozen child index ranges [from, to). */
	getFrozenRanges(): ReadonlyArray<{ from: number; to: number }> {
		return this.segments.map((segment) => ({ from: segment.from, to: segment.from + segment.children.length }));
	}

	/** Diagnostics: what the most recent `render` had to redo. */
	getLastRenderStats(): Readonly<WindowedRenderStats> {
		return this.stats;
	}

	/** Subclasses may add their own lifecycle knowledge (e.g. an agent_end backstop). */
	protected isChildSettled(child: Component): boolean {
		return isRenderSettled(child);
	}

	override removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index === -1) return;
		super.removeChild(component);
		for (const segment of this.segments) {
			if (index < segment.from) {
				segment.from -= 1;
			} else if (index < segment.from + segment.children.length) {
				const j = index - segment.from;
				let offset = 0;
				for (let k = 0; k < j; k++) offset += segment.lineCounts[k];
				segment.lines.splice(offset, segment.lineCounts[j]);
				segment.children.splice(j, 1);
				segment.lineCounts.splice(j, 1);
				segment.generations.splice(j, 1);
			}
		}
		this.segments = this.segments.filter((segment) => segment.children.length > 0);
	}

	override clear(): void {
		this.thaw();
		super.clear();
	}

	override invalidate(): void {
		this.thaw();
		super.invalidate();
	}

	/** Drop every frozen segment; the next render re-renders all children. */
	thaw(): void {
		this.segments = [];
		this.frozenWidth = -1;
	}

	override render(width: number): string[] {
		const budget = this.getLiveLineBudget();
		// A taller terminal widens the live window: thaw so rows now inside it render live.
		if (width !== this.frozenWidth || budget > this.lastLiveLineBudget) this.thaw();
		this.lastLiveLineBudget = budget;
		this.frozenWidth = width;
		this.stats = { liveChildren: 0, refreshedChildren: 0, refreshedSegments: 0 };
		this.reconcile(width);

		const parts: string[][] = [];
		const partStarts: number[] = [];
		const live: number[] = [];
		const liveLines: string[][] = [];
		let segmentIndex = 0;
		for (let i = 0; i < this.children.length; ) {
			const segment = this.segments[segmentIndex];
			let lines: string[];
			partStarts.push(i);
			if (segment && segment.from === i) {
				lines = segment.lines;
				i += segment.children.length;
				segmentIndex += 1;
			} else {
				lines = this.children[i].render(width);
				live.push(i);
				liveLines.push(lines);
				i += 1;
			}
			parts.push(lines);
		}
		this.stats.liveChildren = live.length;

		// Copy before freezing: freezing appends to segment line buffers. Native
		// concat is a bulk copy; spread arguments stay far below engine limits
		// because frozen rows arrive as a few hundred segment arrays.
		const out = parts.length < 8192 ? ([] as string[]).concat(...parts) : parts.flat();
		this.freezeAboveBudget(parts, partStarts, live, liveLines, budget);
		return out;
	}

	/** Drop unsettled segments and refresh children whose generation moved. */
	private reconcile(width: number): void {
		const kept: FrozenSegment[] = [];
		for (const segment of this.segments) {
			let dirty: number[] | undefined;
			let settled = true;
			for (let j = 0; j < segment.children.length; j++) {
				const child = segment.children[j];
				if (this.children[segment.from + j] !== child) {
					// `children` was edited behind our back: nothing frozen can be trusted.
					this.segments = [];
					return;
				}
				if (!this.isChildSettled(child)) {
					settled = false;
					break;
				}
				if (renderGeneration(child) !== segment.generations[j]) {
					dirty ??= [];
					dirty.push(j);
				}
			}
			if (!settled) continue;
			if (dirty) this.refreshSegment(segment, dirty, width);
			kept.push(segment);
		}
		this.segments = kept;
	}

	private refreshSegment(segment: FrozenSegment, dirty: number[], width: number): void {
		const lines: string[] = [];
		let offset = 0;
		let next = 0;
		for (let j = 0; j < segment.children.length; j++) {
			const count = segment.lineCounts[j];
			if (dirty[next] === j) {
				next += 1;
				const child = segment.children[j];
				const fresh = child.render(width);
				for (const line of fresh) lines.push(line);
				segment.lineCounts[j] = fresh.length;
				segment.generations[j] = renderGeneration(child);
				releaseRenderCache(child);
			} else {
				for (let l = offset; l < offset + count; l++) lines.push(segment.lines[l]);
			}
			offset += count;
		}
		segment.lines = lines;
		this.stats.refreshedChildren += dirty.length;
		this.stats.refreshedSegments += 1;
	}

	/** Freeze settled live children that sit above the live-line budget. */
	private freezeAboveBudget(
		parts: string[][],
		partStarts: number[],
		live: number[],
		liveLines: string[][],
		budget: number,
	): void {
		let acc = 0;
		let liveStart = this.children.length;
		for (let p = parts.length - 1; p >= 0; p--) {
			acc += parts[p].length;
			liveStart = partStarts[p];
			if (acc >= budget) break;
		}
		let segmentIndex = 0;
		for (let n = 0; n < live.length && live[n] < liveStart; n++) {
			const index = live[n];
			const child = this.children[index];
			if (!this.isChildSettled(child)) continue;
			const lines = liveLines[n];
			while (segmentIndex < this.segments.length && this.segments[segmentIndex].from < index) segmentIndex += 1;
			const previous = this.segments[segmentIndex - 1];
			const generation = renderGeneration(child);
			if (
				previous &&
				previous.from + previous.children.length === index &&
				previous.lines.length + lines.length <= SEGMENT_MAX_LINES
			) {
				previous.children.push(child);
				previous.lineCounts.push(lines.length);
				previous.generations.push(generation);
				for (const line of lines) previous.lines.push(line);
			} else {
				const segment: FrozenSegment = {
					from: index,
					children: [child],
					lineCounts: [lines.length],
					generations: [generation],
					lines: lines.slice(),
				};
				this.segments.splice(segmentIndex, 0, segment);
				segmentIndex += 1;
			}
			releaseRenderCache(child);
		}
	}
}
