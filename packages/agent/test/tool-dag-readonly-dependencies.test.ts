import { expect, it } from "vitest";
import { assignDagDependencies, type ResolvedClaimEntry } from "../src/tool-dag-scheduler.ts";
import type { ToolClaimResolution } from "../src/tool-resource-claims.ts";

it("builds an all-read dependency graph with linear resolution visits", () => {
	let visits = 0;
	const entries: ResolvedClaimEntry[] = Array.from({ length: 128 }, (_, sourceIndex) => {
		const resolution: ToolClaimResolution = {
			kind: "claims",
			claims: [{ kind: "path", key: "/same", access: "read" }],
		};
		return {
			sourceIndex,
			canonicalClaims: resolution.claims,
			get resolution() {
				visits++;
				return resolution;
			},
		};
	});
	expect(assignDagDependencies(entries)).toEqual(entries.map(() => []));
	expect(visits).toBeLessThanOrEqual(2 * entries.length);
});

it("retains ordering when an exclusive barrier separates empty/read claims", () => {
	const resolutions: ToolClaimResolution[] = [
		{ kind: "claims", claims: [] },
		{ kind: "exclusive" },
		{ kind: "claims", claims: [{ kind: "session", key: "s", access: "read" }] },
	];
	const entries = resolutions.map((resolution, sourceIndex) => ({
		sourceIndex,
		resolution,
		canonicalClaims: resolution.kind === "claims" ? resolution.claims : [],
	}));
	expect(assignDagDependencies(entries)).toEqual([[], [0], [1]]);
});
