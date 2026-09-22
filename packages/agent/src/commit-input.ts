import type { ChangeAtom, ChangeRelation, CommitPlannerInput } from "./commit-types.ts";

const MAX_ATOMS = 20_000;
const MAX_RELATIONS = 100_000;
const MAX_PATHS = 100_000;
const MAX_PACKAGES = 100_000;
const MAX_TEXT_UNITS = 8 * 1024 * 1024;

interface InputBudget {
	paths: number;
	packages: number;
	textUnits: number;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid commit plan object");
	return value as Record<string, unknown>;
}
function text(value: unknown, budget: InputBudget, maxLength = 512): string {
	if (typeof value !== "string" || value.length > maxLength) throw new TypeError("Invalid commit plan text");
	budget.textUnits += value.length;
	if (budget.textUnits > MAX_TEXT_UNITS) throw new TypeError("Commit text limit exceeded");
	if (!value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("Invalid commit plan text");
	try {
		encodeURIComponent(value);
	} catch {
		throw new TypeError("Invalid commit plan Unicode");
	}
	return value;
}
function flag(value: unknown): boolean {
	if (typeof value !== "boolean") throw new TypeError("Invalid commit plan boolean");
	return value;
}
function list(value: unknown, limit: number): readonly unknown[] {
	if (!Array.isArray(value) || value.length > limit) throw new TypeError("Invalid commit plan array or size");
	return value;
}
function path(value: unknown, budget: InputBudget): string {
	const result = text(value, budget, 4096);
	if (
		/[\\:]/u.test(result) ||
		result.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
	)
		throw new TypeError("Unsupported relative path");
	return result;
}
function atom(value: unknown, budget: InputBudget): ChangeAtom {
	const raw = record(value);
	const paths = list(raw.paths, 256);
	const packages = list(raw.packages, 256);
	budget.paths += paths.length;
	budget.packages += packages.length;
	if (budget.paths > MAX_PATHS) throw new TypeError("Commit path limit exceeded");
	if (budget.packages > MAX_PACKAGES) throw new TypeError("Commit package limit exceeded");
	if (!paths.length) throw new TypeError("Missing commit paths");
	const provenance = text(raw.provenance, budget);
	if (provenance !== "verified" && provenance !== "unknown" && provenance !== "foreign")
		throw new TypeError("Invalid commit provenance");
	return {
		id: text(raw.id, budget),
		repoId: text(raw.repoId, budget),
		sessionId: text(raw.sessionId, budget),
		worktreeId: text(raw.worktreeId, budget),
		intentId: text(raw.intentId, budget),
		paths: Array.from(paths, (entry) => path(entry, budget)),
		packages: Array.from(packages, (entry) => text(entry, budget)),
		provenance,
		receiptId: raw.receiptId === null ? null : text(raw.receiptId, budget),
		closureComplete: flag(raw.closureComplete),
		settled: flag(raw.settled),
		reviewRequired: flag(raw.reviewRequired),
		baseBlobId: text(raw.baseBlobId, budget),
		patchDigest: text(raw.patchDigest, budget),
	};
}

/** Validate shape, not authenticity. Only the host observer can establish these facts. */
export function parseCommitPlannerInput(value: unknown): CommitPlannerInput {
	const raw = record(value);
	const budget: InputBudget = { paths: 0, packages: 0, textUnits: 0 };
	const header = {
		policyVersion: text(raw.policyVersion, budget),
		repoId: text(raw.repoId, budget),
		worktreeId: text(raw.worktreeId, budget),
		sessionId: text(raw.sessionId, budget),
		baseCommit: text(raw.baseCommit, budget),
	};
	const atomValues = list(raw.atoms, MAX_ATOMS);
	const relationValues = list(raw.relations, MAX_RELATIONS);
	const atoms = Array.from(atomValues, (entry) => atom(entry, budget));
	const ids = new Set(atoms.map((entry) => entry.id));
	if (ids.size !== atoms.length) throw new TypeError("Duplicate commit atom ID");
	const relations = Array.from(relationValues, (value): ChangeRelation => {
		const edge = record(value);
		const kind = text(edge.kind, budget);
		if (kind !== "together" && kind !== "depends" && kind !== "separate")
			throw new TypeError("Invalid commit relation kind");
		const from = text(edge.from, budget),
			to = text(edge.to, budget);
		if (!ids.has(from) || !ids.has(to)) throw new TypeError("Unknown commit relation node");
		return { kind, from, to, evidenceRef: text(edge.evidenceRef, budget) };
	});
	return { ...header, atoms, relations };
}
