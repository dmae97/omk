/**
 * Bounded blocking explanations for a validated all/any claim DAG.
 * Shared subgraphs require alternative repair sets, not a local cheapest branch.
 * Exact antichains can grow exponentially; bounds fall back to a deterministic,
 * not-proven explanation. Set-operation cost also depends on output-set size.
 * A repair is an explanatory obligation, never permission to satisfy a claim.
 */
import { ClaimGraphError, topologicalClaimOrder } from "./claim-graph.ts";
import {
	type BlockingCutExplanation,
	CLAIM_GRAPH_SCHEMA_VERSION,
	type ClaimClosureEvaluation,
	type ClaimNode,
	type ClaimVerdict,
} from "./claim-types.ts";

const BLOCKING_VERDICTS: readonly ClaimVerdict[] = [
	"violated",
	"stale",
	"incomplete_scope",
	"insufficient_trust",
	"missing",
];
export const MAX_BLOCKING_CUT_CANDIDATES = 128;
const MAX_CUT_OPERATIONS = 65536;
class CutSearchLimit extends Error {}
type Cut = readonly string[];
type Family = readonly Cut[];
interface CutNode {
	readonly id: string;
	readonly rule: "all" | "any";
	readonly inputs: readonly string[];
	readonly closed: boolean;
	readonly local: boolean;
}
/** Search-owned mutable accounting, including work before a limit is reached. */
interface CutSearchBudget {
	operations: number;
}

export function isBlockingVerdict(verdict: ClaimVerdict): boolean {
	return BLOCKING_VERDICTS.includes(verdict);
}
function compareIds(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}
function compareCuts(left: Cut, right: Cut): number {
	if (left.length !== right.length) return left.length - right.length;
	for (let i = 0; i < left.length; i++) {
		const order = compareIds(left[i], right[i]);
		if (order) return order;
	}
	return 0;
}
function union(sets: readonly Cut[]): Cut {
	return [...new Set(sets.flat())].sort(compareIds);
}
function* unions(left: Family, right: Family): Generator<Cut> {
	for (const a of left) for (const b of right) yield union([a, b]);
}
function* alternatives(families: readonly Family[]): Generator<Cut> {
	for (const family of families) yield* family;
}

function cutNodes(
	claims: ReadonlyMap<string, ClaimNode>,
	evaluations: ReadonlyMap<string, ClaimClosureEvaluation>,
): CutNode[] {
	const ordered = topologicalClaimOrder(
		{ schemaVersion: CLAIM_GRAPH_SCHEMA_VERSION, claims: [...claims.values()] },
		claims,
	);
	return ordered.map((claim) => {
		const evaluation = evaluations.get(claim.claimId);
		if (
			!evaluation ||
			(!isBlockingVerdict(evaluation.verdict) &&
				evaluation.verdict !== "satisfied" &&
				evaluation.verdict !== "waived")
		) {
			throw new ClaimGraphError("invalid_input", "Blocking explanation requires a valid evaluation for every claim");
		}
		const inputs = claim.satisfaction.inputs.filter((id) => claims.get(id)?.severity === "required").sort(compareIds);
		const inferredLocal =
			(evaluation.verdict === "violated" && evaluation.observationIds.length > 0) ||
			(evaluation.verdict === "incomplete_scope" && claim.scopeSensitive === true);
		return {
			id: claim.claimId,
			rule: claim.satisfaction.rule,
			inputs,
			closed: !isBlockingVerdict(evaluation.verdict),
			local:
				inputs.length === 0 ||
				evaluation.blockingOrigin === "local" ||
				(evaluation.blockingOrigin === undefined && inferredLocal),
		};
	});
}
function reachableNodes(ordered: CutNode[], roots: readonly string[]): CutNode[] {
	const byId = new Map(ordered.map((node) => [node.id, node]));
	const reachable = new Set<string>();
	const pending = [...roots];
	while (pending.length) {
		const id = pending.pop();
		if (id === undefined || reachable.has(id)) continue;
		reachable.add(id);
		const node = byId.get(id);
		if (node && !node.closed) pending.push(...node.inputs);
	}
	return ordered.filter((node) => reachable.has(node.id));
}
function step(budget: CutSearchBudget): void {
	if (budget.operations >= MAX_CUT_OPERATIONS) throw new CutSearchLimit();
	budget.operations++;
}
function prune(candidates: Iterable<Cut>, budget: CutSearchBudget): Family {
	let kept: Cut[] = [];
	for (const candidate of candidates) {
		step(budget);
		const set = new Set(candidate);
		if (
			kept.some((other) => {
				step(budget);
				return other.every((id) => set.has(id));
			})
		)
			continue;
		kept = kept.filter((other) => {
			step(budget);
			const existing = new Set(other);
			return !candidate.every((id) => existing.has(id));
		});
		kept.push(candidate);
		if (kept.length > MAX_BLOCKING_CUT_CANDIDATES) throw new CutSearchLimit();
	}
	return kept.sort(compareCuts);
}
function combineAll(families: readonly Family[], budget: CutSearchBudget): Family {
	let result: Family = [[]];
	for (const family of families) result = prune(unions(result, family), budget);
	return result;
}
function exactCut(nodes: readonly CutNode[], roots: readonly string[], budget: CutSearchBudget): Cut {
	const families = new Map<string, Family>();
	for (const node of nodes) {
		if (node.closed) {
			families.set(node.id, [[]]);
			continue;
		}
		const children = node.inputs.map((id) => families.get(id) ?? []);
		let family: Family = [[]];
		if (children.length) {
			family = node.rule === "all" ? combineAll(children, budget) : prune(alternatives(children), budget);
		}
		if (node.local) family = prune(unions(family, [[node.id]]), budget);
		families.set(node.id, family);
	}
	return (
		combineAll(
			roots.map((id) => families.get(id) ?? []),
			budget,
		)[0] ?? []
	);
}
function greedyCut(nodes: readonly CutNode[], roots: readonly string[]): Cut {
	const cuts = new Map<string, Cut>();
	for (const node of nodes) {
		if (node.closed) {
			cuts.set(node.id, []);
			continue;
		}
		const children = node.inputs.map((id) => cuts.get(id) ?? []);
		const childCut = node.rule === "all" ? union(children) : ([...children].sort(compareCuts)[0] ?? []);
		cuts.set(node.id, node.local ? union([childCut, [node.id]]) : childCut);
	}
	return union(roots.map((id) => cuts.get(id) ?? []));
}

/** Prefer this API over the legacy array-only projection when optimality matters. */
export function explainBlockingCut(
	claims: ReadonlyMap<string, ClaimNode>,
	evaluations: ReadonlyMap<string, ClaimClosureEvaluation>,
	rootIds: readonly string[],
): BlockingCutExplanation {
	const roots = [...new Set(rootIds)].sort(compareIds);
	for (const id of roots) if (!claims.has(id)) throw new ClaimGraphError("unknown_input", "Unknown blocking root");
	const nodes = reachableNodes(cutNodes(claims, evaluations), roots);
	const budget: CutSearchBudget = { operations: 0 };
	let claimIds: Cut;
	let truncated = false;
	try {
		claimIds = exactCut(nodes, roots, budget);
	} catch (error) {
		if (!(error instanceof CutSearchLimit)) throw error;
		truncated = true;
		claimIds = greedyCut(nodes, roots);
	}
	const selected = new Set(claimIds);
	return Object.freeze({
		claimIds: Object.freeze([...claimIds]),
		algorithm: truncated ? "greedy" : "exact-antichain",
		optimality: truncated ? "not-proven" : "minimum",
		truncated,
		exploredStates: budget.operations,
		localClaimIds: Object.freeze(
			nodes
				.flatMap((node) => (node.local && node.inputs.length > 0 && selected.has(node.id) ? [node.id] : []))
				.sort(compareIds),
		),
	});
}

/** Compatibility name: on a bounded-search fallback this array is not guaranteed minimal. */
export function minimalBlockingCut(
	claims: ReadonlyMap<string, ClaimNode>,
	evaluations: ReadonlyMap<string, ClaimClosureEvaluation>,
	rootIds: readonly string[],
): Cut {
	return explainBlockingCut(claims, evaluations, rootIds).claimIds;
}
