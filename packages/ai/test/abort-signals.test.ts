import { describe, expect, it } from "vitest";
import { combineAbortSignals } from "../src/utils/abort-signals.ts";

describe("combineAbortSignals", () => {
	it("returns no signal when every input is undefined", () => {
		const combined = combineAbortSignals([undefined, undefined]);

		expect(combined.signal).toBeUndefined();
		expect(() => combined.cleanup()).not.toThrow();
	});

	it("returns the original signal when it is the only defined input", () => {
		const controller = new AbortController();
		const combined = combineAbortSignals([undefined, controller.signal]);

		expect(combined.signal).toBe(controller.signal);
		combined.cleanup();

		const reason = new Error("caller canceled");
		controller.abort(reason);
		expect(combined.signal?.reason).toBe(reason);
	});

	it.each(["first", "second"] as const)("forwards aborts from the %s signal with its reason", (source) => {
		const first = new AbortController();
		const second = new AbortController();
		const combined = combineAbortSignals([first.signal, second.signal]);
		const reason = new Error(`${source} canceled`);

		(source === "first" ? first : second).abort(reason);

		expect(combined.signal?.aborted).toBe(true);
		expect(combined.signal?.reason).toBe(reason);
	});

	it("is immediately aborted when an input was already aborted", () => {
		const active = new AbortController();
		const alreadyAborted = new AbortController();
		const reason = new Error("already canceled");
		alreadyAborted.abort(reason);

		const combined = combineAbortSignals([active.signal, alreadyAborted.signal]);

		expect(combined.signal?.aborted).toBe(true);
		expect(combined.signal?.reason).toBe(reason);
		combined.cleanup();
	});

	it("stops forwarding input aborts after cleanup", () => {
		const first = new AbortController();
		const second = new AbortController();
		const combined = combineAbortSignals([first.signal, second.signal]);

		combined.cleanup();
		first.abort();
		second.abort();

		expect(combined.signal?.aborted).toBe(false);
	});
});
