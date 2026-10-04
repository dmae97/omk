import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { phase3Gate } from "../fixtures/phase3-gate.ts";
import { createHarness } from "./harness.ts";

describe("compaction publication boundary", () => {
	it("reserves admission before yielding and refuses a competing compaction", async () => {
		const entered = phase3Gate<void>();
		const release = phase3Gate<void>();
		const h = await createHarness({
			persistSession: true,
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(api) =>
					api.on("session_before_compact", async (event) => {
						entered.resolve();
						await release.promise;
						return {
							compaction: {
								summary: "fixture summary",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					}),
			],
		});
		await h.session.bindExtensions({});
		for (let index = 0; index < 2; index++) {
			h.sessionManager.appendMessage({ role: "user", content: `fixture-${index}`, timestamp: index });
			h.sessionManager.appendMessage(fauxAssistantMessage(`history-${index}`));
		}
		h.session.agent.state.messages = h.sessionManager.buildSessionContext().messages;
		const compact = h.session.compact();
		try {
			await expect(h.session.compact()).rejects.toThrow(/already in progress/);
			await entered.promise;
			await expect(h.session.prompt("must not dispatch")).rejects.toThrow(/compaction is in progress/);
			release.resolve();
			expect((await compact).summary).toBe("fixture summary");
		} finally {
			release.resolve();
			await compact;
			await h.session.close();
			h.cleanup();
		}
	});

	it.each(["stop", "aborted"] as const)("does not commit an unusable %s result", async (stopReason) => {
		const h = await createHarness({ persistSession: true, settings: { compaction: { keepRecentTokens: 1 } } });
		try {
			for (let index = 0; index < 2; index++) {
				h.sessionManager.appendMessage({ role: "user", content: `fixture-${index}`, timestamp: index * 2 });
				h.sessionManager.appendMessage(fauxAssistantMessage(`history-${index}`));
			}
			h.session.agent.state.messages = h.sessionManager.buildSessionContext().messages;
			const invalid = fauxAssistantMessage(stopReason === "aborted" ? "partial summary" : "", { stopReason });
			h.setResponses([invalid, invalid]);
			await expect(h.session.compact()).rejects.toThrow(stopReason === "aborted" ? /abort/i : /empty summary/);
			expect(h.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toEqual([]);
			expect(h.session.lastTermination?.causeCode).toBe(
				stopReason === "aborted" ? "compaction.aborted" : "compaction.failed",
			);
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});
});
