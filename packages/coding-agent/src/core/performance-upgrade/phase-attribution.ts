import {
	isMeasurementPhase,
	isTick,
	MEASUREMENT_PHASES,
	MeasurementInputError,
	type MeasurementPhase,
	type MeasurementSpan,
} from "./measurement-trace.ts";

/**
 * B12 turn-phase partition (OMK_MATH_f46a8f6): T_turn = t_settled - t_submit = sum_j T_j.
 *
 * Breakpoints are the span endpoints plus the turn window, and each segment [b_k, b_{k+1}) goes
 * to exactly one phase. Two choices close gaps the bundle leaves open:
 * - endpoints are clipped to the window first; unclipped endpoints outside it make the segment
 *   lengths sum to more than T_turn (spans at [95,130) and [140,210) over [100,200) give 115);
 * - a segment covered by several spans goes to the deepest one, then the one ending last (the
 *   overlap's critical path), then the later start, then the smaller spanId. Ends and starts are
 *   compared unclipped, so where the window ends cannot change who owns an overlap. Uncovered
 *   time is `unattributed`.
 * Ticks are safe integers, so the partition identity holds exactly. Exclusive span time
 * |I_v \ union of children| is measured on the clipped intervals and double counts overlapping
 * siblings, which is why it is not the partition. Each input field is read once; a getter cannot
 * change a value after it was validated.
 *
 * Cost: O(M log M) to sort the M <= 2|V| + 2 breakpoints, plus O(|V| log |V|) for the
 * active-winner heap and per-parent child-interval unions. It avoids rescanning every active
 * span for every segment, so deep nesting and wide overlap do not make the partition quadratic.
 */
export type PhaseSpan = Pick<MeasurementSpan, "spanId" | "parentId" | "phase" | "monotonicStart" | "monotonicEnd">;

export interface PhaseAttributionInput {
	readonly spans: readonly PhaseSpan[];
	readonly submittedAt: number;
	readonly settledAt: number;
}

export interface PhaseAttribution {
	readonly turnTicks: number;
	readonly phaseTicks: Readonly<Record<MeasurementPhase, number>>;
	readonly exclusiveTicks: ReadonlyMap<string, number>;
	readonly clippedSpans: number;
}

interface Snapshot {
	readonly spanId: string;
	readonly parentId: string | undefined;
	readonly phase: MeasurementPhase;
	readonly start: number;
	readonly end: number;
}

/** `start`/`end` stay the span's real bounds; `clippedStart`/`clippedEnd` lie inside the window. */
interface Clipped extends Snapshot {
	readonly clippedStart: number;
	readonly clippedEnd: number;
	readonly depth: number;
}

function snapshot(span: PhaseSpan): Snapshot {
	const { spanId, parentId, phase, monotonicStart, monotonicEnd } = span;
	if (typeof spanId !== "string") throw new MeasurementInputError("invalid_id", "spanId");
	if (parentId !== undefined && typeof parentId !== "string") {
		throw new MeasurementInputError("invalid_id", "parentId");
	}
	if (!isMeasurementPhase(phase)) throw new MeasurementInputError("invalid_phase", "phase");
	if (!isTick(monotonicStart) || !isTick(monotonicEnd)) {
		throw new MeasurementInputError("invalid_tick", "monotonicStart/monotonicEnd");
	}
	if (monotonicEnd < monotonicStart) throw new MeasurementInputError("invalid_interval", "span");
	return { spanId, parentId, phase, start: monotonicStart, end: monotonicEnd };
}

function depths(spans: readonly Snapshot[]): Map<string, number> {
	const byId = new Map<string, Snapshot>();
	for (const span of spans) {
		if (byId.has(span.spanId)) throw new MeasurementInputError("duplicate_id", "spanId");
		byId.set(span.spanId, span);
	}
	const depth = new Map<string, number>();
	for (const span of spans) {
		const chain: string[] = [];
		const seen = new Set<string>();
		let cursor: Snapshot | undefined = span;
		let base = -1;
		while (cursor !== undefined) {
			const known = depth.get(cursor.spanId);
			if (known !== undefined) {
				base = known;
				break;
			}
			if (seen.has(cursor.spanId)) throw new MeasurementInputError("cycle", "parentId");
			seen.add(cursor.spanId);
			chain.push(cursor.spanId);
			if (cursor.parentId === undefined) break;
			cursor = byId.get(cursor.parentId);
			if (cursor === undefined) throw new MeasurementInputError("unknown_parent", "parentId");
		}
		for (let index = chain.length - 1; index >= 0; index--) depth.set(chain[index], ++base);
	}
	return depth;
}

function outranks(a: Clipped, b: Clipped): boolean {
	if (a.depth !== b.depth) return a.depth > b.depth;
	if (a.end !== b.end) return a.end > b.end;
	if (a.start !== b.start) return a.start > b.start;
	return a.spanId < b.spanId;
}

class ActiveSpanHeap {
	readonly #items: Clipped[] = [];

	get top(): Clipped | undefined {
		return this.#items[0];
	}

	push(value: Clipped): void {
		const items = this.#items;
		let index = items.length;
		items.push(value);
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!outranks(value, items[parent])) break;
			items[index] = items[parent];
			index = parent;
		}
		items[index] = value;
	}

	pop(): void {
		const items = this.#items;
		const last = items.pop();
		if (items.length === 0 || last === undefined) return;
		let index = 0;
		while (true) {
			const left = 2 * index + 1;
			if (left >= items.length) break;
			const right = left + 1;
			const child = right < items.length && outranks(items[right], items[left]) ? right : left;
			if (!outranks(items[child], last)) break;
			items[index] = items[child];
			index = child;
		}
		items[index] = last;
	}
}

/** Exclusive time is a span's clipped interval minus the union of its direct children's intervals. */
function computeExclusiveTicks(clipped: readonly Clipped[]): Map<string, number> {
	const children = new Map<string, Clipped[]>();
	for (const span of clipped) {
		if (span.parentId === undefined || span.clippedEnd <= span.clippedStart) continue;
		const siblings = children.get(span.parentId);
		if (siblings === undefined) children.set(span.parentId, [span]);
		else siblings.push(span);
	}
	const result = new Map<string, number>();
	for (const span of clipped) {
		const start = span.clippedStart;
		const end = span.clippedEnd;
		if (end <= start) {
			result.set(span.spanId, 0);
			continue;
		}
		const intervals = children.get(span.spanId);
		if (intervals === undefined) {
			result.set(span.spanId, end - start);
			continue;
		}
		intervals.sort((a, b) => a.clippedStart - b.clippedStart || a.clippedEnd - b.clippedEnd);
		let covered = 0;
		let unionStart = start;
		let unionEnd = start;
		for (const child of intervals) {
			const childStart = Math.max(start, child.clippedStart);
			const childEnd = Math.min(end, child.clippedEnd);
			if (childEnd <= childStart) continue;
			if (childStart > unionEnd) {
				covered += unionEnd - unionStart;
				unionStart = childStart;
				unionEnd = childEnd;
			} else if (childEnd > unionEnd) {
				unionEnd = childEnd;
			}
		}
		covered += unionEnd - unionStart;
		result.set(span.spanId, Math.max(0, end - start - covered));
	}
	return result;
}

export function attributePhases(input: PhaseAttributionInput): PhaseAttribution {
	const { spans, submittedAt, settledAt } = input;
	if (!isTick(submittedAt) || !isTick(settledAt)) throw new MeasurementInputError("invalid_tick", "window");
	if (settledAt < submittedAt) throw new MeasurementInputError("invalid_interval", "window");
	const snapshots = spans.map(snapshot);
	const depth = depths(snapshots);
	const clip = (tick: number) => Math.min(Math.max(tick, submittedAt), settledAt);
	const clipped: Clipped[] = snapshots.map((span) => ({
		...span,
		clippedStart: clip(span.start),
		clippedEnd: clip(span.end),
		depth: depth.get(span.spanId) ?? 0,
	}));
	const clippedSpans = clipped.filter((c) => c.clippedStart !== c.start || c.clippedEnd !== c.end).length;
	const phaseTicks = Object.fromEntries(MEASUREMENT_PHASES.map((phase) => [phase, 0])) as Record<
		MeasurementPhase,
		number
	>;
	const exclusiveTicks = computeExclusiveTicks(clipped);
	const points = [
		...new Set([submittedAt, settledAt, ...clipped.flatMap((c) => [c.clippedStart, c.clippedEnd])]),
	].sort((a, b) => a - b);
	const byStart = clipped.filter((c) => c.clippedEnd > c.clippedStart).sort((a, b) => a.clippedStart - b.clippedStart);
	const active = new ActiveSpanHeap();
	let next = 0;
	for (let k = 0; k + 1 < points.length; k++) {
		const segmentStart = points[k];
		const length = points[k + 1] - segmentStart;
		while (next < byStart.length && byStart[next].clippedStart <= segmentStart) active.push(byStart[next++]);
		while (active.top !== undefined && active.top.clippedEnd <= segmentStart) active.pop();
		phaseTicks[active.top?.phase ?? "unattributed"] += length;
	}
	return { turnTicks: settledAt - submittedAt, phaseTicks, exclusiveTicks, clippedSpans };
}

/**
 * Amdahl's bound on the turn speedup from making phase j `phaseSpeedup` times faster while every
 * other phase keeps its time: 1 / ((1 - f_j) + f_j / s_j). A phase microbenchmark gain is not a
 * turn latency gain.
 */
export function turnSpeedupBound(phaseShare: number, phaseSpeedup: number): number {
	if (typeof phaseShare !== "number" || !(phaseShare >= 0 && phaseShare <= 1)) {
		throw new MeasurementInputError("invalid_number", "phaseShare");
	}
	if (typeof phaseSpeedup !== "number" || !(phaseSpeedup > 0)) {
		throw new MeasurementInputError("invalid_number", "phaseSpeedup");
	}
	return 1 / (1 - phaseShare + phaseShare / phaseSpeedup);
}
