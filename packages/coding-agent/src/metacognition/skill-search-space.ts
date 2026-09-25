// Search strategies extracted from ./skills.ts (Spec 007, S-R9).
//
// planSkills owns input validation and answer shaping; this module owns the
// two search algorithms that pick a skill set over validated input:
//   - runExactSearch  — branch-and-bound enumeration for small catalogs;
//   - runGreedySearch — marginal-density greedy fill plus bounded
//     improvement passes (singleton dominance, eviction-refill, dominance
//     prune) for large ones.
// Both share the same deterministic total order (betterValue) and the same
// SkillSearchSpace view so their results stay directly comparable.

import { lexical } from "./validation.ts";

/** Structural minimum this module needs — avoids importing ./skills.ts. */
export interface SearchNeed {
	readonly capability: string;
	readonly weight: number;
	readonly required: boolean;
}

/** Structural minimum this module needs from a validated skill. */
export interface SearchSkillInfo {
	readonly capabilities: readonly string[];
	readonly dependencies: readonly string[];
}

export interface SearchValue {
	readonly required: number;
	readonly optional: number;
	readonly cost: number;
	readonly ids: string[];
}

/**
 * Deterministic total order over plans: required coverage first, then
 * optional coverage, then cheaper cost, then fewer skills, then lexical ids.
 */
export function betterValue(left: SearchValue, right: SearchValue): boolean {
	if (left.required !== right.required) return left.required > right.required;
	if (left.optional !== right.optional) return left.optional > right.optional;
	if (left.cost !== right.cost) return left.cost < right.cost;
	if (left.ids.length !== right.ids.length) return left.ids.length < right.ids.length;
	return lexical(left.ids.join("\0"), right.ids.join("\0")) < 0;
}

/** Coverage-only value used as an optimistic ceiling, never as a plan. */
export function coverageValue(
	needs: readonly SearchNeed[],
	covered: ReadonlySet<string>,
): { required: number; optional: number } {
	let required = 0;
	let optional = 0;
	for (const need of needs) {
		if (!covered.has(need.capability)) continue;
		if (need.required) required += need.weight;
		else optional += need.weight;
	}
	return { required, optional };
}

/** Everything the two search strategies need from the validated input. */
export interface SkillSearchSpace {
	readonly base: ReadonlySet<string>;
	readonly candidates: readonly (readonly [string, Set<string>])[];
	readonly closures: ReadonlyMap<string, Set<string>>;
	readonly feasible: (ids: ReadonlySet<string>) => boolean;
	readonly needs: readonly SearchNeed[];
	readonly skillOf: (id: string) => SearchSkillInfo;
	readonly value: (ids: ReadonlySet<string>) => SearchValue;
}

/**
 * Exact enumeration over candidate closures. Suffix unions let the DFS price
 * the best subtree outcome before entering it: if every remaining closure
 * cannot raise coverage past the incumbent, the whole branch is dead
 * regardless of cost or size. Ties stay alive — at coverage parity a
 * descendant can still win on cost or size.
 */
export function runExactSearch(space: SkillSearchSpace, seed: Set<string>): Set<string> {
	const { candidates, feasible, needs, skillOf, value } = space;
	let best = seed;
	const suffixCapabilities: Set<string>[] = candidates.map(() => new Set());
	for (let index = candidates.length - 1; index >= 0; index--) {
		suffixCapabilities[index] = new Set(suffixCapabilities[index + 1]);
		for (const id of candidates[index][1]) {
			for (const capability of skillOf(id).capabilities) {
				suffixCapabilities[index].add(capability);
			}
		}
	}
	const visit = (position: number, current: Set<string>, coverage: ReadonlySet<string>): void => {
		if (!feasible(current)) return;
		if (betterValue(value(current), value(best))) best = current;
		const candidate = candidates[position];
		if (!candidate) return;
		const incumbent = value(best);
		const optimistic = new Set([...coverage, ...suffixCapabilities[position]]);
		const ceiling = coverageValue(needs, optimistic);
		if (ceiling.required < incumbent.required) return;
		if (ceiling.required === incumbent.required && ceiling.optional < incumbent.optional) return;
		const joined = new Set([...current, ...candidate[1]]);
		const joinedCoverage = new Set(coverage);
		for (const id of candidate[1]) {
			for (const capability of skillOf(id).capabilities) {
				joinedCoverage.add(capability);
			}
		}
		visit(position + 1, joined, joinedCoverage);
		visit(position + 1, current, coverage);
	};
	const seedCoverage = new Set([...seed].flatMap((id) => skillOf(id).capabilities));
	visit(0, seed, seedCoverage);
	return best;
}

/**
 * Marginal-density greedy fill, shared by the primary fill and every
 * eviction-refill restart so both rank candidates identically.
 */
function greedyFill(space: SkillSearchSpace, seed: Set<string>): Set<string> {
	const { candidates, feasible, value } = space;
	let current = seed;
	while (true) {
		const previous = value(current);
		let winner: Set<string> | undefined;
		let rank: readonly [number, number, string] = [-1, -1, ""];
		for (const [id, set] of candidates) {
			if (current.has(id)) continue;
			const joined = new Set([...current, ...set]);
			if (!feasible(joined)) continue;
			const after = value(joined);
			const requiredGain = after.required - previous.required;
			const optionalGain = after.optional - previous.optional;
			if (requiredGain <= 0 && optionalGain <= 0) continue;
			const cost = Math.max(1, after.cost - previous.cost);
			const proposal = [requiredGain / cost, optionalGain / cost, id] as const;
			if (
				!winner ||
				proposal[0] > rank[0] ||
				(proposal[0] === rank[0] &&
					(proposal[1] > rank[1] || (proposal[1] === rank[1] && lexical(proposal[2], rank[2]) < 0)))
			) {
				winner = joined;
				rank = proposal;
			}
		}
		if (!winner) break;
		current = winner;
	}
	return current;
}

/**
 * Large-catalog search: greedy fill, then three bounded improvement passes.
 *  - singleton dominance: a lone closure that covers the incumbent wins;
 *  - eviction-refill: remove one selected closure and re-fill greedily, undoing
 *    a wrong first pick without becoming exhaustive (|best| × |candidates|);
 *  - dominance prune: a selected skill that adds no coverage only costs tokens.
 */
export function runGreedySearch(space: SkillSearchSpace): Set<string> {
	const { base, candidates, closures, feasible, skillOf, value } = space;
	let best = greedyFill(space, new Set(base));
	for (const [, set] of candidates) {
		const joined = new Set([...base, ...set]);
		if (feasible(joined) && betterValue(value(joined), value(best))) best = joined;
	}
	const incumbentIds = [...best];
	for (const evictId of incumbentIds) {
		const eviction = closures.get(evictId) ?? new Set([evictId]);
		const seed = new Set([...base]);
		let orphan = false;
		for (const id of incumbentIds) {
			if (eviction.has(id)) continue;
			if (skillOf(id).dependencies.some((dependency) => eviction.has(dependency))) {
				orphan = true;
				break;
			}
			seed.add(id);
		}
		if (orphan || !feasible(seed)) continue;
		const refill = greedyFill(space, seed);
		if (betterValue(value(refill), value(best))) best = refill;
	}
	let pruned = true;
	while (pruned) {
		pruned = false;
		for (const id of [...best]) {
			const without = new Set(best);
			without.delete(id);
			if (feasible(without) && betterValue(value(without), value(best))) {
				best = without;
				pruned = true;
			}
		}
	}
	return best;
}
