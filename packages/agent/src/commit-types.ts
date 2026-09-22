/** Facts supplied by a trusted edit-receipt adapter, never inferred from a dirty file or model claim. */
export interface ChangeAtom {
	readonly id: string;
	readonly repoId: string;
	readonly sessionId: string;
	readonly worktreeId: string;
	readonly intentId: string;
	/** File-level v1 atoms. Renames name both the old and new path. */
	readonly paths: readonly string[];
	readonly packages: readonly string[];
	readonly provenance: "verified" | "unknown" | "foreign";
	readonly receiptId: string | null;
	readonly closureComplete: boolean;
	readonly settled: boolean;
	readonly reviewRequired: boolean;
	readonly baseBlobId: string;
	readonly patchDigest: string;
}

/** depends points from the dependent to its prerequisite; the other relations are symmetric. */
export interface ChangeRelation {
	readonly kind: "together" | "depends" | "separate";
	readonly from: string;
	readonly to: string;
	readonly evidenceRef: string;
}

export interface CommitPlannerInput {
	readonly policyVersion: string;
	readonly repoId: string;
	readonly worktreeId: string;
	readonly sessionId: string;
	readonly baseCommit: string;
	readonly atoms: readonly ChangeAtom[];
	readonly relations: readonly ChangeRelation[];
}

export interface CommitGroup {
	readonly id: string;
	readonly atomIds: readonly string[];
	readonly paths: readonly string[];
	readonly packages: readonly string[];
	readonly intentIds: readonly string[];
	readonly dependsOn: readonly string[];
	/** candidate only schedules snapshot validation; it never authorizes a commit. */
	readonly status: "candidate" | "review" | "blocked";
	readonly reasons: readonly string[];
}

export interface CommitPlan {
	/** Canonical data binding, not a signed ownership or validation receipt. */
	readonly canonicalInput: string;
	readonly groups: readonly CommitGroup[];
	readonly validationOrder: readonly string[];
	readonly unrelatedAtomIds: readonly string[];
}

export function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
export function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareIds);
}
