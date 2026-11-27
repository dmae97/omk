import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTokenCounterForMode } from "../src/core/context-budget-token-counter.ts";
import { memoryFreshnessDecay } from "../src/core/verified-memory-score.ts";
import { selectMemoryContext } from "../src/core/verified-memory-selection.ts";
import { MAX_MEMORY_RECORDS, VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";

let root: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "omk-p2-ltm-")));
	writeFileSync(
		join(root, "guide.md"),
		`${Array.from({ length: 45 }, (_, i) => `line ${i + 1}: auth token refresh policy rule ${i + 1}`).join("\n")}\n`,
	);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("P2-2: selective retrieval decay & automatic forgetting in VerifiedMemoryStore", () => {
	it("decays freshness monotonically and prefers fresher verified memories at equal lexical match", () => {
		const fresh = memoryFreshnessDecay({ createdAt: 1000, expiresAt: 11_000 }, 2000);
		const aging = memoryFreshnessDecay({ createdAt: 1000, expiresAt: 11_000 }, 10_000);
		const expired = memoryFreshnessDecay({ createdAt: 1000, expiresAt: 11_000 }, 11_000);

		expect(fresh).toBeGreaterThan(aging);
		expect(aging).toBeGreaterThan(0);
		expect(expired).toBe(0);

		const counter = createTokenCounterForMode("fallback");
		const memStore = new VerifiedMemoryStore(root);
		expect(memStore.remember({ path: "guide.md", startLine: 1, endLine: 1 }).verdict).toBe("accept");
		expect(memStore.remember({ path: "guide.md", startLine: 2, endLine: 2 }).verdict).toBe("accept");
		const [rec1, rec2] = memStore.retrieve().records;
		const olderRec = { ...rec1, id: "mem-a-older", createdAt: 1000, expiresAt: 11_000 };
		const newerRec = { ...rec2, id: "mem-z-newer", createdAt: 9000, expiresAt: 19_000 };

		// Tight budget fits only one record; with nowMs=10_500 the fresher record must win despite id order.
		const oneSize = selectMemoryContext(
			[newerRec],
			10_000,
			"auth token refresh",
			counter,
			"test-model",
			undefined,
			10_500,
		);
		expect(oneSize.selected).toBe(1);
		const oneBudget = counter.countText(JSON.stringify(oneSize.messages), "test-model").tokens;
		const picked = selectMemoryContext(
			[olderRec, newerRec],
			oneBudget + 5,
			"auth token refresh",
			counter,
			"test-model",
			undefined,
			10_500,
		);
		expect(picked.selected).toBe(1);
		expect(JSON.stringify(picked.messages)).toContain("mem-z-newer");
		expect(JSON.stringify(picked.messages)).not.toContain("mem-a-older");
	});

	it("prunes revoked and stale records automatically so remember() admits new facts instead of stalling at MAX_MEMORY_RECORDS", () => {
		const store = new VerifiedMemoryStore(root);
		const now = Date.now();
		const ids: string[] = [];
		for (let i = 1; i <= MAX_MEMORY_RECORDS; i += 1) {
			const res = store.remember({
				path: "guide.md",
				startLine: i,
				endLine: i,
			});
			expect(res.verdict).toBe("accept");
			if (res.verdict === "accept") ids.push(res.recordId);
		}

		// Revoke one record; store has 32 files on disk including the revoked one.
		store.forget(ids[0]);

		// Without selective forgetting, remember() would abstain with "record-limit".
		const admitted = store.remember({
			path: "guide.md",
			startLine: MAX_MEMORY_RECORDS + 1,
			endLine: MAX_MEMORY_RECORDS + 1,
		});
		expect(admitted.verdict).toBe("accept");

		// Explicit prune on future timestamp reclaims all expired entries cleanly.
		const pruned = store.prune(now + 365 * 24 * 60 * 60 * 1000);
		expect(pruned.removedExpired).toBe(MAX_MEMORY_RECORDS);
		expect(pruned.kept).toBe(0);
	});
});
