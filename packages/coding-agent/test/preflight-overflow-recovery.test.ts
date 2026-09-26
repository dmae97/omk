/**
 * The admission gate refuses a turn before any provider call, and the
 * compaction decision reads a different estimator than the gate — so a session
 * can sit in the refusal band with no automatic way out. `admitSessionInputOrRecover`
 * runs one bounded recovery (the caller's overflow compaction) and re-checks;
 * a still-over input keeps the refusal instead of silently continuing.
 */
import type { AgentMessage, AgentState } from "omk-agent-core";
import type { Model } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { createTokenCounterForMode } from "../src/core/context-budget-token-counter.ts";
import { PromptInputCapacityError } from "../src/core/prompt-budget.ts";
import { admitSessionInputOrRecover } from "../src/core/session-input-admission.ts";

const MODEL = { provider: "devin", id: "swe-2", contextWindow: 1000, maxTokens: 200 } as unknown as Model<any>;

function bigText(chars: number): string {
	return "x".repeat(chars);
}

function makeInput(pending: AgentMessage[]) {
	const state: Pick<AgentState, "systemPrompt" | "messages" | "tools"> = {
		systemPrompt: "",
		messages: [],
		tools: [],
	};
	return {
		state,
		input: {
			model: MODEL,
			state,
			pending,
			effectiveWindow: (window: number, pendingMessages: AgentMessage[]) =>
				// The list is passed back so callers need not capture it.
				pendingMessages === pending ? window : 0,
			counter: createTokenCounterForMode("fallback"),
		},
	};
}

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 } as unknown as AgentMessage;
}

describe("admitSessionInputOrRecover", () => {
	it("admits without recovering when the input already fits", async () => {
		const pending: AgentMessage[] = [userMessage("hi")];
		const { input } = makeInput(pending);
		const recover = vi.fn(() => false);

		await expect(admitSessionInputOrRecover({ ...input, recover })).resolves.toBeUndefined();
		expect(recover).not.toHaveBeenCalled();
	});

	it("recovers once and re-checks when the input is over capacity", async () => {
		const pending: AgentMessage[] = [userMessage(bigText(20_000))];
		const { input } = makeInput(pending);
		const recover = vi.fn(() => {
			pending.length = 0;
			return true;
		});

		await expect(admitSessionInputOrRecover({ ...input, recover })).resolves.toBeUndefined();
		expect(recover).toHaveBeenCalledTimes(1);
	});

	it("keeps the post-recovery refusal when recovery did not free enough", async () => {
		const pending: AgentMessage[] = [userMessage(bigText(20_000))];
		const { input } = makeInput(pending);

		await expect(admitSessionInputOrRecover({ ...input, recover: () => true })).rejects.toBeInstanceOf(
			PromptInputCapacityError,
		);
	});

	it("throws the original refusal when recovery reports failure", async () => {
		const pending: AgentMessage[] = [userMessage(bigText(20_000))];
		const { input } = makeInput(pending);
		let original: unknown;
		try {
			await admitSessionInputOrRecover({ ...input, recover: () => false });
			throw new Error("expected a refusal");
		} catch (error) {
			original = error;
		}

		expect(original).toBeInstanceOf(PromptInputCapacityError);
	});
});
