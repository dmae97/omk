import { type EcrafAdmissionsOptions, type EcrafCandidate, planEcrafAdmissions } from "./tool-dag-ecraf.ts";

function fitsExchange(
	node: EcrafCandidate,
	used: Map<string, number>,
	capacities: Readonly<Record<string, number>>,
): boolean {
	for (const name of Object.keys(node.resources)) {
		const capacity = capacities[name];
		if (capacity === undefined) continue;
		const needed = node.resources[name] ?? 0;
		if ((used.get(name) ?? 0) + needed > capacity) return false;
	}
	return true;
}

function reserveExchange(node: EcrafCandidate, used: Map<string, number>): void {
	for (const name of Object.keys(node.resources)) {
		used.set(name, (used.get(name) ?? 0) + (node.resources[name] ?? 0));
	}
}

/**
 * Offline challenger for the synthetic density gap. Does not replace
 * `planEcrafAdmissions`. A one-drop, two-add exchange is reported only when
 * it fits the same capacities and raises priority. Live scheduling stays greedy.
 */
export function challengeEcrafLocalExchange(options: EcrafAdmissionsOptions): {
	readonly baseline: readonly number[];
	readonly challenger: readonly number[] | null;
	readonly baselinePriority: number;
	readonly challengerPriority: number;
} {
	const baseline = planEcrafAdmissions(options);
	const byIndex = new Map(options.candidates.map((node) => [node.sourceIndex, node]));
	const priorityOf = (indexes: readonly number[]) =>
		indexes.reduce((sum, index) => sum + (byIndex.get(index)?.priority ?? 0), 0);
	const baselinePriority = priorityOf(baseline.admit);
	let best = baseline.admit;
	let bestPriority = baselinePriority;
	for (const dropped of baseline.admit) {
		const kept = baseline.admit.filter((index) => index !== dropped);
		const additions = baseline.deferred.filter((index) => !kept.includes(index));
		for (let left = 0; left < additions.length; left++) {
			for (let right = left + 1; right < additions.length; right++) {
				const candidate = [...kept, additions[left], additions[right]].filter(
					(index): index is number => index !== undefined,
				);
				if (candidate.length > options.slots) continue;
				const nodes = candidate.map((index) => byIndex.get(index)).filter((node) => node !== undefined);
				if (nodes.length !== candidate.length) continue;
				if (
					options.conflicts &&
					nodes.some((node, index) => nodes.slice(index + 1).some((other) => options.conflicts?.(node, other)))
				)
					continue;
				const used = new Map<string, number>(Object.entries(options.runningUsage));
				const fitsAll = nodes.every((node) => {
					if (!fitsExchange(node, used, options.capacities)) return false;
					reserveExchange(node, used);
					return true;
				});
				if (!fitsAll) continue;
				const priority = priorityOf(candidate);
				if (priority > bestPriority) {
					best = candidate;
					bestPriority = priority;
				}
			}
		}
	}
	return {
		baseline: baseline.admit,
		challenger: bestPriority > baselinePriority ? best : null,
		baselinePriority,
		challengerPriority: bestPriority,
	};
}
