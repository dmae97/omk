import { isRenderSettled } from "./render-generation.ts";
import { type Component, Container } from "./tui.ts";
import {
	dropFrozenChild,
	type FrozenSegment,
	freezeAboveBudget,
	promoteVirtualSegments,
	reconcileSegments,
} from "./windowed-segments.ts";

/**
 * Live-line budget: the bottom `max(120, 2 × terminal rows)` lines always
 * render live. Two viewports keep components that change without announcing
 * it (animations, stateful extension renderers) live wherever the user can
 * see them, also after scrolling back one screen; the 120 floor is the budget
 * when no viewport is attached and on small terminals.
 */
const MIN_LIVE_LINE_BUDGET = 120;
const LIVE_VIEWPORTS = 2;

export interface WindowedRenderStats {
	/** Children rendered live this frame (live tail plus unsettled gaps). */
	liveChildren: number;
	/** Frozen children re-rendered because their generation moved. */
	refreshedChildren: number;
	/** Frozen segments whose line buffer was rebuilt this frame. */
	refreshedSegments: number;
	/** Settled children skipped entirely this frame (virtual prefix). */
	virtualChildren: number;
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
 *
 * Virtual prefix (opt-in via `setPrefixSeed`/`setPrefixSeedViewport`):
 * when a prefix seed is configured, children above the live budget PLUS the
 * seed budget never render at all — `render()` returns zero lines for them.
 * Rendered line work is bounded by live + seed; prefix identity/settledness
 * checks still visit skipped children. The
 * prefix is a contiguous run anchored at index 0; children above the seed
 * budget never enter the output, so callers that need the whole transcript
 * (`buildFinalSessionLog`, exports) must use `renderAll(width)`.
 */
export class WindowedContainer extends Container {
	private segments: FrozenSegment[] = [];
	private frozenWidth = -1;
	private liveLineBudget = MIN_LIVE_LINE_BUDGET;
	private viewportRows?: () => number;
	private lastLiveLineBudget = MIN_LIVE_LINE_BUDGET;
	private stats: WindowedRenderStats = {
		liveChildren: 0,
		refreshedChildren: 0,
		refreshedSegments: 0,
		virtualChildren: 0,
	};
	/**
	 * Children above live+seed that never render (opt-in). Contiguous from
	 * index 0; emits zero lines every frame once established.
	 */
	private virtualChildren: Component[] = [];
	/** Unset preserves full-history rendering; zero seeds only the live tail. */
	private seedLines?: number;
	private seedViewportRows?: () => number;
	private seedScreens?: number;
	private lastPrefixSeedLines?: number;
	/** Bound `isChildSettled` for the extracted segment helpers. */
	private readonly settled = (child: Component): boolean => this.isChildSettled(child);

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

	/**
	 * Opt in to the virtual prefix: settled children above
	 * `live budget + seedLines` never render — the first frame of a long
	 * transcript renders only live + seed lines. Zero seeds only the live
	 * tail; unset or non-finite input restores full-history rendering.
	 */
	setPrefixSeed(lines?: number): void {
		this.seedViewportRows = undefined;
		this.seedScreens = undefined;
		this.seedLines = lines !== undefined && Number.isFinite(lines) ? Math.max(0, Math.floor(lines)) : undefined;
	}

	/** Seed budget follows the terminal height: `screens × rows`, re-read on every render. */
	setPrefixSeedViewport(screens: number, rows: () => number): void {
		this.seedLines = undefined;
		this.seedScreens = Number.isFinite(screens) ? Math.max(0, Math.floor(screens)) : undefined;
		this.seedViewportRows = rows;
	}

	/** Current seed budget in lines; undefined means virtualization is off. */
	getPrefixSeedLines(): number | undefined {
		if (!this.seedViewportRows) return this.seedLines;
		if (this.seedScreens === undefined) return undefined;
		const rows = Math.floor(this.seedViewportRows());
		return Math.max(0, Number.isFinite(rows) ? rows * this.seedScreens : 0);
	}

	/** Children skipped entirely by the last render (virtual prefix). */
	getVirtualChildCount(): number {
		return this.virtualChildren.length;
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
		if (index < this.virtualChildren.length) this.virtualChildren.splice(index, 1);
		dropFrozenChild(this.segments, index);
	}

	override clear(): void {
		this.thaw();
		super.clear();
	}

	override invalidate(): void {
		this.thaw();
		super.invalidate();
	}

	/** Drop every frozen segment and the virtual prefix; the next render re-lays out all children. */
	thaw(): void {
		this.segments = [];
		this.virtualChildren = [];
		this.frozenWidth = -1;
	}

	/**
	 * Render every child without any windowing or virtualization. For callers
	 * that need the complete transcript (final session log, exports) — the
	 * windowed state is untouched and the next `render()` resumes windowing.
	 */
	renderAll(width: number): string[] {
		return super.render(width);
	}

	override render(width: number): string[] {
		const budget = this.getLiveLineBudget();
		const seed = this.getPrefixSeedLines();
		// Rebuild on seed changes too: a taller terminal can grow it without growing the live budget.
		if (width !== this.frozenWidth || budget > this.lastLiveLineBudget || seed !== this.lastPrefixSeedLines)
			this.thaw();
		this.lastLiveLineBudget = budget;
		this.lastPrefixSeedLines = seed;
		this.frozenWidth = width;
		this.stats = { liveChildren: 0, refreshedChildren: 0, refreshedSegments: 0, virtualChildren: 0 };
		// Build the virtual prefix once, while no frozen segments exist. Lines
		// rendered during the boundary scan are memoized into the emit pass.
		const memo =
			seed !== undefined && this.virtualChildren.length === 0 && this.segments.length === 0
				? this.scanVirtualBoundary(width, budget, seed)
				: undefined;
		this.reconcileVirtual();
		this.reconcile(width);
		this.stats.virtualChildren = this.virtualChildren.length;

		const parts: string[][] = [];
		const partStarts: number[] = [];
		const live: number[] = [];
		const liveLines: string[][] = [];
		let segmentIndex = 0;
		for (let i = this.virtualChildren.length; i < this.children.length; ) {
			const segment = this.segments[segmentIndex];
			let lines: string[];
			partStarts.push(i);
			if (segment && segment.from === i) {
				lines = segment.lines;
				i += segment.children.length;
				segmentIndex += 1;
			} else {
				lines = memo?.get(i) ?? this.children[i].render(width);
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
		freezeAboveBudget(this.segments, this.children, this.settled, parts, partStarts, live, liveLines, budget);
		if (seed !== undefined) promoteVirtualSegments(this.segments, this.virtualChildren, seed);
		return out;
	}

	/**
	 * Establish the virtual prefix in a single bottom-up pass: render children
	 * from the tail until `live + seed` lines are covered and mark everything
	 * above as virtual. Returns the rendered lines keyed by child index for
	 * the emit pass to reuse (children render at most once per frame).
	 *
	 * An unsettled child may end up inside the virtual prefix (the scan does
	 * not check settledness): `reconcileVirtual` then truncates the prefix
	 * there and the emit pass renders it live as usual, so no output is lost.
	 */
	private scanVirtualBoundary(width: number, budget: number, seed: number): Map<number, string[]> {
		const memo = new Map<number, string[]>();
		const target = budget + seed;
		let acc = 0;
		let i = this.children.length;
		while (i > 0 && acc < target) {
			i -= 1;
			const lines = this.children[i].render(width);
			memo.set(i, lines);
			acc += lines.length;
		}
		this.virtualChildren = this.children.slice(0, i);
		return memo;
	}

	/**
	 * Verify the virtual prefix is still a valid prefix of `children` and still
	 * settled. On the first mismatch (identity, reorder, un-settled) the prefix
	 * is truncated there: children past the cut render live this frame and
	 * their lines materialize as new output (a bounded repaint repair).
	 */
	private reconcileVirtual(): void {
		const count = this.virtualChildren.length;
		let v = 0;
		while (v < count && this.children[v] === this.virtualChildren[v] && this.isChildSettled(this.children[v])) v += 1;
		if (v < count) this.virtualChildren.length = v;
	}

	/** Drop unsettled segments and refresh children whose generation moved. */
	private reconcile(width: number): void {
		const kept = reconcileSegments(this.segments, this.children, this.settled, width, this.stats);
		this.segments = kept ?? [];
	}
}
