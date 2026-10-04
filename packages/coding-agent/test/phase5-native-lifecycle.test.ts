/**
 * Native lifecycle receipt for the Phase 5 request-admission and run-budget boundary.
 *
 * The delivered audit bundle validated selected sources against declared seams. This
 * test drives the real AgentSession instead: real SessionRunBudget wiring, the real
 * compaction transaction and the real shutdown path against a faux provider. The
 * receipt records only what this run observed; it is not a provider or billing proof.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

type BudgetObservation = {
	readonly activeRequests: number;
	readonly requestAdmission?: {
		readonly inspected: number;
		readonly admitted: number;
		readonly wouldReject: number;
		readonly denied: number;
		readonly unmeasured: number;
	};
};

type SessionInternals = { _runBudget: { snapshot(): BudgetObservation | undefined } };

function budgetOf(harness: Harness): BudgetObservation | undefined {
	return (harness.session as unknown as SessionInternals)._runBudget.snapshot();
}

/** Real transcript plus the real compaction cut point; no stream substitution. */
function seedCompactableSession(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({ role: "user", content: "message to compact", timestamp: now - 1000 });
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("acknowledged"),
		timestamp: now - 500,
	});
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function sessionFileOf(harness: Harness): string {
	const file = harness.session.sessionFile;
	if (!file) throw new Error("persisted harness session has no file");
	return file;
}

function readSessionEntries(file: string): Array<{ type?: string }> {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as { type?: string });
}

describe("native AgentSession lifecycle receipt", () => {
	it("settles the real budget wrapper and keeps the admission guard observed", async () => {
		const harness = await createHarness({ persistSession: true });
		try {
			harness.setResponses([fauxAssistantMessage("offline reply")]);
			const streamBefore = harness.session.agent.streamFn;
			await harness.session.prompt("native receipt prompt");
			const snapshot = budgetOf(harness);
			expect(snapshot?.activeRequests).toBe(0);
			expect(snapshot?.requestAdmission?.inspected ?? 0).toBeGreaterThanOrEqual(1);
			expect(snapshot?.requestAdmission?.denied ?? 0).toBe(0);
			expect(harness.session.agent.streamFn).toBe(streamBefore);
			expect(harness.getPendingResponseCount()).toBe(0);
		} finally {
			await harness.session.close();
			harness.cleanup();
		}
	});

	it("commits a native compaction, survives shutdown and records the receipt", async () => {
		const harness = await createHarness({ persistSession: true });
		let closed = false;
		try {
			seedCompactableSession(harness);
			harness.setResponses([fauxAssistantMessage("turn reply"), fauxAssistantMessage("native summary")]);
			const streamBefore = harness.session.agent.streamFn;
			await harness.session.prompt("compactable turn");
			const afterPrompt = budgetOf(harness);
			expect(afterPrompt?.activeRequests).toBe(0);
			expect(afterPrompt?.requestAdmission?.inspected ?? 0).toBeGreaterThanOrEqual(1);
			const result = await harness.session.compact();
			const compaction = harness.sessionManager.getEntries().find((entry) => entry.type === "compaction");
			expect(result.summary).toBe("native summary");
			expect(compaction).toBeDefined();
			expect(harness.session.messages[0]?.role).toBe("compactionSummary");
			// Manual compaction hands off through abortAndJoin, so the settled scope must stay idle.
			expect(budgetOf(harness)?.activeRequests).toBe(0);
			expect(harness.session.agent.streamFn).toBe(streamBefore);

			const file = sessionFileOf(harness);
			await harness.session.close();
			closed = true;
			const persisted = readSessionEntries(file);
			expect(persisted.some((entry) => entry.type === "compaction")).toBe(true);

			const snapshot = budgetOf(harness);
			const receipt = {
				schema: "omk.phase5.native-lifecycle-receipt.v1",
				baseline: "935b4882763feb1da46e5f8ccaef05624190b135",
				sessionId: harness.session.sessionId,
				compactionEntryId: compaction?.id,
				summary: result.summary,
				budgetScopePresent: snapshot !== undefined,
				activeRequestsAfterShutdown: snapshot?.activeRequests,
				admissionInspected: snapshot?.requestAdmission?.inspected ?? 0,
				admissionDenied: snapshot?.requestAdmission?.denied ?? 0,
				wrapperRestored: harness.session.agent.streamFn === streamBefore,
				persistedCompactionEntries: persisted.filter((entry) => entry.type === "compaction").length,
			} as const;
			const receiptPath = join(harness.tempDir, "phase5-native-lifecycle-receipt.json");
			const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
			writeFileSync(receiptPath, serialized);
			// Optional durable copy for audit bundles; tests stay hermetic without it.
			// Note: OMK_* is scrubbed by test/setup-env.ts, so the opt-in key has no prefix.
			const receiptDir = process.env.PHASE5_RECEIPT_DIR;
			if (receiptDir) writeFileSync(join(receiptDir, "phase5-native-lifecycle-receipt.json"), serialized);
			expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual(receipt);
		} finally {
			if (!closed) await harness.session.close();
			harness.cleanup();
		}
	});

	it("does not leak a reservation across compaction handoff from an idle session", async () => {
		const harness = await createHarness({ persistSession: true });
		try {
			seedCompactableSession(harness);
			harness.setResponses([
				fauxAssistantMessage("turn reply"),
				fauxAssistantMessage("first summary"),
				fauxAssistantMessage("second summary"),
			]);
			await harness.session.prompt("compactable turn");
			expect(budgetOf(harness)?.activeRequests).toBe(0);
			await harness.session.compact();
			const afterFirst = budgetOf(harness)?.activeRequests ?? 0;
			harness.sessionManager.appendMessage({ role: "user", content: "more context", timestamp: Date.now() });
			harness.sessionManager.appendMessage({ ...fauxAssistantMessage("more reply"), timestamp: Date.now() });
			harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
			await harness.session.compact();
			expect(afterFirst).toBe(0);
			expect(budgetOf(harness)?.activeRequests ?? 0).toBe(0);
		} finally {
			await harness.session.close();
			harness.cleanup();
		}
	});
});
