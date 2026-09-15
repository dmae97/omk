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

function resourceCost(node: EcrafCandidate, weights: Readonly<Record<string, number>>): number {
	let cost = 0;
	for (const name of Object.keys(node.resources)) {
		const weight = weights[name] ?? 1;
		cost += weight * (node.resources[name] ?? 0);
	}
	return cost;
}

function density(node: EcrafCandidate, weights: Readonly<Record<string, number>>, epsilon: number): number {
	return node.priority / (epsilon + resourceCost(node, weights));
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
		used.set(name, (used.get(name) ?? 0) + (node.resources[name] ?? 0));
	}
}

/**
 * Greedy admission pass. Deterministic: identical inputs always produce the
 * identical plan. `admit` is ordered by launch preference (density, then
 * readySeq, then sourceIndex); `deferred` preserves source order.
 */
export function planEcrafAdmissions(options: EcrafAdmissionsOptions): EcrafAdmissionPlan {
	const { candidates, runningUsage, capacities, slots, epsilon = 1e-6, resourceWeights = {}, conflicts } = options;

	// Seed running usage so newly admitted nodes consume from the same budget.
	const used = new Map<string, number>(Object.entries(runningUsage));

	const sorted = [...candidates].sort(
		(a, b) =>
			density(b, resourceWeights, epsilon) - density(a, resourceWeights, epsilon) ||
			a.readySeq - b.readySeq ||
			a.sourceIndex - b.sourceIndex,
	);

	const admit: number[] = [];
	const deferred: number[] = [];
	const admittedNodes: EcrafCandidate[] = [];

	for (const node of sorted) {
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
