import { describe, expect, it } from "vitest";
import {
	CLAIM_GRAPH_SCHEMA_VERSION,
	type ClaimNode,
	evaluateProofClosure,
	type ProofClosureInput,
} from "../src/index.ts";

function node(claimId: string, inputs: string[] = [], rule: "all" | "any" = "all"): ClaimNode {
	return {
		claimId,
		kind: "requirement",
		statement: claimId,
		severity: "required",
		satisfaction: { inputs, rule },
		trustFloor: "deterministic_validator",
		invalidationKeys: [],
	};
}
function input(claims: ClaimNode[]): ProofClosureInput {
	return {
		graph: { schemaVersion: CLAIM_GRAPH_SCHEMA_VERSION, claims },
		observations: [],
		witnessIndependence: "explicit-groups",
		waivers: [],
		sourceRoot: "fixture",
		environmentDigest: "fixture",
		workspaceCompleteness: "complete",
		unresolvedEffectIds: [],
		now: "2026-09-09T00:00:00.000Z",
	};
}

describe("review F09: witness independence", () => {
	it("does not treat new observation IDs as proof of independent sources", () => {
		const request = input([{ ...node("root"), requiredWitnesses: 2 }]);
		const observations = ["copy-1", "copy-2"].map((observationId) => ({
			observationId,
			claimIds: ["root"],
			polarity: "supports" as const,
			source: "deterministic_validator" as const,
			sourceRoot: "fixture",
			environmentDigest: "fixture",
		}));
		expect(evaluateProofClosure({ ...request, observations }).verdict).toBe("inconclusive");
		expect(evaluateProofClosure({ ...request, observations, witnessIndependence: undefined })).toMatchObject({
			verdict: "verified",
			witnessIndependence: "legacy-observation-id",
		});
		const named = observations.map((observation, index) => ({
			...observation,
			independenceGroup: `validator-${index}`,
		}));
		expect(evaluateProofClosure({ ...request, observations: named }).verdict).toBe("verified");
	});
	it("does not let an unattributed observation supplement one named group", () => {
		const request = input([{ ...node("root"), requiredWitnesses: 2 }]);
		const base = {
			claimIds: ["root"],
			polarity: "supports" as const,
			source: "deterministic_validator" as const,
			sourceRoot: "fixture",
			environmentDigest: "fixture",
		};
		const observations = [
			{ ...base, observationId: "a", independenceGroup: "validator" },
			{ ...base, observationId: "b" },
		];
		expect(evaluateProofClosure({ ...request, observations }).verdict).toBe("inconclusive");
	});
});

describe("review F01/F02: shared-DAG blocking explanation", () => {
	it("does not spend the cut search budget on unrelated advisory roots", () => {
		const claims: ClaimNode[] = [node("required")];
		for (let i = 0; i < 10; i++)
			claims.push(node(`a${i}`), node(`b${i}`), node(`pair${i}`, [`a${i}`, `b${i}`], "any"));
		claims.push({
			...node(
				"info",
				Array.from({ length: 10 }, (_, i) => `pair${i}`),
			),
			severity: "advisory",
		});
		const result = evaluateProofClosure(input(claims));
		expect(result.minimalBlockingCut).toEqual(["required"]);
		expect(result.blockingCut?.optimality).toBe("minimum");
	});
	it("marks a bounded-search fallback instead of claiming a minimum", () => {
		const claims: ClaimNode[] = [];
		for (let i = 0; i < 10; i++)
			claims.push(node(`a${i}`), node(`b${i}`), node(`pair${i}`, [`a${i}`, `b${i}`], "any"));
		claims.push(
			node(
				"root",
				Array.from({ length: 10 }, (_, i) => `pair${i}`),
			),
		);
		const result = evaluateProofClosure(input(claims));
		expect(result.blockingCut).toMatchObject({ algorithm: "greedy", optimality: "not-proven", truncated: true });
		expect(result.minimalBlockingCut).toHaveLength(10);
		for (let i = 0; i < 10; i++)
			expect(result.minimalBlockingCut.some((id) => id === `a${i}` || id === `b${i}`)).toBe(true);
	});
	it("keeps exact explanations deterministic under graph and child permutation", () => {
		const claims = [
			node("a"),
			node("b"),
			node("z"),
			node("left", ["a", "z"], "any"),
			node("right", ["b", "z"], "any"),
			node("root", ["left", "right"]),
		];
		const a = evaluateProofClosure(input(claims));
		const b = evaluateProofClosure(
			input(
				[...claims].reverse().map((claim) => ({
					...claim,
					satisfaction: { ...claim.satisfaction, inputs: [...claim.satisfaction.inputs].reverse() },
				})),
			),
		);
		expect(a.blockingCut).toEqual(b.blockingCut);
		expect(a.blockingCut?.optimality).toBe("minimum");
	});

	it("finds a shared repair instead of two locally cheapest branches", () => {
		const result = evaluateProofClosure(
			input([
				node("a"),
				node("b"),
				node("z"),
				node("left", ["a", "z"], "any"),
				node("right", ["b", "z"], "any"),
				node("root", ["left", "right"]),
			]),
		);
		expect(result.minimalBlockingCut).toEqual(["z"]);
	});
	it("removes the redundant branch in all(any(a,z),z)", () => {
		const result = evaluateProofClosure(
			input([node("a"), node("z"), node("left", ["a", "z"], "any"), node("root", ["left", "z"])]),
		);
		expect(result.minimalBlockingCut).toEqual(["z"]);
	});
	it("preserves composite-local counterexamples even when a child also blocks", () => {
		const request = input([node("child"), node("root", ["child"])]);
		const result = evaluateProofClosure({
			...request,
			observations: [
				{
					observationId: "local-counterexample",
					claimIds: ["root"],
					polarity: "violates",
					source: "deterministic_validator",
					sourceRoot: "fixture",
					environmentDigest: "fixture",
				},
			],
		});
		expect(result.minimalBlockingCut).toEqual(["child", "root"]);
		expect(result.verdict).toBe("violated");
	});
	it("agrees with an independent exhaustive oracle on deterministic small shared graphs", () => {
		for (let seed = 1; seed <= 60; seed++) {
			const claims = ["a", "b", "c", "d"].map((id) => node(id));
			for (let i = 0; i < 3; i++) {
				const one = (seed + i) % claims.length;
				const two = (one + 1 + (seed % (claims.length - 1))) % claims.length;
				claims.push(node(`branch${i}`, [claims[one].claimId, claims[two].claimId], (seed + i) % 2 ? "all" : "any"));
			}
			claims.push(node("root", ["branch0", "branch1", "branch2"]));
			const byId = new Map(claims.map((claim) => [claim.claimId, claim]));
			const closes = (id: string, repaired: Set<string>): boolean => {
				const claim = byId.get(id);
				if (!claim) throw new Error("Missing test node");
				if (!claim.satisfaction.inputs.length) return repaired.has(id);
				const children = claim.satisfaction.inputs.map((child) => closes(child, repaired));
				return claim.satisfaction.rule === "all" ? children.every(Boolean) : children.some(Boolean);
			};
			const referenced = new Set(claims.flatMap((claim) => claim.satisfaction.inputs));
			const roots = claims.filter((claim) => !referenced.has(claim.claimId));
			const candidates = Array.from({ length: 16 }, (_, mask) =>
				["a", "b", "c", "d"].filter((_, bit) => mask & (1 << bit)),
			)
				.filter((candidate) => roots.every((root) => closes(root.claimId, new Set(candidate))))
				.sort((a, b) => a.length - b.length || (a.join() < b.join() ? -1 : a.join() > b.join() ? 1 : 0));
			const result = evaluateProofClosure(input(claims));
			expect(result.minimalBlockingCut).toEqual(candidates[0]);
		}
	});
});
