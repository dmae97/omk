/**
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (test/skills.test.mjs) — node:test → vitest, same assertions.
 */
import { describe, expect, it } from "vitest";
import {
	type CapabilityNeed,
	planSkills,
	type SkillDescriptor,
	type SkillPlanInput,
} from "../src/metacognition/index.ts";

const skill = (id: string, capabilities: readonly string[], over: Partial<SkillDescriptor> = {}): SkillDescriptor => ({
	id,
	contentHash: `hash:${id}`,
	capabilities,
	phases: ["implement"],
	tokenCost: 10,
	dependencies: [],
	conflicts: [],
	permissions: ["read"],
	explicitOnly: false,
	packages: {},
	...over,
});
const input = (catalog: readonly SkillDescriptor[], over: Partial<SkillPlanInput> = {}): SkillPlanInput => ({
	phase: "implement",
	needs: [{ capability: "ui", weight: 1, required: true }],
	catalog,
	approvedHashes: Object.fromEntries(catalog.map((s) => [s.id, s.contentHash])),
	installedVersions: {},
	allowedPermissions: ["read"],
	explicitSkills: [],
	tokenBudget: 100,
	maxSkills: 4,
	...over,
});
const needs = (...names: string[]): CapabilityNeed[] =>
	names.map((capability) => ({ capability, weight: 1, required: true }));

describe("skill planning", () => {
	it("joint frontend/backend coverage beats selecting redundant UI skills", () => {
		const catalog = [
			skill("ui-a", ["ui"]),
			skill("ui-b", ["ui"]),
			skill("ui-c", ["ui"]),
			skill("api", ["http"]),
			skill("db", ["transaction"]),
		];
		const result = planSkills(input(catalog, { needs: needs("ui", "http", "transaction"), maxSkills: 3 }));
		expect(result.selected).toEqual(["api", "db", "ui-a"]);
		expect(result.state).toBe("covered");
	});
	it("shared prerequisites are included once and charged", () => {
		const catalog = [
			skill("base", [], { tokenCost: 20 }),
			skill("ui", ["ui"], { dependencies: ["base"] }),
			skill("api", ["http"], { dependencies: ["base"] }),
		];
		const result = planSkills(input(catalog, { needs: needs("ui", "http"), tokenBudget: 40 }));
		expect(result.selected).toEqual(["api", "base", "ui"]);
		expect(result.tokenCost).toBe(40);
		expect(planSkills(input(catalog, { needs: needs("ui", "http"), tokenBudget: 39 })).state).not.toBe("covered");
	});
	it("missing prerequisite and dependency cycles do not authorize skills", () => {
		const catalog = [
			skill("a", ["ui"], { dependencies: ["b"] }),
			skill("b", [], { dependencies: ["a"] }),
			skill("missing", ["ui"], { dependencies: ["nope"] }),
		];
		expect(planSkills(input(catalog)).selected).toEqual([]);
	});
	it("one-sided conflict declaration is respected", () => {
		const result = planSkills(
			input([skill("ui", ["ui"], { conflicts: ["api"] }), skill("api", ["http"])], { needs: needs("ui", "http") }),
		);
		expect(result.selected.length).toBe(1);
		expect(result.state).toBe("capability-gap");
	});
	it("explicit-only requires explicit grant, which still cannot bypass permissions", () => {
		const catalog = [skill("special", ["ui"], { explicitOnly: true })];
		expect(planSkills(input(catalog)).selected).toEqual([]);
		expect(planSkills(input(catalog, { explicitSkills: ["special"] })).selected).toEqual(["special"]);
		expect(planSkills(input(catalog, { explicitSkills: ["special"], allowedPermissions: [] })).state).toBe(
			"explicit-blocked",
		);
	});
	it("explicit selection over budget or conflicting blocks visibly", () => {
		const catalog = [skill("a", ["ui"], { conflicts: ["b"] }), skill("b", ["http"])];
		expect(planSkills(input(catalog, { explicitSkills: ["a", "b"] })).state).toBe("explicit-blocked");
		expect(planSkills(input(catalog, { explicitSkills: ["a"], tokenBudget: 9 })).state).toBe("explicit-blocked");
	});
	it("changed content hash prevents an old approval from granting changed instructions", () => {
		expect(planSkills(input([skill("ui", ["ui"])], { approvedHashes: { ui: "old" } })).selected).toEqual([]);
	});
	it("unknown, range-only, and mismatched versions are not exact compatibility evidence", () => {
		const catalog = [skill("ui", ["ui"], { packages: { react: ["19.0.0"] } })];
		for (const version of [undefined, "^19.0.0", "18.0.0"]) {
			const result = planSkills(input(catalog, { installedVersions: version ? { react: version } : {} }));
			expect(result.selected).toEqual([]);
		}
		expect(planSkills(input(catalog, { installedVersions: { react: "19.0.0" } })).selected).toEqual(["ui"]);
	});
	it("wrong phase and zero caps never silently enable a skill", () => {
		const catalog = [skill("ui", ["ui"])];
		expect(planSkills(input(catalog, { phase: "verify" })).selected).toEqual([]);
		expect(planSkills(input(catalog, { maxSkills: 0 })).selected).toEqual([]);
		expect(planSkills(input(catalog, { tokenBudget: 0 })).selected).toEqual([]);
	});
	it("required coverage has lexicographic priority over optional weight", () => {
		const catalog = [skill("must", ["ui"]), skill("extra", ["optional"])];
		const result = planSkills(
			input(catalog, {
				maxSkills: 1,
				needs: [...needs("ui"), { capability: "optional", weight: 999999, required: false }],
			}),
		);
		expect(result.selected).toEqual(["must"]);
	});
	it("malformed numbers, duplicate ids and duplicate needs are rejected", () => {
		for (const tokenCost of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.1]) {
			expect(() => planSkills(input([skill("a", ["ui"], { tokenCost })]))).toThrow();
		}
		expect(() => planSkills(input([skill("a", ["ui"]), skill("a", ["http"])]))).toThrow();
		expect(() => planSkills(input([skill("a", ["ui"])], { needs: needs("ui", "ui") }))).toThrow();
	});
	it("catalog permutations preserve deterministic tie breaking", () => {
		const catalog = [skill("z", ["ui"]), skill("a", ["ui"]), skill("q", ["other"])];
		expect(planSkills(input(catalog))).toEqual(planSkills(input([...catalog].reverse())));
	});
	it("large-catalog greedy path stays bounded and preserves feasible singleton comparison", () => {
		const catalog = Array.from({ length: 30 }, (_, i) => skill(`s${i}`, i === 29 ? ["ui"] : ["other"]));
		const result = planSkills(input(catalog));
		expect(result.algorithm).toBe("greedy-with-singleton");
		expect(result.selected).toEqual(["s29"]);
	});
	// Independent small-set enumerator: no calls into the implementation's helpers.
	function oracle(
		catalog: readonly SkillDescriptor[],
		wants: readonly CapabilityNeed[],
		budget: number,
		cap: number,
	): string[] {
		let best = { required: -1, optional: -1, cost: Number.POSITIVE_INFINITY, ids: [] as string[] };
		for (let bits = 0; bits < 2 ** catalog.length; bits++) {
			const chosen = catalog.filter((_, i) => bits & (1 << i));
			const ids = chosen.map((s) => s.id).sort();
			const set = new Set(ids);
			const cost = chosen.reduce((v, s) => v + s.tokenCost, 0);
			if (
				ids.length > cap ||
				cost > budget ||
				chosen.some((s) => s.dependencies.some((d) => !set.has(d)) || s.conflicts.some((d) => set.has(d)))
			) {
				continue;
			}
			const covered = new Set(chosen.flatMap((s) => s.capabilities));
			const required = wants
				.filter((n) => n.required && covered.has(n.capability))
				.reduce((v, n) => v + n.weight, 0);
			const optional = wants
				.filter((n) => !n.required && covered.has(n.capability))
				.reduce((v, n) => v + n.weight, 0);
			const row = { required, optional, cost, ids };
			const better =
				required !== best.required
					? required > best.required
					: optional !== best.optional
						? optional > best.optional
						: cost !== best.cost
							? cost < best.cost
							: ids.length !== best.ids.length
								? ids.length < best.ids.length
								: ids.join("\0") < best.ids.join("\0");
			if (better) best = row;
		}
		return best.ids;
	}
	it("300 seeded tiny catalogs agree with an independent exhaustive oracle", () => {
		let seed = 0x37ab1290;
		const rand = (n: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed % n;
		};
		for (let trial = 0; trial < 300; trial++) {
			const n = 1 + rand(8);
			const catalog: SkillDescriptor[] = [];
			for (let i = 0; i < n; i++) {
				catalog.push(
					skill(
						`s${i}`,
						["a", "b", "c", "d"].filter(() => rand(2) === 1),
						{
							tokenCost: rand(20),
							dependencies: i !== 0 && rand(4) === 0 ? [`s${rand(i)}`] : [],
							conflicts: rand(5) === 0 ? [`s${rand(n)}`] : [],
						},
					),
				);
			}
			const wants = ["a", "b", "c", "d"].map((capability) => ({
				capability,
				weight: 1 + rand(4),
				required: rand(2) === 1,
			}));
			const budget = rand(50),
				cap = rand(6);
			expect(planSkills(input(catalog, { needs: wants, tokenBudget: budget, maxSkills: cap })).selected).toEqual(
				oracle(catalog, wants, budget, cap),
			);
		}
	});
});
