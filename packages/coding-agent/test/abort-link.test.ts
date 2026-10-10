import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { linkAbortSignals } from "../src/core/abort-link.ts";

describe("linkAbortSignals", () => {
	it("aborts with the reason of whichever source aborts first", () => {
		const turn = new AbortController();
		const budget = new AbortController();
		const link = linkAbortSignals(turn.signal, budget.signal);
		expect(link.signal.aborted).toBe(false);
		budget.abort(new Error("budget exhausted"));
		expect(link.signal.aborted).toBe(true);
		expect((link.signal.reason as Error).message).toBe("budget exhausted");
		turn.abort(new Error("late"));
		expect((link.signal.reason as Error).message).toBe("budget exhausted");
	});

	it("is aborted at once when a source is already aborted", () => {
		const budget = new AbortController();
		budget.abort("closed");
		const link = linkAbortSignals(new AbortController().signal, budget.signal);
		expect(link.signal.aborted).toBe(true);
		expect(link.signal.reason).toBe("closed");
	});

	it("leaves no listener on a long-lived source after dispose", () => {
		const budget = new AbortController();
		for (let i = 0; i < 1000; i++) {
			const link = linkAbortSignals(new AbortController().signal, budget.signal);
			link.signal.addEventListener("abort", () => undefined);
			link.dispose();
		}
		expect(getEventListeners(budget.signal, "abort")).toHaveLength(0);
	});

	it("unhooks both sources once it has forwarded an abort", () => {
		const turn = new AbortController();
		const budget = new AbortController();
		linkAbortSignals(turn.signal, budget.signal);
		turn.abort();
		expect(getEventListeners(budget.signal, "abort")).toHaveLength(0);
	});

	it("disposes idempotently", () => {
		const link = linkAbortSignals(new AbortController().signal, new AbortController().signal);
		link.dispose();
		expect(() => link.dispose()).not.toThrow();
	});
});
