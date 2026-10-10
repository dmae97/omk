import { getEventListeners } from "node:events";
import type { StreamFn } from "omk-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, registerFauxProvider } from "omk-ai";
import { describe, expect, it } from "vitest";
import { wrapBudgetStream } from "../src/core/budget-stream.ts";
import { RunBudget } from "../src/core/run-budget.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("budget stream abort forwarding", () => {
	it.each(["turn", "budget"] as const)("hands a %s abort and its reason to the provider request", async (origin) => {
		const faux = registerFauxProvider();
		const budget = new RunBudget({ maxRequests: 10 }, () => {});
		const turn = new AbortController();
		const stream = createAssistantMessageEventStream();
		let seen: AbortSignal | undefined;
		const source: StreamFn = (_model, _context, options) => {
			seen = options?.signal;
			return stream;
		};
		try {
			await wrapBudgetStream(source, budget)(faux.getModel(), { messages: [] }, { signal: turn.signal });
			expect(seen?.aborted).toBe(false);
			if (origin === "turn") turn.abort(new Error("user stop"));
			else budget.close();
			expect(seen?.aborted).toBe(true);
			expect(seen?.reason).toBe(origin === "turn" ? turn.signal.reason : budget.signal.reason);
		} finally {
			stream.end(fauxAssistantMessage("done"));
			budget.close();
			faux.unregister();
		}
	});

	it("removes its listeners after success, a failed result and a failed dispatch", async () => {
		const faux = registerFauxProvider();
		const budget = new RunBudget({ maxRequests: 10 }, () => {});
		const turn = new AbortController();
		const succeeded = createAssistantMessageEventStream();
		const failed = createAssistantMessageEventStream();
		failed.result = () => Promise.reject(new Error("terminal metadata lost"));
		const sources: StreamFn[] = [
			() => succeeded,
			() => failed,
			() => {
				throw new Error("dispatch failed");
			},
		];
		const wrapped = sources.map((source) => wrapBudgetStream(source, budget));
		const listeners = () =>
			getEventListeners(turn.signal, "abort").length + getEventListeners(budget.signal, "abort").length;
		const before = listeners();
		try {
			await wrapped[0](faux.getModel(), { messages: [] }, { signal: turn.signal });
			expect(listeners()).toBeGreaterThan(before);
			succeeded.end(fauxAssistantMessage("done"));
			await flush();
			expect(listeners()).toBe(before);
			await wrapped[1](faux.getModel(), { messages: [] }, { signal: turn.signal });
			await flush();
			expect(listeners()).toBe(before);
			await expect(wrapped[2](faux.getModel(), { messages: [] }, { signal: turn.signal })).rejects.toThrow(
				"dispatch failed",
			);
			expect(listeners()).toBe(before);
		} finally {
			budget.close();
			faux.unregister();
		}
	});
});
