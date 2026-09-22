import { ambiguousAtoms } from "./commit-conflicts.ts";
import { stronglyConnected, topologicalOrder } from "./commit-graph.ts";
import { parseCommitPlannerInput } from "./commit-input.ts";
import {
	type ChangeAtom,
	type ChangeRelation,
	type CommitGroup,
	type CommitPlan,
	compareIds,
	sortedUnique,
} from "./commit-types.ts";

function required<K, V>(map: ReadonlyMap<K, V>, key: K): V {
	const value = map.get(key);
	if (value === undefined) throw new Error("Invalid normalized commit graph");
	return value;
}

/** Read-only planning. No Git, filesystem, clock, receipt authentication or commit authorization. */
export function planAtomicCommits(value: unknown): CommitPlan {
	const input = parseCommitPlannerInput(value);
	const atoms = [...input.atoms].sort((a, b) => compareIds(a.id, b.id));
	const byId = new Map(atoms.map((atom) => [atom.id, atom]));
	const relationMap = new Map<string, ChangeRelation>();
	for (const relation of input.relations) {
		const normalized =
			relation.kind !== "depends" && compareIds(relation.from, relation.to) > 0
				? { ...relation, from: relation.to, to: relation.from }
				: relation;
		relationMap.set(
			JSON.stringify([normalized.kind, normalized.from, normalized.to, normalized.evidenceRef]),
			normalized,
		);
	}
	const relations = [...relationMap].sort(([a], [b]) => compareIds(a, b)).map(([, edge]) => edge);
	const adjacency = new Map(atoms.map((atom) => [atom.id, [] as string[]]));
	for (const edge of relations) {
		if (edge.kind === "separate") continue;
		required(adjacency, edge.from).push(edge.to);
		if (edge.kind === "together") required(adjacency, edge.to).push(edge.from);
	}
	for (const [id, edges] of adjacency) adjacency.set(id, sortedUnique(edges));
	const components = stronglyConnected(
		atoms.map((atom) => atom.id),
		adjacency,
	);
	const groupOf = new Map<string, string>();
	const members = new Map<string, readonly string[]>();
	for (const ids of components) {
		const id = `g:${ids[0]}`;
		members.set(id, ids);
		for (const atom of ids) groupOf.set(atom, id);
	}
	const prerequisites = new Map([...members.keys()].map((id) => [id, [] as string[]]));
	const conflicts = new Set<string>();
	for (const edge of relations) {
		const from = required(groupOf, edge.from),
			to = required(groupOf, edge.to);
		if (edge.kind === "separate" && from === to) conflicts.add(from);
		if (edge.kind === "depends" && from !== to) required(prerequisites, from).push(to);
	}
	for (const [id, deps] of prerequisites) prerequisites.set(id, sortedUnique(deps));
	const order = topologicalOrder([...members.keys()], prerequisites);
	const local = (atom: ChangeAtom) =>
		atom.repoId === input.repoId && atom.sessionId === input.sessionId && atom.worktreeId === input.worktreeId;
	const selected = new Set<string>();
	const stack = atoms.filter(local).map((atom) => required(groupOf, atom.id));
	while (stack.length) {
		const id = stack.pop();
		if (id === undefined || selected.has(id)) continue;
		selected.add(id);
		for (const dep of required(prerequisites, id)) stack.push(dep);
	}
	const ambiguous = ambiguousAtoms(atoms);
	const groups = new Map<string, CommitGroup>();
	for (const id of order.filter((id) => selected.has(id))) {
		const atomIds = required(members, id);
		const groupAtoms = atomIds.map((id) => required(byId, id));
		const reasons = new Set<string>();
		for (const atom of groupAtoms) {
			if (!local(atom) || atom.provenance === "foreign") reasons.add("FOREIGN_OWNERSHIP");
			if (atom.provenance !== "verified" || !atom.receiptId) reasons.add("PROVENANCE_UNVERIFIED");
			if (!atom.settled) reasons.add("WRITER_UNSETTLED");
			if (!atom.closureComplete) reasons.add("DEPENDENCY_CLOSURE_INCOMPLETE");
			if (ambiguous.has(atom.id)) reasons.add("AMBIGUOUS_FILE_OWNERSHIP");
		}
		if (conflicts.has(id)) reasons.add("CONTRADICTORY_BOUNDARIES");
		const dependsOn = required(prerequisites, id);
		for (const dep of dependsOn)
			if (required(groups, dep).status !== "candidate") reasons.add("PREREQUISITE_NOT_ADMISSIBLE");
		const intentIds = sortedUnique(groupAtoms.map((atom) => atom.intentId));
		const intents = new Set(intentIds);
		const crossIntent =
			intentIds.length > 1 ||
			dependsOn.some((dep) => required(groups, dep).intentIds.some((intent) => !intents.has(intent)));
		let status: CommitGroup["status"] = reasons.size ? "blocked" : "candidate";
		if (status === "candidate" && (crossIntent || groupAtoms.some((atom) => atom.reviewRequired))) {
			status = "review";
			if (crossIntent) reasons.add("CROSS_INTENT_CLOSURE");
			if (groupAtoms.some((atom) => atom.reviewRequired)) reasons.add("EXPLICIT_REVIEW_REQUIRED");
		}
		groups.set(
			id,
			Object.freeze({
				id,
				atomIds: Object.freeze([...atomIds]),
				paths: Object.freeze(sortedUnique(groupAtoms.flatMap((atom) => atom.paths))),
				packages: Object.freeze(sortedUnique(groupAtoms.flatMap((atom) => atom.packages))),
				intentIds: Object.freeze(intentIds),
				dependsOn: Object.freeze([...dependsOn]),
				status,
				reasons: Object.freeze([...reasons].sort(compareIds)),
			}),
		);
	}
	const result = [...groups.values()];
	const canonicalInput = JSON.stringify({
		schemaVersion: "omk.atomic-commit-plan.v1",
		policyVersion: input.policyVersion,
		repoId: input.repoId,
		worktreeId: input.worktreeId,
		sessionId: input.sessionId,
		baseCommit: input.baseCommit,
		atoms: atoms.map((atom) => ({ ...atom, paths: sortedUnique(atom.paths), packages: sortedUnique(atom.packages) })),
		relations: relations.map((edge) => ({
			kind: edge.kind,
			from: edge.from,
			to: edge.to,
			evidenceRef: edge.evidenceRef,
		})),
	});
	return Object.freeze({
		canonicalInput,
		groups: Object.freeze(result),
		validationOrder: Object.freeze(result.filter((group) => group.status === "candidate").map((group) => group.id)),
		unrelatedAtomIds: Object.freeze(
			atoms.filter((atom) => !selected.has(required(groupOf, atom.id))).map((atom) => atom.id),
		),
	});
}
