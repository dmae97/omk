import { describe, expect, it } from "vitest";
import { type DagFrontierScheduleCache, resolveDagFrontierMemo, scheduleDagLevelsMemo } from "../src/tool-dag-memo.ts";

const options = { cwd: "/audit" };

function pathCalls() {
	return [
		{ id: "first", name: "write", arguments: { path: "/audit/a", content: "one" } },
		{ id: "second", name: "read", arguments: { path: "/audit/a" } },
	];
}

describe("frontier-only schedule memo", () => {
	it("preserves resolved claims without creating a cached barrier-level plan", async () => {
		const calls = pathCalls();
		const frontierCache: DagFrontierScheduleCache = new Map();
		const fullCache = new Map();
		const frontier = await resolveDagFrontierMemo(calls, options, undefined, frontierCache);
		const full = await scheduleDagLevelsMemo(calls, options, undefined, fullCache);
		expect(frontier).toEqual(full?.entries);
		expect(full?.levels).toEqual([[0], [1]]);
		expect(frontierCache.size).toBe(1);
		expect(Array.isArray(frontierCache.values().next().value)).toBe(true);
		expect(frontierCache.values().next().value).not.toHaveProperty("levels");
	});

	it("detaches nested claims from both miss and hit results", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		const first = await resolveDagFrontierMemo(pathCalls(), options, undefined, cache);
		if (!first || first[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		const original = first[0].resolution.claims[0].key;
		(first[0].resolution.claims[0] as { key: string }).key = "/poisoned";
		(first[0].canonicalClaims[0] as { key: string }).key = "/poisoned";
		const hit = await resolveDagFrontierMemo(pathCalls(), options, undefined, cache);
		if (!hit || hit[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		expect(hit[0].resolution.claims[0].key).toBe(original);
		(hit[0].resolution.claims[0] as { key: string }).key = "/poisoned-again";
		const next = await resolveDagFrontierMemo(pathCalls(), options, undefined, cache);
		if (!next || next[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		expect(next[0].resolution.claims[0].key).toBe(original);
		expect(next[0].canonicalClaims[0].key).toBe(original);
	});

	it("returns before reading cyclic arguments when cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		let reads = 0;
		const args = {
			get path() {
				reads++;
				return "/audit/a";
			},
		};
		const cache: DagFrontierScheduleCache = new Map();
		expect(
			await resolveDagFrontierMemo([{ name: "write", arguments: args }], options, controller.signal, cache),
		).toBeNull();
		expect(reads).toBe(0);
		expect(cache.size).toBe(0);
	});

	it("bounds the cache at 64 plans and promotes hits without changing their claims", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		const calls = (index: number) => [{ name: "write", arguments: { path: `/audit/entry-${index}` } }];
		for (let index = 0; index < 64; index++) {
			await resolveDagFrontierMemo(calls(index), options, undefined, cache);
		}
		const [oldest, nextOldest] = [...cache.keys()];
		expect(cache.size).toBe(64);
		await resolveDagFrontierMemo(calls(0), options, undefined, cache);
		await resolveDagFrontierMemo(calls(64), options, undefined, cache);
		expect(cache.size).toBe(64);
		expect(cache.has(oldest)).toBe(true);
		expect(cache.has(nextOldest)).toBe(false);
		const controller = new AbortController();
		controller.abort();
		const keysBefore = [...cache.keys()];
		expect(await resolveDagFrontierMemo(calls(0), options, controller.signal, cache)).toBeNull();
		expect([...cache.keys()]).toEqual(keysBefore);
	});

	it("bypasses the cache for changing resourceClaims closures", async () => {
		let version = 0;
		const custom = {
			cwd: "/audit",
			registeredTools: [
				{
					name: "write",
					resourceClaims: async () => [
						{ kind: "path" as const, key: version++ === 0 ? "/audit/a" : "/audit/b", access: "write" as const },
					],
				},
			],
		};
		const cache: DagFrontierScheduleCache = new Map();
		const calls = [{ id: "call", name: "write", arguments: { path: "ignored" } }];
		const first = await resolveDagFrontierMemo(calls, custom, undefined, cache);
		const second = await resolveDagFrontierMemo(calls, custom, undefined, cache);
		if (!first || !second || first[0].resolution.kind !== "claims" || second[0].resolution.kind !== "claims") {
			throw new Error("Expected path claims");
		}
		expect(first[0].resolution.claims[0].key).not.toBe(second[0].resolution.claims[0].key);
		expect(cache.size).toBe(0);
	});
});
