import { describe, expect, it } from "vitest";
import { type CheckNode, runCheckDag, validateCheckDag } from "../src/core/onboarding/check-dag.ts";

type Ctx = { readonly log: string[] };

const node = (id: string, overrides: Partial<CheckNode<Ctx>> = {}): CheckNode<Ctx> => ({
	id,
	title: id,
	deadlineMs: 1000,
	run: (ctx) => {
		ctx.log.push(id);
		return { status: "pass", summary: id };
	},
	...overrides,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("check DAG scheduler", () => {
	it("runs dependencies before dependents and reports in declaration order", async () => {
		const ctx: Ctx = { log: [] };
		const reports = await runCheckDag([node("c", { deps: ["b"] }), node("b", { deps: ["a"] }), node("a")], ctx);
		expect(ctx.log).toEqual(["a", "b", "c"]);
		expect(reports.map((report) => report.id)).toEqual(["c", "b", "a"]);
	});

	it("skips dependents of a failed check without running them", async () => {
		const ctx: Ctx = { log: [] };
		const reports = await runCheckDag(
			[
				node("root", { run: () => ({ status: "fail", summary: "broken" }) }),
				node("child", { deps: ["root"] }),
				node("grandchild", { deps: ["child"] }),
				node("independent"),
			],
			ctx,
		);
		expect(ctx.log).toEqual(["independent"]);
		expect(reports.find((r) => r.id === "child")).toMatchObject({
			status: "skip",
			summary: "skipped (blocked by root)",
		});
		expect(reports.find((r) => r.id === "grandchild")).toMatchObject({
			status: "skip",
			summary: "skipped (blocked by child)",
		});
	});

	it("never runs more than the concurrency limit at once", async () => {
		let active = 0;
		let peak = 0;
		const slow = (id: string) =>
			node(id, {
				run: async () => {
					active += 1;
					peak = Math.max(peak, active);
					await sleep(15);
					active -= 1;
					return { status: "pass", summary: id };
				},
			});
		await runCheckDag([slow("a"), slow("b"), slow("c"), slow("d"), slow("e")], { log: [] }, { concurrency: 2 });
		expect(peak).toBe(2);
	});

	it("turns an elapsed deadline into the node's timeout status and aborts its signal", async () => {
		let aborted = false;
		const reports = await runCheckDag(
			[
				node("slow", {
					deadlineMs: 20,
					run: async (_ctx, signal) => {
						signal.addEventListener("abort", () => {
							aborted = true;
						});
						await sleep(200);
						return { status: "pass", summary: "late" };
					},
				}),
				node("strict", { deadlineMs: 20, onTimeout: "fail", run: () => new Promise(() => undefined) }),
			],
			{ log: [] },
		);
		expect(reports[0]).toMatchObject({ status: "warn", summary: "timed out after 20 ms" });
		expect(reports[1]).toMatchObject({ status: "fail" });
		expect(aborted).toBe(true);
	});

	it("reports a thrown error as a failure instead of rejecting the run", async () => {
		const reports = await runCheckDag(
			[
				node("boom", {
					run: () => {
						throw new Error("probe crashed");
					},
				}),
			],
			{ log: [] },
		);
		expect(reports[0]).toMatchObject({ status: "fail", summary: "probe crashed" });
	});

	it("rejects duplicate ids, unknown dependencies and cycles", () => {
		expect(() => validateCheckDag([node("a"), node("a")])).toThrow(/duplicate/);
		expect(() => validateCheckDag([node("a", { deps: ["missing"] })])).toThrow(/unknown/);
		expect(() => validateCheckDag([node("a", { deps: ["b"] }), node("b", { deps: ["a"] })])).toThrow(/cycle/);
	});

	it("leaves no timer behind after the run settles", async () => {
		const before = process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
		await runCheckDag([node("a", { deadlineMs: 60_000 }), node("b", { deadlineMs: 60_000, deps: ["a"] })], {
			log: [],
		});
		const after = process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
		expect(after).toBe(before);
	});
});
