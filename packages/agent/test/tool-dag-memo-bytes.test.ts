import { describe, expect, it } from "vitest";
import {
	DAG_SCHEDULE_CACHE_MAX_BYTES,
	DAG_SCHEDULE_CACHE_MAX_ENTRY_BYTES,
	type DagFrontierScheduleCache,
	resolveDagFrontierMemo,
	scheduleDagLevelsMemo,
} from "../src/tool-dag-memo.ts";
import { resolveBatchClaims } from "../src/tool-dag-scheduler.ts";

const options = { cwd: "/audit" };

/** The memo's accounting: two bytes per UTF-16 code unit of key and JSON value, plus 128 per entry. */
function retainedBytes(cache: ReadonlyMap<string, unknown>): number {
	let total = 0;
	for (const [key, value] of cache) total += 2 * (key.length + JSON.stringify(value).length) + 128;
	return total;
}

// Keys carry the whole call arguments, so a write's file content is retained with its schedule.
function writeBatch(index: number, contentChars: number) {
	return [
		{
			id: `w${index}`,
			name: "write",
			arguments: { path: `/audit/file-${index}`, content: "x".repeat(contentChars) },
		},
	];
}

describe("DAG claim memo byte budget", () => {
	it("documents 4 MiB per cache and 512 KiB per entry", () => {
		expect([DAG_SCHEDULE_CACHE_MAX_BYTES, DAG_SCHEDULE_CACHE_MAX_ENTRY_BYTES]).toEqual([4 * 1024 * 1024, 512 * 1024]);
	});

	it("schedules a batch too large to retain without caching it", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		const calls = writeBatch(0, 300 * 1024);
		const resolved = await resolveDagFrontierMemo(calls, options, undefined, cache);
		expect(resolved).toEqual(await resolveBatchClaims(calls, options));
		expect(cache.size).toBe(0);
	});

	// A long path appears once in the key and twice in the claims, so the key alone fits the entry
	// limit while key and value together exceed it.
	it("measures the value as well as the key against the entry limit", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		const calls = [
			{ id: "long", name: "write", arguments: { path: `/audit/${"p".repeat(100 * 1024)}`, content: "" } },
		];
		const resolved = await resolveDagFrontierMemo(calls, options, undefined, cache);
		expect(resolved).toEqual(await resolveBatchClaims(calls, options));
		expect(cache.size).toBe(0);
	});

	it("applies the same limit to barrier-level plans", async () => {
		const cache = new Map();
		const plan = await scheduleDagLevelsMemo(writeBatch(0, 300 * 1024), options, undefined, cache);
		expect(plan?.levels).toEqual([[0]]);
		expect(cache.size).toBe(0);
	});

	it("keeps retained bytes under the budget by evicting the least recently used batch", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		for (let index = 0; index < 64; index++) {
			await resolveDagFrontierMemo(writeBatch(index, 64 * 1024), options, undefined, cache);
		}
		expect(retainedBytes(cache)).toBeLessThanOrEqual(DAG_SCHEDULE_CACHE_MAX_BYTES);
		expect(cache.size).toBeLessThan(64);
		const keys = [...cache.keys()];
		expect(keys.at(-1)).toContain('"/audit/file-63"');
		expect(keys.join("\n")).not.toContain('"/audit/file-0"');
	});

	it("counts an unmeasurable value as a full entry instead of failing the schedule", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		// Outside the contract, since the memo owns the Map: a stray primitive must not break scheduling.
		(cache as Map<string, unknown>).set("stray", 1);
		const calls = writeBatch(1, 16);
		const uncached = await resolveBatchClaims(calls, options);
		await expect(resolveDagFrontierMemo(calls, options, undefined, cache)).resolves.toEqual(uncached);
		expect(cache.size).toBe(2);
	});

	it("evicts unmeasurable entries as full-size ones", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		// Eight strays at 512 KiB each fill the 4 MiB budget, so one small batch evicts exactly one.
		for (let index = 0; index < 8; index++) (cache as Map<string, unknown>).set(`stray-${index}`, index);
		await resolveDagFrontierMemo(writeBatch(1, 16), options, undefined, cache);
		expect(cache.size).toBe(8);
		expect([...cache.keys()].filter((key) => key.startsWith("stray-"))).toHaveLength(7);
		expect(cache.has("stray-0")).toBe(false);
	});

	it("keeps the budget and the uncached results under concurrent calls", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		const batches = Array.from({ length: 90 }, (_unused, index) => writeBatch(index % 45, 32 * 1024));
		const results = await Promise.all(
			batches.map((calls) => resolveDagFrontierMemo(calls, options, undefined, cache)),
		);
		for (const [index, calls] of batches.entries()) {
			expect(results[index]).toEqual(await resolveBatchClaims(calls, options));
		}
		expect(cache.size).toBeLessThanOrEqual(64);
		expect(retainedBytes(cache)).toBeLessThanOrEqual(DAG_SCHEDULE_CACHE_MAX_BYTES);
	});

	it("keeps a recently hit batch over older ones", async () => {
		const cache: DagFrontierScheduleCache = new Map();
		for (let index = 0; index < 20; index++) {
			await resolveDagFrontierMemo(writeBatch(index, 64 * 1024), options, undefined, cache);
		}
		const hit = await resolveDagFrontierMemo(writeBatch(0, 64 * 1024), options, undefined, cache);
		expect(hit).toEqual(await resolveBatchClaims(writeBatch(0, 64 * 1024), options));
		for (let index = 20; index < 40; index++) {
			await resolveDagFrontierMemo(writeBatch(index, 64 * 1024), options, undefined, cache);
		}
		const keys = [...cache.keys()].join("\n");
		expect(keys).toContain('"/audit/file-0"');
		expect(keys).not.toContain('"/audit/file-1"');
		expect(retainedBytes(cache)).toBeLessThanOrEqual(DAG_SCHEDULE_CACHE_MAX_BYTES);
	});
});
