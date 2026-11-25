import { releaseRenderCache, renderGeneration } from "./render-generation.ts";
import type { Component } from "./tui.ts";

/**
 * A frozen segment never grows past this many lines (a single larger child
 * gets a segment of its own). Bounds the work of refreshing one changed child:
 * only its segment's line buffer is rebuilt, never the whole frozen history.
 */
export const SEGMENT_MAX_LINES = 512;

/** Contiguous settled children whose rendered lines are reused verbatim. */
export type FrozenSegment = {
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

/** Per-frame counters a refresh accumulates into. */
export type SegmentRefreshStats = { refreshedChildren: number; refreshedSegments: number };

type SettledCheck = (child: Component) => boolean;

/** Splice one child out of the segment table after `children[index]` was removed. */
export function dropFrozenChild(segments: FrozenSegment[], index: number): void {
	for (const segment of segments) {
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
	for (let i = segments.length - 1; i >= 0; i--) {
		if (segments[i].children.length === 0) segments.splice(i, 1);
	}
}

/**
 * Drop unsettled segments and refresh children whose generation moved.
 * Returns the kept segments, or null when a foreign edit of `children`
 * invalidated every segment (the caller drops all state).
 */
export function reconcileSegments(
	segments: FrozenSegment[],
	children: readonly Component[],
	isSettled: SettledCheck,
	width: number,
	stats: SegmentRefreshStats,
): FrozenSegment[] | null {
	const kept: FrozenSegment[] = [];
	for (const segment of segments) {
		let dirty: number[] | undefined;
		let settled = true;
		for (let j = 0; j < segment.children.length; j++) {
			const child = segment.children[j];
			if (children[segment.from + j] !== child) {
				// `children` was edited behind our back: nothing frozen can be trusted.
				return null;
			}
			if (!isSettled(child)) {
				settled = false;
				break;
			}
			if (renderGeneration(child) !== segment.generations[j]) {
				dirty ??= [];
				dirty.push(j);
			}
		}
		if (!settled) continue;
		if (dirty) refreshSegment(segment, dirty, width, stats);
		kept.push(segment);
	}
	return kept;
}

function refreshSegment(segment: FrozenSegment, dirty: number[], width: number, stats: SegmentRefreshStats): void {
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
	stats.refreshedChildren += dirty.length;
	stats.refreshedSegments += 1;
}

/** Freeze settled live children that sit above the live-line budget. */
export function freezeAboveBudget(
	segments: FrozenSegment[],
	children: readonly Component[],
	isSettled: SettledCheck,
	parts: string[][],
	partStarts: number[],
	live: number[],
	liveLines: string[][],
	budget: number,
): void {
	let acc = 0;
	let liveStart = children.length;
	for (let p = parts.length - 1; p >= 0; p--) {
		acc += parts[p].length;
		liveStart = partStarts[p];
		if (acc >= budget) break;
	}
	let segmentIndex = 0;
	for (let n = 0; n < live.length && live[n] < liveStart; n++) {
		const index = live[n];
		const child = children[index];
		if (!isSettled(child)) continue;
		const lines = liveLines[n];
		while (segmentIndex < segments.length && segments[segmentIndex].from < index) segmentIndex += 1;
		const previous = segments[segmentIndex - 1];
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
			segments.splice(segmentIndex, 0, segment);
			segmentIndex += 1;
		}
		releaseRenderCache(child);
	}
}

/** Promote oldest contiguous frozen segments into `virtualChildren` once frozen history exceeds `seed`. */
export function promoteVirtualSegments(segments: FrozenSegment[], virtualChildren: Component[], seed: number): void {
	let totalFrozenLines = 0;
	for (const segment of segments) totalFrozenLines += segment.lines.length;
	while (segments.length > 0 && totalFrozenLines > seed) {
		const first = segments[0];
		if (first.from !== virtualChildren.length) break;
		if (totalFrozenLines - first.lines.length < seed) break;
		segments.shift();
		totalFrozenLines -= first.lines.length;
		for (const child of first.children) {
			releaseRenderCache(child);
			virtualChildren.push(child);
		}
	}
}
