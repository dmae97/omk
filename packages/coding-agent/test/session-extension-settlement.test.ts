import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { SessionExtensionSettlement } from "../src/core/session-extension-settlement.ts";
import { SessionShutdown } from "../src/core/session-shutdown.ts";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("extension settlement ownership", () => {
	it.each([false, true])(
		"keeps original shutdown obligations across accounting retries, drain fails=%s",
		async (drainFails) => {
			const shutdown = new SessionShutdown();
			const stopError = new Error("original stop failed");
			const receiptError = new Error("receipt retry required");
			const drainError = new Error("original independent drain failed");
			const stop = vi.fn(() => {
				throw stopError;
			});
			const drain = vi.fn(async () => {
				if (drainFails) throw drainError;
			});
			const recover = vi.fn().mockRejectedValueOnce(receiptError).mockResolvedValue(undefined);
			const finalize = vi.fn();
			const first = shutdown.close(stop, drain, finalize, recover);
			expect(shutdown.close(stop, drain, finalize, recover)).toBe(first);
			await expect(first).rejects.toMatchObject({ errors: [stopError, receiptError] });
			expect(drain).not.toHaveBeenCalled();
			expect(finalize).not.toHaveBeenCalled();
			expect(() => shutdown.assertOpen()).toThrow("closing or closed");
			const replacementDrain = vi.fn(async () => {});
			const second = shutdown.close(stop, replacementDrain, finalize, recover);
			expect(shutdown.close(stop, replacementDrain, finalize, recover)).toBe(second);
			if (drainFails) await expect(second).rejects.toMatchObject({ errors: [stopError, drainError] });
			else await expect(second).rejects.toBe(stopError);
			expect(stop).toHaveBeenCalledOnce();
			expect(drain).toHaveBeenCalledOnce();
			expect(replacementDrain).not.toHaveBeenCalled();
			expect(recover).toHaveBeenCalledTimes(2);
			expect(finalize).toHaveBeenCalledTimes(drainFails ? 0 : 1);
			expect(shutdown.close(stop, replacementDrain, finalize, recover)).toBe(second);
		},
	);
	it("observes a rejected producer while a retained failure remains primary", async () => {
		const owner = new SessionExtensionSettlement();
		const failure = new Error("retained receipt failure");
		await expect(
			owner.start(
				{ type: "agent_settled", messages: [], aborted: false },
				async (operation) => operation(),
				async () => {
					throw failure;
				},
				() => {},
				() => {},
			),
		).rejects.toBe(failure);
		await expect(owner.observe(Promise.reject(new Error("new producer refused")))).rejects.toBe(failure);
	});
	it.each([1, 3])("retains one original envelope through %i failures and concurrent recovery", async (failures) => {
		const owner = new SessionExtensionSettlement();
		owner.begin("retained-run");
		const message = fauxAssistantMessage("original");
		owner.record(message);
		const event = owner.snapshot(false);
		const failure = new Error("receipt rejected");
		const delivered: unknown[] = [];
		let attempts = 0;
		let deferredRuns = 0;
		owner.start(
			event,
			async (operation) => operation(),
			async (actual) => {
				expect(owner.wait()).toBeUndefined();
				if (attempts++ === 0)
					owner.defer(async () => {
						deferredRuns++;
					});
				if (attempts <= failures) throw failure;
				delivered.push(actual);
			},
			() => {},
			() => {},
		);
		await expect(owner.wait()).rejects.toBe(failure);
		owner.finish();
		for (let remaining = 1; remaining < failures; remaining++) {
			await expect(owner.recover()).rejects.toBe(failure);
		}
		expect(owner.unsettled).toBe(true);
		expect(owner.snapshot(true)).toBe(event);
		expect(event.messages[0]).toBe(message);
		expect(() => owner.begin("replacement")).toThrow();
		owner.abort();
		await owner.after(Promise.resolve(), () => false);
		expect(deferredRuns).toBe(0);
		await Promise.all([owner.recover(), owner.recover()]);
		expect(attempts).toBe(failures + 1);
		expect(delivered).toEqual([event]);
		expect(owner.unsettled).toBe(false);
		await owner.after(Promise.resolve(), () => false);
		expect(deferredRuns).toBe(1);
	});
	it("cancels and drains the active handler without leaking its signal to the next run", async () => {
		const owner = new SessionExtensionSettlement();
		const entered = deferred();
		const release = deferred();
		owner.start(
			{ type: "agent_settled", messages: [], aborted: false },
			async (operation) => operation(),
			async () => {
				entered.resolve();
				await release.promise;
			},
			() => {},
			(error) => {
				throw error;
			},
		);
		await entered.promise;
		const signal = owner.signal;
		expect(signal?.aborted).toBe(false);
		expect(owner.wait()).toBeInstanceOf(Promise);
		expect(owner.abort()).toBe(true);
		expect(signal?.aborted).toBe(true);
		expect(owner.busy).toBe(true);
		release.resolve();
		await owner.wait();
		expect(owner.busy).toBe(false);
		expect(owner.signal).toBeUndefined();
		expect(owner.abort()).toBe(false);
	});

	it("defers only the active handler's async chain, not unrelated or late input", async () => {
		const owner = new SessionExtensionSettlement();
		const entered = deferred();
		const release = deferred();
		let late: (() => boolean) | undefined;
		let ran = 0;
		owner.start(
			{ type: "agent_settled", messages: [], aborted: false },
			async (operation) => operation(),
			async () => {
				expect(owner.wait()).toBeUndefined();
				expect(
					owner.defer(async () => {
						ran++;
					}),
				).toBe(true);
				late = () =>
					owner.defer(async () => {
						ran++;
					});
				entered.resolve();
				await release.promise;
			},
			() => {},
			(error) => {
				throw error;
			},
		);
		await entered.promise;
		expect(owner.defer(async () => {})).toBe(false);
		release.resolve();
		await owner.wait();
		expect(late?.()).toBe(false);
		await owner.after(Promise.resolve(), () => false);
		expect(ran).toBe(1);
	});

	it("does not run deferred work while another session owner is still busy", async () => {
		const owner = new SessionExtensionSettlement();
		let ran = 0;
		owner.start(
			{ type: "agent_settled", messages: [], aborted: false },
			async (operation) => operation(),
			async () => {
				owner.defer(async () => {
					ran++;
				});
			},
			() => {},
			(error) => {
				throw error;
			},
		);
		await owner.wait();
		await owner.after(Promise.resolve(), () => true);
		expect(ran).toBe(0);
		await owner.after(Promise.resolve(), () => false);
		expect(ran).toBe(1);
	});
});
