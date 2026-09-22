import { expect, it } from "vitest";
import { planAtomicCommits } from "../src/commit-planner.ts";
import { atom, input, relation } from "./atomic-commit-fixtures.ts";

it.each(["settled", "closureComplete", "reviewRequired"])(
	"rejects non-boolean %s rather than trusting truthiness",
	(field) => {
		for (const value of ["false", "true", 1, 0, {}, [], null, undefined])
			expect(() => planAtomicCommits(input([Object.assign(atom("a"), { [field]: value })]))).toThrow(/boolean/);
	},
);

it.each([
	"../x",
	"/tmp/x",
	".git/index",
	"a/.GiT/config",
	"C:/x",
	"a\\b",
	"a//b",
	"a/./b",
	"a\nx",
	"a\u0000x",
	"a\u007fx",
	"a\ud800.ts",
])("rejects unrepresentable or out-of-scope path %j", (path) => {
	expect(() => planAtomicCommits(input([atom("a", { paths: [path] })]))).toThrow();
});

it("rejects malformed identities, collections, enums and evidence", () => {
	const good = input([atom("a")]);
	for (const value of [
		null,
		[],
		{},
		{ ...good, sessionId: 1 },
		{ ...good, baseCommit: " " },
		{ ...good, atoms: [atom("a"), atom("a")] },
		{ ...good, atoms: new Array(1) },
		{ ...good, relations: new Array(1) },
		{ ...good, atoms: [{ ...atom("a"), paths: [] }] },
		{ ...good, atoms: [{ ...atom("a"), paths: new Array(1) }] },
		{ ...good, atoms: [{ ...atom("a"), packages: [1] }] },
		{ ...good, atoms: [{ ...atom("a"), provenance: "trusted-by-model" }] },
		{ ...good, atoms: [{ ...atom("a"), repoId: undefined }] },
		{ ...good, atoms: [{ ...atom("a"), receiptId: "" }] },
		{ ...good, relations: [relation("depends", "a", "missing")] },
		{ ...good, relations: [{ ...relation("depends", "a", "a"), kind: "guess" }] },
		{ ...good, relations: [{ ...relation("depends", "a", "a"), evidenceRef: "" }] },
	])
		expect(() => planAtomicCommits(value)).toThrow(TypeError);
});

it("bounds work before expanding an oversized graph", () => {
	const good = input([]);
	expect(() => planAtomicCommits({ ...good, atoms: new Array(20_001) })).toThrow(/size/);
	expect(() => planAtomicCommits({ ...good, relations: new Array(100_001) })).toThrow(/size/);
	expect(() => planAtomicCommits(input([atom("a", { paths: ["a".repeat(4097)] })]))).toThrow();
});

it.each(["same.ts", "dir"])("does not adopt a foreign edit on overlapping path %s", (path) => {
	const otherPath = path === "dir" ? "dir/child.ts" : path;
	const p = planAtomicCommits(
		input(
			[
				atom("own", { paths: [path] }),
				atom("foreign", { sessionId: "other", paths: [otherPath] }),
				atom("dependent"),
			],
			[relation("depends", "dependent", "own")],
		),
	);
	expect(p.groups.find((g) => g.id === "g:own")?.reasons).toContain("AMBIGUOUS_FILE_OWNERSHIP");
	expect(p.groups.find((g) => g.id === "g:dependent")?.status).toBe("blocked");
	expect(p.unrelatedAtomIds).toEqual(["foreign"]);
});

it("does not pretend two same-file atoms are proven non-overlapping hunks", () => {
	const atoms = [atom("a", { paths: ["same"] }), atom("b", { paths: ["same"] })];
	for (const edges of [[], [relation("depends", "b", "a")], [relation("together", "a", "b")]])
		expect(planAtomicCommits(input(atoms, edges)).groups.every((g) => g.status === "blocked")).toBe(true);
});

it("does not conflate identical relative paths in different worktrees or repositories", () => {
	const p = planAtomicCommits(
		input([
			atom("own", { paths: ["same"] }),
			atom("tree", { paths: ["same"], worktreeId: "other" }),
			atom("repo", { paths: ["same"], repoId: "other" }),
		]),
	);
	expect(p.validationOrder).toEqual(["g:own"]);
	expect(p.unrelatedAtomIds).toEqual(["repo", "tree"]);
});

it("never infers a sensitive policy review exemption from a cross-intent grouping", () => {
	const p = planAtomicCommits(
		input([atom("a"), atom("b", { intentId: "other", reviewRequired: true })], [relation("together", "a", "b")]),
	);
	expect(p.groups[0]?.reasons).toEqual(["CROSS_INTENT_CLOSURE", "EXPLICIT_REVIEW_REQUIRED"]);
});
