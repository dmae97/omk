import { describe, expect, it } from "vitest";
import { reduceDagDependencies } from "../src/tool-dag-reduce.ts";
import { assignDagDependencies, type ResolvedClaimEntry } from "../src/tool-dag-scheduler.ts";
import type { ToolClaimResolution } from "../src/tool-resource-claims.ts";

function reachable(dependencies: readonly (readonly number[])[]): bigint[] {
	const successors: number[][] = Array.from({ length: dependencies.length }, () => []);
	for (let target = 0; target < dependencies.length; target++) {
		for (const source of dependencies[target]) successors[source].push(target);
	}
	const result = Array.from({ length: dependencies.length }, (): bigint => 0n);
	for (let source = successors.length - 1; source >= 0; source--) {
		let closure = 0n;
		for (const target of successors[source]) closure |= (1n << BigInt(target)) | result[target];
		result[source] = closure;
	}
	return result;
}

function edgeCount(dependencies: readonly (readonly number[])[]): number {
	return dependencies.reduce((sum, predecessors) => sum + predecessors.length, 0);
}

function bruteForceTransitiveReduction(dependencies: readonly (readonly number[])[]): number[][] {
	const successors: number[][] = Array.from({ length: dependencies.length }, () => []);
	for (let target = 0; target < dependencies.length; target++) {
		for (const source of dependencies[target]) successors[source].push(target);
	}
	const reduced = dependencies.map((predecessors) => [...predecessors]);
	for (let source = 0; source < successors.length; source++) {
		for (const target of successors[source]) {
			const alternate = successors[source].some((first) => {
				if (first === target) return false;
				const stack = [...successors[first]];
				const seen = new Set<number>();
				while (stack.length > 0) {
					const next = stack.pop();
					if (next === undefined || seen.has(next)) continue;
					if (next === target) return true;
					seen.add(next);
					stack.push(...successors[next]);
				}
				return false;
			});
			if (alternate) reduced[target] = reduced[target].filter((predecessor) => predecessor !== source);
		}
	}
	return reduced;
}

describe("DAG transitive reduction", () => {
	it("reduces a complete DAG to the same-reachability chain", () => {
		const complete = Array.from({ length: 8 }, (_, target) => Array.from({ length: target }, (_, source) => source));
		expect(reduceDagDependencies(complete)).toEqual([[], [0], [1], [2], [3], [4], [5], [6]]);
	});

	it("removes only the shortcut in a diamond and preserves reachability", () => {
		const diamond = [[], [0], [0], [0, 1, 2]];
		const reduced = reduceDagDependencies(diamond);
		expect(reduced).toEqual([[], [0], [0], [1, 2]]);
		expect(reachable(reduced)).toEqual(reachable(diamond));
	});

	it("preserves reachability for seeded random DAGs", () => {
		let seed = 0x4f4d4b;
		const random = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed;
		};
		for (let trial = 0; trial < 2_000; trial++) {
			const size = random() % 20;
			const dag = Array.from({ length: size }, (_, target) => {
				const predecessors: number[] = [];
				for (let source = 0; source < target; source++) if (random() % 5 === 0) predecessors.push(source);
				return predecessors;
			});
			const reduced = reduceDagDependencies(dag);
			expect(reachable(reduced), `trial ${trial}`).toEqual(reachable(dag));
			expect(reduced, `trial ${trial}`).toEqual(bruteForceTransitiveReduction(dag));
			expect(edgeCount(reduced)).toBeLessThanOrEqual(edgeCount(dag));
			expect(reduceDagDependencies(reduced), `trial ${trial}`).toEqual(reduced);
		}
	});

	it("reduces the real 512-writer same-path conflict graph from 130816 edges to a chain", () => {
		const entries: ResolvedClaimEntry[] = Array.from({ length: 512 }, (_, sourceIndex) => {
			const resolution: ToolClaimResolution = {
				kind: "claims",
				claims: [{ kind: "path", key: "/audit/shared", access: "write" }],
			};
			return { sourceIndex, resolution, canonicalClaims: resolution.claims };
		});
		const conflicts = assignDagDependencies(entries);
		expect(edgeCount(conflicts)).toBe(130_816);
		const reduced = reduceDagDependencies(conflicts);
		expect(edgeCount(reduced)).toBe(511);
		expect(reachable(reduced)).toEqual(reachable(conflicts));
	});

	it("rejects malformed predecessor graphs", () => {
		const invalid: readonly (readonly (readonly number[])[])[] = [
			[[0]],
			[[], [1]],
			[[], [2]],
			[[], [0, 0]],
			[[], [1, 0]],
			[[], [0.5]],
		];
		for (const input of invalid) expect(() => reduceDagDependencies(input)).toThrow(RangeError);
	});
});
