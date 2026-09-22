import { expect, it } from "vitest";
import { planAtomicCommits } from "../src/index.ts";
import { atom, input, relation } from "./atomic-commit-fixtures.ts";

it("rejects aggregate paths before reading the overflowing atom's path elements", () => {
	const prefix = Array.from({ length: 390 }, (_, i) => atom(`a${i}`, { paths: Array(256).fill("x") }));
	const overflow: string[] = Array(161).fill("x");
	let elementReads = 0;
	Object.defineProperty(overflow, "0", {
		get: () => {
			elementReads++;
			return "x";
		},
	});
	expect(() => planAtomicCommits(input([...prefix, atom("overflow", { paths: overflow })]))).toThrow(/path limit/);
	expect(elementReads).toBe(0);
});

it("rejects an oversized relation array before decoding any atom", () => {
	let pathReads = 0;
	const observed = {
		...atom("a"),
		get paths() {
			pathReads++;
			return ["a.ts"];
		},
	};
	expect(() => planAtomicCommits({ ...input([observed]), relations: new Array(100_001) })).toThrow(/size/);
	expect(pathReads).toBe(0);
});

it("bounds aggregate package entries before reading the overflow", () => {
	const prefix = Array.from({ length: 390 }, (_, i) => atom(`a${i}`, { packages: Array(256).fill("pkg") }));
	const overflow: string[] = Array(161).fill("pkg");
	let elementReads = 0;
	Object.defineProperty(overflow, "0", {
		get: () => {
			elementReads++;
			return "pkg";
		},
	});
	expect(() => planAtomicCommits(input([...prefix, atom("overflow", { packages: overflow })]))).toThrow(
		/package limit/,
	);
	expect(elementReads).toBe(0);
});

it("accepts exactly 100000 path and package entries", () => {
	const atoms = Array.from({ length: 391 }, (_, i) =>
		atom(`a${i}`, {
			paths: Array(i === 390 ? 160 : 256).fill("x"),
			packages: Array(i === 390 ? 160 : 256).fill("p"),
		}),
	);
	expect(planAtomicCommits(input(atoms)).groups).toHaveLength(391);
});

it("bounds total text work even when large relation strings later deduplicate", () => {
	const edge = { ...relation("depends", "a", "a"), evidenceRef: "e".repeat(512) };
	expect(() => planAtomicCommits(input([atom("a")], Array(17_000).fill(edge)))).toThrow(/text limit/);
});

it("keeps within-budget duplicate relations valid", () => {
	const edge = { ...relation("depends", "a", "a"), evidenceRef: "e".repeat(512) };
	expect(planAtomicCommits(input([atom("a")], Array(16_000).fill(edge))).validationOrder).toEqual(["g:a"]);
});

function textUnits(value: unknown): number {
	if (typeof value === "string") return value.length;
	if (value && typeof value === "object")
		return Object.values(value).reduce<number>((sum, child) => sum + textUnits(child), 0);
	return 0;
}

it("accepts the exact text boundary, rejects one extra code unit, and resets each call", () => {
	const limit = 8_388_608;
	const base = input([atom("a")]);
	const edge = { ...relation("depends", "a", "a"), evidenceRef: "e".repeat(512) };
	const overhead = textUnits({ ...edge, evidenceRef: "" });
	const edges = Array.from({ length: Math.floor((limit - textUnits(base)) / textUnits(edge)) }, () => ({ ...edge }));
	let remaining = limit - textUnits({ ...base, relations: edges });
	if (remaining > 0 && remaining <= overhead) {
		const first = edges[0];
		if (!first) throw new Error("Missing text-budget fixture edge");
		const delta = overhead + 1 - remaining;
		edges[0] = { ...first, evidenceRef: first.evidenceRef.slice(delta) };
		remaining += delta;
	}
	if (remaining) edges.push({ ...edge, evidenceRef: "e".repeat(remaining - overhead) });
	const exact = { ...base, relations: edges };
	expect(textUnits(exact)).toBe(limit);
	expect(planAtomicCommits(exact).validationOrder).toEqual(["g:a"]);
	expect(() => planAtomicCommits({ ...exact, baseCommit: `${exact.baseCommit}x` })).toThrow(/text limit/);
	expect(planAtomicCommits(base).validationOrder).toEqual(["g:a"]);
});
