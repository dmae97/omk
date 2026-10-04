import { expect, it } from "vitest";
import { buildIndexedDagDependencies } from "../src/tool-dag-index.ts";
import { assignDagDependencies } from "../src/tool-dag-scheduler.ts";
import { resolutionsConflict, type ToolClaimResolution } from "../src/tool-resource-claims.ts";

it("avoids predicate calls for independent path writes without dropping edges", () => {
	const entries = Array.from({ length: 256 }, (_, sourceIndex) => ({
		sourceIndex,
		resolution: {
			kind: "claims" as const,
			claims: [{ kind: "path" as const, key: `/audit/${sourceIndex}`, access: "write" as const }],
		},
		canonicalClaims: [],
	}));
	const result = buildIndexedDagDependencies(entries, (left, right) =>
		resolutionsConflict(left.resolution, right.resolution),
	);
	expect(result.dependencies).toEqual(entries.map(() => []));
	expect(result.stats).toMatchObject({ predicateCalls: 0, fallback: false });
});

it("preserves the real resource predicate across seeded indexed and fallback graphs", () => {
	let seed = 0x4f4d4b;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed;
	};
	const keys = ["/", "/a", "/a/b", "/B", "/../x", "C:/a", "//host/share/a", "relative"];
	for (let trial = 0; trial < 2000; trial++) {
		const entries = Array.from({ length: random() % 24 }, (_, sourceIndex) => {
			const resolution: ToolClaimResolution =
				random() % 9 === 0
					? { kind: "exclusive" }
					: {
							kind: "claims",
							claims: [
								{
									kind: "path",
									key: keys[random() % keys.length],
									access: random() % 2 ? "read" : "write",
									inodeKey: `dev:${random() % 8}`,
								},
							],
						};
			return { sourceIndex, resolution, canonicalClaims: resolution.kind === "claims" ? resolution.claims : [] };
		});
		const predicate = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
			resolutionsConflict(a.resolution, b.resolution);
		const oracle = entries.map((current, i) =>
			entries.slice(0, i).flatMap((prior, j) => (predicate(prior, current) ? [j] : [])),
		);
		expect(assignDagDependencies(entries)).toEqual(oracle);
		expect(
			buildIndexedDagDependencies(entries, predicate, { maxMemberships: trial % 7 ? 131072 : 4 }).dependencies,
		).toEqual(oracle);
	}
});
