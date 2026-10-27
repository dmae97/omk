import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateProjectedContextTokens } from "../../src/core/compaction/compaction.ts";
import { type CompactionEntry, SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

/** A WSL2 hypervisor resync observed stepping the wall clock back by this much. */
const OBSERVED_BACKWARD_STEP_MS = 6_755;
const T = Date.parse("2026-10-26T05:44:37.336Z");

function seed(session: SessionManager, assistantAt: number, totalTokens: number): string {
	const first = session.appendMessage({ ...userMsg("seed"), timestamp: assistantAt - 1000 });
	const assistant = assistantMsg("near limit");
	session.appendMessage({
		...assistant,
		timestamp: assistantAt,
		usage: { ...assistant.usage, input: totalTokens, totalTokens },
	});
	return first;
}

function latestCompaction(session: SessionManager): CompactionEntry {
	const compactions = session.getEntries().filter((entry): entry is CompactionEntry => entry.type === "compaction");
	const entry = compactions[compactions.length - 1];
	if (!entry) throw new Error("no compaction entry");
	return entry;
}

describe("compaction entry timestamp", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is never older than the messages it covers after the wall clock steps backward", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		const first = seed(session, T, 179_990);

		vi.setSystemTime(T - OBSERVED_BACKWARD_STEP_MS);
		session.appendCompaction("summary", first, 179_990);

		const compaction = latestCompaction(session);
		expect(Date.parse(compaction.timestamp)).toBeGreaterThan(T);
		// The kept assistant usage priced the compacted history, so it must be ignored as stale.
		const projected = estimateProjectedContextTokens(
			session.buildSessionContext().messages,
			[],
			compaction.timestamp,
		);
		expect(projected.tokens).toBeLessThan(1_000);
	});

	it("uses the wall clock when it is already later than every covered message", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		const first = seed(session, T, 100);

		vi.setSystemTime(T + 5_000);
		session.appendCompaction("summary", first, 100);

		expect(latestCompaction(session).timestamp).toBe(new Date(T + 5_000).toISOString());
	});

	it("does not follow a message stamped far beyond a clock step into the future", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		const first = seed(session, T + 60 * 60_000, 100);

		session.appendCompaction("summary", first, 100);

		expect(latestCompaction(session).timestamp).toBe(new Date(T).toISOString());
	});
});
