import { describe, expect, it } from "vitest";
import {
	createMemoryContextBudgetCacheProviderV2,
	MemoryContextBudgetCacheProviderV2,
} from "../src/core/context-budget-v2-cache-provider.ts";
import type { ContextBudgetRepresentationCacheEntryV2 } from "../src/core/context-budget-v2-types.ts";

function entry(text = "rendered representation text"): ContextBudgetRepresentationCacheEntryV2 {
	return {
		kind: "summary",
		text,
		estimatedTokens: 7,
		fidelity: "lossy",
		sourceHash: "source-a",
		representationFingerprint: "fingerprint-a",
		modelId: "model-a",
		tokenizerId: "heuristic-v1",
		policyVersion: "context-budget-v2",
		createdAtEpochMs: 1_000,
	};
}

describe("memory context-budget cache provider", () => {
	it("keeps the entry-count LRU of the two-argument constructor", () => {
		const provider = new MemoryContextBudgetCacheProviderV2("turn", 2);
		provider.writeRepresentation({ key: "a", entry: entry() });
		provider.writeRepresentation({ key: "b", entry: entry() });
		provider.readRepresentation("a");
		provider.writeRepresentation({ key: "c", entry: entry() });

		expect(provider.readRepresentation("b")).toBeUndefined();
		expect(provider.readRepresentation("a")?.layer).toBe("turn");
		expect(provider.readRepresentation("c")).toBeDefined();
	});

	it("bounds retained bytes, not only the entry count", () => {
		const provider = new MemoryContextBudgetCacheProviderV2("session", 256, { representationBytes: 64 * 1024 });
		for (let index = 0; index < 10; index++) {
			provider.writeRepresentation({ key: `k${index}`, entry: entry("x".repeat(8_000)) });
		}

		expect(provider.readRepresentation("k0")).toBeUndefined();
		expect(provider.readRepresentation("k9")?.entry.text).toHaveLength(8_000);
		const usage = provider.getMemoryUsageSnapshot().representations;
		expect(usage.accountedBytes).toBeLessThanOrEqual(64 * 1024);
		expect(usage.entries).toBeLessThan(10);
		expect(usage.evictions).toBeGreaterThan(0);
	});

	it("isolates stored entries from later mutation by the writer or a reader", () => {
		const provider = createMemoryContextBudgetCacheProviderV2("session");
		const written: {
			-readonly [K in keyof ContextBudgetRepresentationCacheEntryV2]: ContextBudgetRepresentationCacheEntryV2[K];
		} = entry("before");
		provider.writeRepresentation({ key: "k", entry: written });
		written.text = "writer mutation";

		const read = provider.readRepresentation("k");
		expect(read?.entry.text).toBe("before");
		(read?.entry as { text: string }).text = "reader mutation";

		expect(provider.readRepresentation("k")?.entry.text).toBe("before");
	});

	it("treats entries that are not plain JSON data as misses without invoking accessors", () => {
		const provider = new MemoryContextBudgetCacheProviderV2("session");
		let getterCalls = 0;
		const withAccessor = { ...entry() };
		Object.defineProperty(withAccessor, "text", {
			enumerable: true,
			get: () => {
				getterCalls++;
				return "computed";
			},
		});
		provider.writeRepresentation({ key: "accessor", entry: withAccessor });
		provider.writeRepresentation({ key: "map", entry: { ...entry(), verification: new Map() as never } });
		provider.writeRepresentation({ key: "nan", entry: { ...entry(), estimatedTokens: Number.NaN } });

		expect(provider.readRepresentation("accessor")).toBeUndefined();
		expect(provider.readRepresentation("map")).toBeUndefined();
		expect(provider.readRepresentation("nan")).toBeUndefined();
		expect(getterCalls).toBe(0);
		expect(provider.getMemoryUsageSnapshot().representations.rejected).toBe(3);
	});

	it("drops a key whose replacement is rejected instead of serving the stale value", () => {
		const provider = new MemoryContextBudgetCacheProviderV2("session", 256, { representationBytes: 16 * 1024 });
		provider.writeRepresentation({ key: "k", entry: entry("small") });
		provider.writeRepresentation({ key: "k", entry: entry("x".repeat(64 * 1024)) });

		expect(provider.readRepresentation("k")).toBeUndefined();
	});

	it("bounds negative and plan entries by bytes too", () => {
		const provider = new MemoryContextBudgetCacheProviderV2("session", 256, {
			negativeBytes: 4 * 1024,
			planBytes: 8 * 1024,
		});
		for (let index = 0; index < 40; index++) {
			provider.writeNegativeRepresentation({ key: `n${index}`, reason: `reason-${"r".repeat(100)}` });
			provider.writePlan({
				key: `p${index}`,
				entry: {
					plan: { planHash: `h${index}`, notes: "p".repeat(500) } as never,
					sourceHashes: {},
					createdAtEpochMs: 1,
				},
			});
		}

		const usage = provider.getMemoryUsageSnapshot();
		expect(usage.negatives.accountedBytes).toBeLessThanOrEqual(4 * 1024);
		expect(usage.plans.accountedBytes).toBeLessThanOrEqual(8 * 1024);
		expect(provider.readNegativeRepresentation("n39")?.reason).toContain("reason-");
		expect(provider.readPlan("p39")?.entry.plan.planHash).toBe("h39");
		expect(provider.readPlan("p0")).toBeUndefined();
	});
});
