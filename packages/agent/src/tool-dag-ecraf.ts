/**
 * ECRAF — resource-aware ready queue admission planner.
 *
 * Given the current ready frontier, a free-slot count, and multi-dimensional
 * resource capacities, choose which ready nodes to admit next using the
 * deterministic greedy baseline the deep-research report prescribes (PR 8).
 *
 * legacy-v1: D_i = P_i / (epsilon + sum_r weight_r * a_ir)
 * normalized-v2: D_i = P_i / (epsilon + slotCost + sum_r weight_r * a_ir / s_r)
 * Normalization is opt-in, not a live scheduler or a measured improvement.
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
	/** Omitted: legacy-v1, or normalized-v2 when referenceScales is supplied. */
	readonly algorithmVersion?: "legacy-v1" | "normalized-v2";
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
	 * Opt-in dimensionless normalization (audit §13.2): resource name -> positive
	 * reference scale s_r. When provided, the density denominator uses unitless
	 * demands a_ir/s_r, making ranking invariant to per-resource unit changes
	 * (a'_ir = c_r·a_ir with s'_ir = c_r·s_r preserves the mathematical ratio).
	 * In normalized-v2, omitted entries use positive total capacities, never
	 * remaining headroom. Positive unbounded demands require explicit scales.
	 * Zero capacity is a feasibility gate, not a scale. All supplied scales must
	 * be finite and positive. Supplying this map without a version opts into v2.
	 */
	readonly referenceScales?: Readonly<Record<string, number>>;
	/** Finite positive slot term λ_slot in normalized-v2. Default 1; invalid in v1. */
	readonly slotCost?: number;
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
	const {
		candidates,
		runningUsage,
		capacities,
		slots,
		epsilon = 1e-6,
		resourceWeights = {},
		referenceScales,
		slotCost = 1,
	} = options;

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
	if (referenceScales !== undefined) {
		if (!Number.isFinite(slotCost) || slotCost <= 0) {
			throw new RangeError(`slotCost must be a finite positive number, got ${String(slotCost)}`);
		}
		for (const [name, scale] of Object.entries(referenceScales)) {
			if (!Number.isFinite(scale) || scale <= 0) {
				throw new RangeError(`referenceScales.${name} must be a finite positive number, got ${String(scale)}`);
			}
		}
		for (const [position, node] of candidates.entries()) {
			for (const [name, demand] of Object.entries(node.resources)) {
				if (demand > 0 && capacities[name] !== 0 && referenceScales[name] === undefined) {
					throw new RangeError(
						`referenceScales.${name} is required for a nonzero ${name} demand (candidates[${position}])`,
					);
				}
			}
		}
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

function density(
	node: EcrafCandidate,
	weights: Readonly<Record<string, number>>,
	epsilon: number,
	referenceScales?: Readonly<Record<string, number>>,
	slotCost = 1,
): number {
	// Normalized mode divides each demand by its reference scale, so per-resource
	// unit changes that scale demand and reference together cancel exactly.
	const raw =
		referenceScales === undefined
			? resourceCost(node, weights)
			: [...Object.entries(node.resources)].reduce(
					(cost, [name, demand]) =>
						demand === 0 ? cost : cost + (weights[name] ?? 1) * (demand / referenceScales[name]),
					0,
				);
	const denominator = referenceScales === undefined ? epsilon + raw : epsilon + slotCost + raw;
	assertFiniteNonNegative(denominator, `candidate ${node.sourceIndex} density denominator`);
	const score = node.priority / denominator;
	assertFiniteNonNegative(score, `candidate ${node.sourceIndex} density`);
	return score;
}

function fits(
	node: EcrafCandidate,
	used: Map<string, number>,
	capacities: Readonly<Record<string, number>>,
	normalized: boolean,
): boolean {
	for (const name of Object.keys(node.resources)) {
		const capacity = capacities[name];
		if (capacity === undefined) continue; // unbounded resource
		const needed = node.resources[name] ?? 0;
		if (normalized && capacity === 0 && needed === 0) continue;
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
	const version = options.algorithmVersion ?? (options.referenceScales === undefined ? "legacy-v1" : "normalized-v2");
	if (version !== "legacy-v1" && version !== "normalized-v2") {
		throw new RangeError(`Unknown ECRAF algorithmVersion: ${String(version)}`);
	}
	if (version === "legacy-v1" && (options.referenceScales !== undefined || options.slotCost !== undefined)) {
		throw new RangeError("referenceScales and slotCost require normalized-v2");
	}
	if (version === "normalized-v2") {
		options = {
			...options,
			referenceScales: {
				...Object.fromEntries(Object.entries(options.capacities).filter(([, capacity]) => capacity > 0)),
				...options.referenceScales,
			},
		};
	}
	assertInputContract(options);
	const {
		candidates,
		runningUsage,
		capacities,
		slots,
		epsilon = 1e-6,
		resourceWeights = {},
		conflicts,
		referenceScales,
		slotCost = 1,
	} = options;

	// Seed running usage so newly admitted nodes consume from the same budget.
	const used = new Map<string, number>(Object.entries(runningUsage));

	// Zero-capacity infeasibility precedes scoring in v2. Validate all other
	// scores even for singleton and zero-slot batches, before any callbacks.
	const infeasible = new Set(
		version === "normalized-v2"
			? candidates.filter((node) =>
					Object.entries(node.resources).some(([name, demand]) => capacities[name] === 0 && demand > 0),
				)
			: [],
	);
	const sorted = candidates
		.filter((node) => !infeasible.has(node))
		.map((node) => ({ node, score: density(node, resourceWeights, epsilon, referenceScales, slotCost) }))
		.sort(
			(a, b) => b.score - a.score || a.node.readySeq - b.node.readySeq || a.node.sourceIndex - b.node.sourceIndex,
		);

	const admit: number[] = [];
	const deferred: number[] = [...infeasible].map((node) => node.sourceIndex);
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
		if (!fits(node, used, capacities, version === "normalized-v2")) {
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
