import type { AssistantMessage } from "omk-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptInputCapacityError } from "../../src/core/prompt-budget.ts";
import { getLatestCompactionEntry } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

const T = Date.parse("2026-10-26T05:44:37.336Z");
const BACKWARD_STEP_MS = 6_755;

function response(tokens: number, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	const message = fauxAssistantMessage("new answer", { stopReason, timestamp: Date.now() });
	return { ...message, usage: { ...message.usage, input: tokens, totalTokens: tokens } };
}

/** The faux provider re-prices usage from text; this stream preserves the provider's measured usage. */
function streamResponses(harness: Harness, responses: AssistantMessage[]) {
	const streamFn = vi.fn((model: Harness["models"][number]) => {
		const next = responses.shift();
		if (!next) throw new Error("unexpected provider request");
		const message = { ...next, api: model.api, provider: model.provider, model: model.id };
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({ type: "error", reason: message.stopReason, error: message });
			} else {
				stream.push({ type: "done", reason: message.stopReason, message });
			}
		});
		return stream;
	});
	harness.session.agent.streamFn = streamFn;
	return streamFn;
}

describe("assistant usage before the wall clock recovers from compaction", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		while (harnesses.length) harnesses.pop()?.cleanup();
	});

	async function compactAfterClockStep(enabled: boolean): Promise<Harness> {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T);
		const harness = await createHarness({
			settings: { compaction: { enabled, reserveTokens: 1000, keepRecentTokens: 1 } },
			models: [{ id: "clock-test", contextWindow: 200_000, maxTokens: 20_000 }],
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary after clock step",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		harnesses.push(harness);
		harness.sessionManager.appendMessage({ role: "user", content: "seed", timestamp: T - 1000 });
		harness.sessionManager.appendMessage(response(179_990));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		vi.setSystemTime(T - BACKWARD_STEP_MS);
		await harness.session.compact();
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(1);
		expect(Date.parse(getLatestCompactionEntry(harness.sessionManager.getBranch())!.timestamp)).toBeGreaterThan(T);
		// The new response arrives a second later, with 5.755s of the clock step still unrecovered.
		vi.setSystemTime(T - BACKWARD_STEP_MS + 1000);
		return harness;
	}

	it("runs threshold compaction for a new high-usage assistant while its timestamp is still earlier", async () => {
		const harness = await compactAfterClockStep(true);
		const fresh = response(150_000);
		expect(fresh.timestamp).toBeLessThan(
			Date.parse(getLatestCompactionEntry(harness.sessionManager.getBranch())!.timestamp),
		);
		const stream = streamResponses(harness, [fresh]);

		await harness.session.prompt("after compaction");

		expect(stream).toHaveBeenCalledTimes(1);
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(2);
	});

	it("rejects the next request using new measured usage when automatic compaction is disabled", async () => {
		const harness = await compactAfterClockStep(false);
		const stream = streamResponses(harness, [response(170_000), response(10)]);
		await harness.session.prompt("after compaction");
		expect(harness.session.getContextUsage()?.tokens).toBe(170_000);

		// 170k exceeds the 160k hard input ceiling despite the short visible answer.
		await expect(harness.session.prompt("next")).rejects.toBeInstanceOf(PromptInputCapacityError);
		expect(stream).toHaveBeenCalledTimes(1);
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(1);
	});

	it("compacts a projected new turn using post-compaction usage before sending it", async () => {
		const harness = await compactAfterClockStep(true);
		const stream = streamResponses(harness, [response(120_000), response(10)]);
		await harness.session.prompt("after compaction");
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(1);

		// 120k + 30k pending tokens crosses the 144k threshold without exceeding fixed input capacity.
		await harness.session.prompt("x".repeat(120_000));

		expect(stream).toHaveBeenCalledTimes(2);
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(2);
	});

	it.each([
		["529 overloaded", "threshold", false],
		["maximum context length is 200000 tokens", "overflow", true],
	] as const)("does not skip a new error after compaction: %s", async (errorMessage, reason, retry) => {
		const harness = await compactAfterClockStep(true);
		const model = harness.getModel();
		// Manual compaction disarms the normal threshold; 170k crosses the 160k emergency ceiling too.
		const fresh = { ...response(170_000), api: model.api, provider: model.provider, model: model.id };
		const error = { ...fresh, stopReason: "error" as const, errorMessage };
		harness.sessionManager.appendMessage(fresh);
		harness.sessionManager.appendMessage(error);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		const internals = harness.session as unknown as {
			_checkCompaction(message: AssistantMessage): Promise<boolean>;
			_runAutoCompaction(reason: string, retry: boolean): Promise<boolean>;
		};
		const compact = vi.spyOn(internals, "_runAutoCompaction").mockResolvedValue(false);

		await internals._checkCompaction(error);

		expect(compact).toHaveBeenCalledWith(reason, retry);
	});
});
