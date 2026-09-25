import { describe, expect, it } from "vitest";
import { reduceDagDependencies, reduceDagDependenciesWithDiagnostics } from "../src/tool-dag-reduce.ts";

describe("phase3 bounded exact DAG reduction", () => {
	it("retains the 512-writer chain while bounding closure memory", () => {
		const graph = Array.from({ length: 512 }, (_, i) => Array.from({ length: i }, (_, j) => j));
		const result = reduceDagDependenciesWithDiagnostics(graph);
		expect(result.dependencies).toEqual(Array.from({ length: 512 }, (_, i) => (i ? [i - 1] : [])));
		expect(result.diagnostics.closureBytes).toBe(17344);
		expect(result.diagnostics.wordUnions).toBe(4320);
	});
	it("has an exact traversal fallback and does not mutate inputs", () => {
		const graph = [[], [0], [0], [0, 1, 2]];
		const copy = structuredClone(graph);
		expect(reduceDagDependenciesWithDiagnostics(graph, { maxClosureBytes: 0 }).dependencies).toEqual([
			[],
			[0],
			[0],
			[1, 2],
		]);
		expect(graph).toEqual(copy);
	});
	it("rejects invalid and noncanonical predecessor rows", () => {
		for (const graph of [
			[[], [1]],
			[[], [0, 0]],
			[[], [0], [1, 0]],
		]) {
			expect(() => reduceDagDependencies(graph)).toThrow(RangeError);
		}
	});
});
