/**
 * ECRAF — resource-aware ready queue admission planner.
 *
 * Given the current ready frontier, a free-slot count, and multi-dimensional
 * resource capacities, choose which ready nodes to admit next using the
 * deterministic greedy baseline the deep-research report prescribes (PR 8).
 *
 * Nodes are scored by priority density:
 *
 *     D_i = P_i / (epsilon + sum_r  resourceWeight_r * a_ir)
 *
 * then sorted by density descending, readySeq ascending, sourceIndex ascending.
 * A candidate is admitted only if admitting it does not push cumulative
 * running usage over any capacity and it does not semantically conflict with a
 * node already admitted in this pass. Admission is pure: it computes the plan;
 * the caller launches.
 */

export interface EcrafCandidate {
	/** Source order of the call within the batch — the stable tiebreak. */
	readonly sourceIndex: number;
	/** Monotonic order in which the node first entered the ready frontier. */
	readonly readySeq: number;
	/** Resource vector: resource name -> units consumed while running. */
	readonly resources: Readonly<Record<string, number>>;
	/** Scalar priority P_i already folded (rank, aging, evidence, risk...). */
	readonly priority: number;
}

export interface EcrafAdmissionsOptions {
	readonly candidates: readonly EcrafCandidate[];
	/** Resource units already held by running nodes: name -> units. */
	readonly runningUsage: Readonly<Record<string, number>>;
	/** Hard capacity per resource: name -> max units. Missing = unbounded. */
	readonly capacities: Readonly<Record<string, number>>;
	/** Free admission slots (concurrency budget). */
	readonly slots: number;
	/** Density epsilon guarding division-by-zero. Default 1e-6. */
	readonly epsilon?: number;
	/** Optional weight per resource in the density denominator. Default 1. */
	readonly resourceWeights?: Readonly<Record<string, number>>;
	/**
	 * Semantic-conflict predicate. Return true when the candidate may not run
	 * concurrently with an already-admitted node. Defaults to no conflicts.
	 */
	readonly conflicts?: (candidate: EcrafCandidate, running: EcrafCandidate) => boolean;
}

export interface EcrafAdmissionPlan {
	/** Source indices admitted, in the order they should be launched. */
	readonly admit: readonly number[];
	/** Source indices deferred this pass (capacity or conflict), in source order. */
	readonly deferred: readonly number[];
}

/**
 * Numeric contract for one admission pass (audit §5.3): every resource
 * demand, running usage, and capacity is a finite non-negative number; the
 * slot budget is a non-negative integer; epsilon is finite and positive;
 * ranking weights are finite and non-negative; candidate source indices and
 * ready sequences are unique, finite integers. Violating these invariants
 * silently poisons the plan — NaN makes every capacity check pass, negative
 * demand manufactures capacity, a fractional slot admits ⌈slots⌉ nodes, and
 * duplicate source indices make the admit list ambiguous — so malformed input
 * is rejected up front rather than coerced into "unbounded".
 */
function assertFiniteNonNegative(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${label} must be a finite non-negative number, got ${String(value)}`);
	}
}

function assertInputContract(options: EcrafAdmissionsOptions): void {
	const { candidates, runningUsage, capacities, slots, epsilon = 1e-6, resourceWeights = {} } = options;

	if (!Number.isInteger(slots) || slots < 0) {
		throw new RangeError(`slots must be a non-negative integer, got ${String(slots)}`);
	}
	if (!Number.isFinite(epsilon) || epsilon <= 0) {
		throw new RangeError(`epsilon must be a finite positive number, got ${String(epsilon)}`);
	}

	const seenSourceIndices = new Set<number>();
	const seenReadySeqs = new Set<number>();
	for (const [position, node] of candidates.entries()) {
		if (!Number.isInteger(node.sourceIndex) || node.sourceIndex < 0) {
			throw new RangeError(
				`candidates[${position}].sourceIndex must be a non-negative integer, got ${String(node.sourceIndex)}`,
			);
		}
		if (seenSourceIndices.has(node.sourceIndex)) {
			throw new RangeError(
				`duplicate candidates[].sourceIndex ${node.sourceIndex} — admit results must be unique per node`,
			);
		}
		seenSourceIndices.add(node.sourceIndex);
		if (!Number.isInteger(node.readySeq) || node.readySeq < 0) {
			throw new RangeError(
				`candidates[${position}].readySeq must be a non-negative integer, got ${String(node.readySeq)}`,
			);
		}
		if (seenReadySeqs.has(node.readySeq)) {
			throw new RangeError(`duplicate candidates[].readySeq ${node.readySeq} — ready ordering must be unambiguous`);
		}
		seenReadySeqs.add(node.readySeq);
		assertFiniteNonNegative(node.priority, `candidates[${position}].priority`);
		for (const [name, demand] of Object.entries(node.resources)) {
			assertFiniteNonNegative(demand, `candidates[${position}].resources.${name}`);
		}
	}

	for (const [name, value] of Object.entries(runningUsage)) {
		assertFiniteNonNegative(value, `runningUsage.${name}`);
	}
	for (const [name, value] of Object.entries(capacities)) {
		assertFiniteNonNegative(value, `capacities.${name}`);
	}
	for (const [name, value] of Object.entries(resourceWeights)) {
		assertFiniteNonNegative(value, `resourceWeights.${name}`);
	}
}

function resourceCost(node: EcrafCandidate, weights: Readonly<Record<string, number>>): number {
	let cost = 0;
	for (const name of Object.keys(node.resources)) {
		const weight = weights[name] ?? 1;
		cost += weight * (node.resources[name] ?? 0);
	}
	return cost;
}

function density(node: EcrafCandidate, weights: Readonly<Record<string, number>>, epsilon: number): number {
	const denominator = epsilon + resourceCost(node, weights);
	assertFiniteNonNegative(denominator, `candidate ${node.sourceIndex} density denominator`);
	const score = node.priority / denominator;
	assertFiniteNonNegative(score, `candidate ${node.sourceIndex} density`);
	return score;
}

function fits(node: EcrafCandidate, used: Map<string, number>, capacities: Readonly<Record<string, number>>): boolean {
	for (const name of Object.keys(node.resources)) {
		const capacity = capacities[name];
		if (capacity === undefined) continue; // unbounded resource
		const needed = node.resources[name] ?? 0;
		const running = used.get(name) ?? 0;
		if (running + needed > capacity) return false;
	}
	return true;
}

function reserve(node: EcrafCandidate, used: Map<string, number>): void {
	for (const name of Object.keys(node.resources)) {
		const total = (used.get(name) ?? 0) + (node.resources[name] ?? 0);
		assertFiniteNonNegative(total, `candidate ${node.sourceIndex} reserved usage.${name}`);
		used.set(name, total);
	}
}

/**
 * Greedy admission pass. Deterministic: identical inputs always produce the
 * identical plan. `admit` is ordered by launch preference (density, then
 * readySeq, then sourceIndex); `deferred` preserves source order.
 */
export function planEcrafAdmissions(options: EcrafAdmissionsOptions): EcrafAdmissionPlan {
	assertInputContract(options);
	const { candidates, runningUsage, capacities, slots, epsilon = 1e-6, resourceWeights = {}, conflicts } = options;

	// Seed running usage so newly admitted nodes consume from the same budget.
	const used = new Map<string, number>(Object.entries(runningUsage));

	// Score every candidate once, including singleton and zero-slot batches.
	const sorted = candidates
		.map((node) => ({ node, score: density(node, resourceWeights, epsilon) }))
		.sort(
			(a, b) => b.score - a.score || a.node.readySeq - b.node.readySeq || a.node.sourceIndex - b.node.sourceIndex,
		);

	const admit: number[] = [];
	const deferred: number[] = [];
	const admittedNodes: EcrafCandidate[] = [];

	for (const { node } of sorted) {
		if (admit.length >= slots) {
			deferred.push(node.sourceIndex);
			continue;
		}
		if (conflicts && admittedNodes.some((admitted) => conflicts(node, admitted))) {
			deferred.push(node.sourceIndex);
			continue;
		}
		if (!fits(node, used, capacities)) {
			deferred.push(node.sourceIndex);
			continue;
		}
		reserve(node, used);
		admittedNodes.push(node);
		admit.push(node.sourceIndex);
	}

	deferred.sort((a, b) => a - b);
	return { admit, deferred };
}
