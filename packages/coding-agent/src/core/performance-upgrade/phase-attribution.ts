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
 * Cost: O(M log M) to sort the M <= 2|V| + 2 breakpoints, plus O(K * A) for K segments with at
 * most A spans active at once. Deep nesting or wide overlap makes A approach |V|, so the worst
 * case is O(|V|^2); that is fine for offline evaluation of one turn, not for a hot path.
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
	const exclusiveTicks = new Map<string, number>(snapshots.map((span) => [span.spanId, 0]));
	const points = [
		...new Set([submittedAt, settledAt, ...clipped.flatMap((c) => [c.clippedStart, c.clippedEnd])]),
	].sort((a, b) => a - b);
	const byStart = clipped.filter((c) => c.clippedEnd > c.clippedStart).sort((a, b) => a.clippedStart - b.clippedStart);
	let active: Clipped[] = [];
	let next = 0;
	for (let k = 0; k + 1 < points.length; k++) {
		const segmentStart = points[k];
		const length = points[k + 1] - segmentStart;
		while (next < byStart.length && byStart[next].clippedStart <= segmentStart) active.push(byStart[next++]);
		active = active.filter((c) => c.clippedEnd > segmentStart);
		let winner: Clipped | undefined;
		const activeParents = new Set<string>();
		for (const c of active) {
			if (winner === undefined || outranks(c, winner)) winner = c;
			if (c.parentId !== undefined) activeParents.add(c.parentId);
		}
		phaseTicks[winner?.phase ?? "unattributed"] += length;
		for (const c of active) {
			if (!activeParents.has(c.spanId)) {
				exclusiveTicks.set(c.spanId, (exclusiveTicks.get(c.spanId) ?? 0) + length);
			}
		}
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
