import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, getModel } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateProjectedContextTokens } from "../../src/core/compaction/compaction.ts";
import { estimateNextTurnContextTokens } from "../../src/core/compaction/reasoning-drop.ts";
import { getCompactionUsageBoundary } from "../../src/core/compaction-entry-time.ts";
import { createTokenCounterForMode } from "../../src/core/context-budget-token-counter.ts";
import { admitSessionInput, CompactedPromptInputCapacityError } from "../../src/core/session-input-admission.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

const T = Date.parse("2026-10-26T05:44:37.336Z");
const ROLLED_BACK = T - 6_755;

function assistantAt(timestamp: number, tokens: number): AssistantMessage {
	const message = assistantMsg("answer");
	return { ...message, timestamp, usage: { ...message.usage, input: tokens, output: 0, totalTokens: tokens } };
}

function seed(session: SessionManager) {
	const first = session.appendMessage({ ...userMsg("seed"), timestamp: T - 1000 });
	const last = session.appendMessage(assistantAt(T, 179_990));
	vi.setSystemTime(ROLLED_BACK);
	const compaction = session.appendCompaction("summary", first, 179_990);
	return { first, last, compaction };
}

function projected(session: SessionManager) {
	return estimateProjectedContextTokens(
		session.buildSessionContext().messages,
		[],
		getCompactionUsageBoundary(session.getBranch()),
	);
}

describe("compaction usage boundary in branch order", () => {
	const dirs: string[] = [];
	afterEach(() => {
		vi.useRealTimers();
		while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
	});

	it.each([ROLLED_BACK + 1000, T + 1])("keeps new usage stamped %s, earlier than or equal to compaction", (at) => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		seed(session);
		expect(projected(session).usageTokens).toBe(0);
		const fresh = assistantAt(at, 12_345);
		fresh.content.unshift({ type: "thinking", thinking: "t".repeat(40) });
		session.appendMessage(fresh);
		expect(projected(session)).toMatchObject({ tokens: 12_345, usageTokens: 12_345, trailingTokens: 0 });
		expect(fresh.timestamp).toBe(at);
		expect(
			estimateNextTurnContextTokens(
				session.buildSessionContext().messages,
				[userMsg("next")],
				getCompactionUsageBoundary(session.getBranch()),
			),
		).toMatchObject({ usageTokens: 12_335, trailingTokens: 1, tokens: 12_336 });
	});

	it("reconstructs the boundary from persisted entries on resume", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const dir = mkdtempSync(join(tmpdir(), "compaction-usage-clock-"));
		dirs.push(dir);
		const session = SessionManager.create(dir, dir);
		seed(session);
		session.appendMessage(assistantAt(ROLLED_BACK + 1000, 12_345));
		const reopened = SessionManager.open(session.getSessionFile()!, dir);
		expect(projected(reopened)).toMatchObject({ tokens: 12_345, usageTokens: 12_345 });
	});

	it("uses the active branch and distinguishes repeated compactions with identical timestamps", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		const { first, last, compaction } = seed(session);
		const freshId = session.appendMessage(assistantAt(ROLLED_BACK + 1000, 12_345));
		const originalBoundary = getCompactionUsageBoundary(session.getBranch())!;
		session.branch(last);
		expect(getCompactionUsageBoundary(session.getBranch())).toBeUndefined();
		expect(projected(session).usageTokens).toBe(179_990);
		session.appendCompaction("sibling summary", first, 179_990);
		expect(projected(session).usageTokens).toBe(0);
		session.branch(freshId);
		expect(getCompactionUsageBoundary(session.getBranch())?.id).toBe(compaction);
		expect(projected(session).usageTokens).toBe(12_345);
		session.appendCompaction("second summary", first, 12_345);
		const nextBoundary = getCompactionUsageBoundary(session.getBranch())!;
		expect(nextBoundary.timestamp).toBe(originalBoundary.timestamp);
		expect(nextBoundary.id).not.toBe(originalBoundary.id);
		expect(projected(session).usageTokens).toBe(0);
		session.appendMessage(assistantAt(ROLLED_BACK + 2000, 20_000));
		expect(projected(session).usageTokens).toBe(20_000);
	});

	it("reports committed recovery when input still exceeds capacity after a compaction at the same timestamp", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const session = SessionManager.inMemory();
		const first = session.appendMessage({ ...userMsg("x".repeat(700_000)), timestamp: T - 1000 });
		session.appendMessage(assistantAt(T, 179_990));
		vi.setSystemTime(ROLLED_BACK);
		session.appendCompaction("summary", first, 179_990);
		const before = getCompactionUsageBoundary(session.getBranch())!;
		session.appendMessage(assistantAt(ROLLED_BACK + 1000, 170_000));
		const model = { ...getModel("anthropic", "claude-sonnet-4-5")!, contextWindow: 200_000, maxTokens: 20_000 };

		await expect(
			admitSessionInput(
				() => ({
					model,
					state: { systemPrompt: "", tools: [], messages: session.buildSessionContext().messages },
					pending: [userMsg("next")],
					effectiveWindow: (window) => window,
					counter: createTokenCounterForMode("fallback"),
					latestCompactionTimestamp: getCompactionUsageBoundary(session.getBranch())?.timestamp,
					compactionUsageBoundary: getCompactionUsageBoundary(session.getBranch()),
				}),
				async () => {
					session.appendCompaction("retained history still too large", first, 170_000);
				},
			),
		).rejects.toBeInstanceOf(CompactedPromptInputCapacityError);
		expect(getCompactionUsageBoundary(session.getBranch())?.timestamp).toBe(before.timestamp);
		expect(getCompactionUsageBoundary(session.getBranch())?.id).not.toBe(before.id);
	});
});
