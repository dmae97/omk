import { describe, expect, it } from "vitest";
import { planAtomicCommits } from "../src/commit-planner.ts";
import { atom, input, relation } from "./atomic-commit-fixtures.ts";

const plan = (...args: Parameters<typeof input>) => planAtomicCommits(input(...args));

describe("atomic commit planner", () => {
	it("returns an empty plan without inventing work", () => {
		expect(plan([])).toMatchObject({ groups: [], validationOrder: [], unrelatedAtomIds: [] });
	});
	it("marks verified facts as a validation candidate, never commit approval", () => {
		expect(plan([atom("a")]).groups[0]).toMatchObject({ id: "g:a", status: "candidate" });
	});
	it("keeps hard source/test closure together across packages", () => {
		const p = plan([atom("a"), atom("b", { packages: ["coding-agent"] })], [relation("together", "a", "b")]);
		expect(p.groups).toHaveLength(1);
		expect(p.groups[0]).toMatchObject({ atomIds: ["a", "b"], packages: ["agent", "coding-agent"] });
	});
	it("orders a compatible API before its consumer without merging them", () => {
		expect(plan([atom("consumer"), atom("api")], [relation("depends", "consumer", "api")]).validationOrder).toEqual([
			"g:api",
			"g:consumer",
		]);
	});
	it("contracts dependency cycles including mixed together/depends edges", () => {
		const p = plan(
			[atom("a"), atom("b"), atom("c")],
			[relation("together", "a", "b"), relation("depends", "b", "c"), relation("depends", "c", "a")],
		);
		expect(p.groups).toHaveLength(1);
		expect(p.groups[0]?.atomIds).toEqual(["a", "b", "c"]);
	});
	it("does not merge independent edits just because their package matches", () => {
		expect(plan([atom("a"), atom("b", { intentId: "other" })]).groups).toHaveLength(2);
	});
	it("ignores unrelated foreign work", () => {
		expect(plan([atom("own"), atom("other", { sessionId: "other" })])).toMatchObject({
			unrelatedAtomIds: ["other"],
			validationOrder: ["g:own"],
		});
	});
	it("keeps a foreign prerequisite visible and blocks its dependent", () => {
		const p = plan([atom("a"), atom("b", { sessionId: "other" })], [relation("depends", "a", "b")]);
		expect(p.groups.every((g) => g.status === "blocked")).toBe(true);
		expect(p.groups.find((g) => g.id === "g:a")?.reasons).toContain("PREREQUISITE_NOT_ADMISSIBLE");
	});
	it.each([{ worktreeId: "other" }, { repoId: "other" }, { provenance: "foreign" as const }])(
		"blocks foreign closure %j",
		(override) => {
			expect(plan([atom("a"), atom("b", override)], [relation("together", "a", "b")]).groups[0]?.reasons).toContain(
				"FOREIGN_OWNERSHIP",
			);
		},
	);
	it.each([{ provenance: "unknown" as const }, { receiptId: null }, { settled: false }, { closureComplete: false }])(
		"fails closed on incomplete facts %j",
		(override) => {
			expect(plan([atom("a", override)]).groups[0]?.status).toBe("blocked");
		},
	);
	it("does not relax contradictory hard boundaries", () => {
		expect(
			plan([atom("a"), atom("b")], [relation("together", "a", "b"), relation("separate", "b", "a")]).groups[0]
				?.reasons,
		).toContain("CONTRADICTORY_BOUNDARIES");
	});
	it("requires review for a cross-intent SCC", () => {
		expect(plan([atom("a"), atom("b", { intentId: "other" })], [relation("together", "a", "b")])).toMatchObject({
			groups: [expect.objectContaining({ status: "review" })],
			validationOrder: [],
		});
	});
	it("requires review for a one-way cross-intent prerequisite too", () => {
		const p = plan([atom("a"), atom("b", { intentId: "other" })], [relation("depends", "b", "a")]);
		expect(p.groups.find((g) => g.id === "g:b")).toMatchObject({
			status: "review",
			reasons: ["CROSS_INTENT_CLOSURE"],
		});
		expect(p.validationOrder).toEqual(["g:a"]);
	});
	it("blocks dependents of a review-required lockfile change", () => {
		const p = plan([atom("lock", { reviewRequired: true }), atom("app")], [relation("depends", "app", "lock")]);
		expect(p.groups.find((g) => g.id === "g:lock")?.status).toBe("review");
		expect(p.groups.find((g) => g.id === "g:app")?.status).toBe("blocked");
	});
	it("preserves both rename paths and deduplicates a path within one atom", () => {
		expect(plan([atom("a", { paths: ["old.ts", "new.ts", "new.ts"] })]).groups[0]?.paths).toEqual([
			"new.ts",
			"old.ts",
		]);
	});
	it("normalizes permutations and duplicate symmetric relations", () => {
		const edge = relation("together", "a", "b");
		expect(plan([atom("a"), atom("b")], [edge])).toEqual(
			plan([atom("b"), atom("a")], [{ ...edge, from: "b", to: "a" }, edge]),
		);
	});
	it("does not mutate input and returns deeply frozen output", () => {
		const value = input([atom("b"), atom("a")], [relation("together", "b", "a")]);
		const before = structuredClone(value),
			p = planAtomicCommits(value);
		expect(value).toEqual(before);
		for (const part of [
			p,
			p.groups,
			p.validationOrder,
			p.unrelatedAtomIds,
			p.groups[0],
			p.groups[0]?.paths,
			p.groups[0]?.dependsOn,
			p.groups[0]?.reasons,
		])
			expect(Object.isFrozen(part)).toBe(true);
		expect(Reflect.set(p.groups, "0", {})).toBe(false);
	});
	it("binds base, policy, repository, receipt, patch and relation evidence", () => {
		const value = input([atom("a")]);
		const binding = planAtomicCommits(value).canonicalInput;
		for (const other of [
			{ ...value, baseCommit: "next" },
			{ ...value, policyVersion: "next" },
			{ ...value, repoId: "next" },
			input([atom("a", { patchDigest: "next" })]),
			input([atom("a", { receiptId: "next" })]),
			input([atom("a")], [relation("depends", "a", "a")]),
		])
			expect(planAtomicCommits(other).canonicalInput).not.toBe(binding);
	});
});
