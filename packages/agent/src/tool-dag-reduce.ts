/** Reachability-preserving reduction; never changes the conflict predicate. */
export const DEFAULT_DAG_CLOSURE_BYTES = 16 * 1024 * 1024;

export interface DagReductionOptions {
	/** Budget for the closure bit matrix only, at most 16 MiB; zero selects exact traversal. */
	readonly maxClosureBytes?: number;
}

export interface DagReductionDiagnostics {
	readonly strategy: "already-reduced" | "bitset" | "traversal";
	readonly inputEdges: number;
	readonly outputEdges: number;
	readonly closureBytes: number;
	readonly wordUnions: number;
	readonly traversalVisits: number;
}

export interface DagReductionResult {
	readonly dependencies: number[][];
	readonly diagnostics: DagReductionDiagnostics;
}

/** Same signature and exact transitive-reduction contract as the pinned implementation. */
export function reduceDagDependencies(dependencies: readonly (readonly number[])[]): number[][] {
	return reduceDagDependenciesWithDiagnostics(dependencies).dependencies;
}

/**
 * Process incoming edges nearest predecessor first. A predecessor already in
 * the ancestor closure is redundant. Only retained edges require a closure
 * union. The triangular Uint32 matrix stores ancestors below each node, not
 * globally shifted BigInts. Large graphs use an exact iterative traversal;
 * memory pressure never returns a partial or merely approximate reduction.
 */
export function reduceDagDependenciesWithDiagnostics(
	dependencies: readonly (readonly number[])[],
	options: DagReductionOptions = {},
): DagReductionResult {
	const budget = options.maxClosureBytes ?? DEFAULT_DAG_CLOSURE_BYTES;
	if (!Number.isSafeInteger(budget) || budget < 0 || budget > DEFAULT_DAG_CLOSURE_BYTES) {
		throw new RangeError("DAG closure budget must be between zero and 16 MiB");
	}
	if (!Array.isArray(dependencies)) throw new RangeError("Invalid DAG predecessor graph");
	const n = dependencies.length;
	const outdegrees = new Uint32Array(n);
	let inputEdges = 0;
	let multiParent = false;
	let multiChild = false;
	for (let target = 0; target < n; target++) {
		const row = dependencies[target];
		if (!Array.isArray(row)) throw new RangeError("Invalid DAG predecessor row");
		let previous = -1;
		for (const predecessor of row) {
			if (
				!Number.isSafeInteger(predecessor) ||
				predecessor < 0 ||
				predecessor >= target ||
				predecessor <= previous
			) {
				throw new RangeError("DAG predecessors must be unique, ascending, and earlier than their target");
			}
			previous = predecessor;
			outdegrees[predecessor]++;
			multiChild ||= outdegrees[predecessor] > 1;
		}
		inputEdges += row.length;
		multiParent ||= row.length > 1;
	}
	const reduced: number[][] = Array.from({ length: n }, () => []);
	let outputEdges = 0;
	let closureBytes = 0;
	let wordUnions = 0;
	let traversalVisits = 0;
	let strategy: DagReductionDiagnostics["strategy"] = "already-reduced";
	if (!multiParent || !multiChild) {
		for (let i = 0; i < n; i++) reduced[i] = dependencies[i].slice();
		outputEdges = inputEdges;
	} else {
		const q = Math.floor((n - 1) / 32);
		const r = (n - 1) % 32;
		const words = 16 * q * (q + 1) + (q + 1) * r;
		let matrix: Uint32Array | undefined;
		if (Number.isSafeInteger(words) && words * 4 <= budget) {
			try {
				matrix = new Uint32Array(words);
			} catch (error) {
				if (!(error instanceof RangeError)) throw error;
			}
		}
		if (matrix !== undefined) {
			strategy = "bitset";
			closureBytes = matrix.byteLength;
			const offsets = new Uint32Array(n + 1);
			for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + Math.ceil(i / 32);
			for (let target = 0; target < n; target++) {
				const offset = offsets[target];
				const row = dependencies[target];
				for (let j = row.length - 1; j >= 0; j--) {
					const predecessor = row[j];
					const word = Math.floor(predecessor / 32);
					const bit = 1 << (predecessor % 32);
					if ((matrix[offset + word] & bit) !== 0) continue;
					reduced[target].push(predecessor);
					outputEdges++;
					matrix[offset + word] |= bit;
					// An empty ancestor row needs no union at all.
					const ancestors = dependencies[predecessor];
					const length = ancestors.length === 0 ? 0 : Math.floor(ancestors[ancestors.length - 1] / 32) + 1;
					for (let k = 0; k < length; k++) {
						matrix[offset + k] |= matrix[offsets[predecessor] + k];
						wordUnions++;
					}
				}
				reduced[target].reverse();
			}
		} else {
			strategy = "traversal";
			const marks = new Uint32Array(n);
			const stack = new Uint32Array(n);
			let epoch = 0;
			for (let target = 0; target < n; target++) {
				const row: readonly number[] = dependencies[target];
				if (row.length <= 1) {
					reduced[target] = row.slice();
					outputEdges += row.length;
					continue;
				}
				epoch = (epoch + 1) >>> 0;
				if (epoch === 0) {
					marks.fill(0);
					epoch = 1;
				}
				for (let j = row.length - 1; j >= 0; j--) {
					const predecessor = row[j];
					if (marks[predecessor] === epoch) continue;
					reduced[target].push(predecessor);
					outputEdges++;
					let top = 0;
					marks[predecessor] = epoch;
					stack[top++] = predecessor;
					while (top > 0) {
						const node = stack[--top];
						traversalVisits++;
						// Earlier rows have already been exactly reduced.
						for (const ancestor of reduced[node]) {
							if (marks[ancestor] === epoch) continue;
							marks[ancestor] = epoch;
							stack[top++] = ancestor;
						}
					}
				}
				reduced[target].reverse();
			}
		}
	}
	return {
		dependencies: reduced,
		diagnostics: Object.freeze({ strategy, inputEdges, outputEdges, closureBytes, wordUnions, traversalVisits }),
	};
}
