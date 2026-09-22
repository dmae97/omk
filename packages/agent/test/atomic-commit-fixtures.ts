import type { ChangeAtom, ChangeRelation, CommitPlannerInput } from "../src/index.ts";

export function atom(id: string, overrides: Partial<ChangeAtom> = {}): ChangeAtom {
	return {
		id,
		repoId: "repo",
		sessionId: "s",
		worktreeId: "w",
		intentId: "intent",
		paths: [`packages/agent/${id}.ts`],
		packages: ["agent"],
		provenance: "verified",
		receiptId: `receipt:${id}`,
		closureComplete: true,
		settled: true,
		reviewRequired: false,
		baseBlobId: `blob:${id}`,
		patchDigest: `patch:${id}`,
		...overrides,
	};
}
export function relation(kind: ChangeRelation["kind"], from: string, to: string): ChangeRelation {
	return { kind, from, to, evidenceRef: `edge:${kind}:${from}:${to}` };
}
export function input(atoms: readonly ChangeAtom[], relations: readonly ChangeRelation[] = []): CommitPlannerInput {
	return {
		policyVersion: "acc-1",
		repoId: "repo",
		worktreeId: "w",
		sessionId: "s",
		baseCommit: "base",
		atoms,
		relations,
	};
}
