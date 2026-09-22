import fc from "fast-check";
import { expect, it } from "vitest";
import { planAtomicCommits } from "../src/commit-planner.ts";
import { atom, input, relation } from "./atomic-commit-fixtures.ts";

it("matches an independent reachability oracle across 400 seeded graphs", () => {
	fc.assert(
		fc.property(
			fc.array(fc.record({ owner: fc.nat(9), settled: fc.nat(9), intent: fc.nat(9) }), {
				minLength: 1,
				maxLength: 20,
			}),
			fc.array(
				fc.record({
					from: fc.nat(19),
					to: fc.nat(19),
					kind: fc.constantFrom("depends" as const, "together" as const, "separate" as const),
				}),
				{ maxLength: 65 },
			),
			(facts, rawEdges) => {
				const atoms = facts.map((value, i) =>
					atom(`a${i}`, {
						sessionId: value.owner > 1 ? "s" : "foreign",
						settled: value.settled > 0,
						intentId: value.intent > 0 ? "intent" : "other",
					}),
				);
				const indexed = rawEdges.map((edge) => ({
					...edge,
					from: edge.from % atoms.length,
					to: edge.to % atoms.length,
				}));
				const edges = indexed.map((edge) => relation(edge.kind, `a${edge.from}`, `a${edge.to}`));
				const value = input(atoms, edges),
					before = structuredClone(value),
					p = planAtomicCommits(value);
				expect(value).toEqual(before);
				expect(p).toEqual(planAtomicCommits(input([...atoms].reverse(), [...edges].reverse())));
				let decoded: unknown;
				try {
					decoded = JSON.parse(p.canonicalInput);
				} catch (cause) {
					throw new Error("Planner canonical input is not JSON", { cause });
				}
				expect(p).toEqual(planAtomicCommits(decoded));
				// Floyd-Warshall reachability is independent of the planner's iterative SCC implementation.
				const reach = atoms.map((_, i) => atoms.map((_, j) => i === j));
				for (const edge of indexed) {
					if (edge.kind === "separate") continue;
					reach[edge.from][edge.to] = true;
					if (edge.kind === "together") reach[edge.to][edge.from] = true;
				}
				for (let k = 0; k < atoms.length; k++)
					for (let i = 0; i < atoms.length; i++)
						for (let j = 0; j < atoms.length; j++) reach[i][j] ||= reach[i][k] && reach[k][j];
				const selected = atoms
					.filter((_, i) => atoms.some((a, j) => a.sessionId === "s" && reach[j][i]))
					.map((a) => a.id);
				const groups = new Map(p.groups.flatMap((g) => g.atomIds.map((id) => [id, g] as const)));
				expect([...groups.keys()].sort()).toEqual([...selected].sort());
				expect(p.unrelatedAtomIds).toEqual(
					atoms
						.filter((a) => !selected.includes(a.id))
						.map((a) => a.id)
						.sort(),
				);
				for (let i = 0; i < atoms.length; i++)
					for (let j = 0; j < atoms.length; j++) {
						if (groups.has(`a${i}`) && groups.has(`a${j}`))
							expect(groups.get(`a${i}`)?.id === groups.get(`a${j}`)?.id).toBe(reach[i][j] && reach[j][i]);
					}
				const position = new Map(p.validationOrder.map((id, index) => [id, index]));
				for (const group of p.groups.filter((g) => g.status === "candidate")) {
					for (const id of group.atomIds)
						expect(atoms.find((a) => a.id === id)).toMatchObject({
							sessionId: "s",
							settled: true,
							provenance: "verified",
							closureComplete: true,
						});
					for (const dep of group.dependsOn) {
						const from = position.get(dep),
							to = position.get(group.id);
						expect(from !== undefined && to !== undefined && from < to).toBe(true);
					}
				}
				for (const edge of edges.filter((e) => e.kind === "separate")) {
					const from = groups.get(edge.from),
						to = groups.get(edge.to);
					if (from && to && from.id === to.id) expect(from.reasons).toContain("CONTRADICTORY_BOUNDARIES");
				}
			},
		),
		{ numRuns: 400, seed: 0x2f93ac17 },
	);
});

it.each(["chain", "fanout"])(
	"handles 12000 nodes without recursive %s traversal",
	(shape) => {
		const atoms = Array.from({ length: 12_000 }, (_, i) => atom(`a${String(i).padStart(5, "0")}`));
		const edges = atoms.slice(1).map((a, i) => relation("depends", a.id, atoms[shape === "chain" ? i : 0].id));
		const result = planAtomicCommits(input(atoms, edges));
		expect(result.validationOrder).toHaveLength(atoms.length);
		expect(result.validationOrder[0]).toBe("g:a00000");
	},
	10000,
);
