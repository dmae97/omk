import { expect, it } from "vitest";
import { type DagScheduleCache, scheduleDagLevelsMemo } from "../src/tool-dag-memo.ts";

it("does not replay a warm schedule after cancellation or change cache recency", async () => {
	const cache: DagScheduleCache = new Map();
	const first = [{ name: "write", arguments: { path: "a" } }];
	const second = [{ name: "write", arguments: { path: "b" } }];
	const options = { cwd: "/fixture" };
	await scheduleDagLevelsMemo(first, options, undefined, cache);
	await scheduleDagLevelsMemo(second, options, undefined, cache);
	const before = [...cache.entries()];
	const controller = new AbortController();
	controller.abort();
	expect(await scheduleDagLevelsMemo(first, options, controller.signal, cache)).toBeNull();
	expect([...cache.entries()]).toEqual(before);
});

it("does not inspect or serialize arguments for an already-cancelled cold schedule", async () => {
	const controller = new AbortController();
	controller.abort();
	let reads = 0;
	const args = {
		get path() {
			reads++;
			return "x";
		},
	};
	const cache: DagScheduleCache = new Map();
	expect(
		await scheduleDagLevelsMemo([{ name: "write", arguments: args }], { cwd: "/fixture" }, controller.signal, cache),
	).toBeNull();
	expect(reads).toBe(0);
	expect(cache.size).toBe(0);
});
