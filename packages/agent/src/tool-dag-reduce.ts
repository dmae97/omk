/**
 * Reduce a source-ordered DAG to its unique transitive reduction.
 *
 * The input maps each target position to strictly earlier predecessors. Every
 * candidate is assumed to be a conflict edge; this function changes only
 * redundant synchronization, never reachability or the authoritative predicate.
 */
export function reduceDagDependencies(dependencies: readonly (readonly number[])[]): number[][] {
	const successors: number[][] = Array.from({ length: dependencies.length }, () => []);
	for (let target = 0; target < dependencies.length; target++) {
		const predecessors = dependencies[target];
		if (!Array.isArray(predecessors)) throw new RangeError("Invalid DAG predecessor row");
		let previous = -1;
		for (const predecessor of predecessors) {
			if (
				!Number.isSafeInteger(predecessor) ||
				predecessor < 0 ||
				predecessor >= target ||
				predecessor <= previous
			) {
				throw new RangeError("DAG predecessors must be unique, ascending, and earlier than their target");
			}
			previous = predecessor;
			successors[predecessor].push(target);
		}
	}

	const reachable = Array.from({ length: dependencies.length }, (): bigint => 0n);
	const reducedSuccessors: number[][] = Array.from({ length: dependencies.length }, () => []);
	for (let source = successors.length - 1; source >= 0; source--) {
		let closure = 0n;
		for (const target of successors[source]) {
			const bit = 1n << BigInt(target);
			const descendants = reachable[target];
			if ((closure & bit) === 0n) reducedSuccessors[source].push(target);
			closure |= bit | descendants;
		}
		reachable[source] = closure;
	}

	const reduced: number[][] = Array.from({ length: dependencies.length }, () => []);
	for (let source = 0; source < reducedSuccessors.length; source++) {
		for (const target of reducedSuccessors[source]) reduced[target].push(source);
	}
	return reduced;
}
