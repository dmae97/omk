import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { SessionShutdown } from "../src/core/session-shutdown.ts";
import { phase3Gate } from "./fixtures/phase3-gate.ts";

type Source = Parameters<SessionShutdown["closeSession"]>[0];
type Owned = Parameters<SessionShutdown["closeSession"]>[1];

function fixture(fault?: string) {
	const calls: string[] = [];
	const error = new Error(fault);
	const step = (name: string) => () => {
		calls.push(name);
		if (name === fault) throw error;
	};
	const source = {
		abortRetry: step("retry"),
		abortCompaction: step("compaction"),
		abortBranchSummary: step("summary"),
		abortBash: step("bash"),
		clearQueue: step("queue"),
		agent: { abort: step("agent"), waitForIdle: async () => step("agent-idle")() },
	} as Source;
	const owned = {
		budget: { close: step("budget"), waitForIdle: async () => step("budget-idle")() },
		lifecycle: { waitForIdle: async () => step("lifecycle-idle")() },
		mcp: { close: step("mcp"), closeAndWait: async () => step("mcp-idle")() },
		control: Promise.resolve({ close: async () => step("control")() }),
	} as Owned;
	return { calls, error, source, owned };
}

describe("fault-preserving session shutdown", () => {
	it.each(["budget", "retry", "compaction", "summary", "bash", "agent", "mcp"])(
		"attempts independent stops and drains after %s throws",
		async (fault) => {
			const { calls, error, source, owned } = fixture(fault);
			const shutdown = new SessionShutdown();
			const finalize = vi.fn();
			const close = shutdown.closeSession(source, owned, finalize);
			expect(shutdown.isClosing).toBe(true);
			expect(shutdown.closeSession(source, owned, finalize)).toBe(close);
			await expect(close).rejects.toBe(error);
			for (const name of [
				"budget",
				"retry",
				"compaction",
				"summary",
				"bash",
				"agent",
				"queue",
				"mcp",
				"control",
				"agent-idle",
				"budget-idle",
				"lifecycle-idle",
				"mcp-idle",
			])
				expect(calls).toContain(name);
			expect(finalize).toHaveBeenCalledOnce();
		},
	);

	it("does not reject or finalize ahead of a started producer after stop throws", async () => {
		const shutdown = new SessionShutdown();
		const producer = phase3Gate<void>();
		const work = shutdown.run(() => producer.promise);
		const error = new Error("stop");
		const drain = vi.fn(async () => {});
		const finalize = vi.fn();
		const close = shutdown.close(
			() => {
				throw error;
			},
			drain,
			finalize,
		);
		let settled = false;
		const observed = close.catch((reason) => {
			settled = true;
			return reason;
		});
		await setImmediate();
		const early = settled;
		producer.resolve();
		await work;
		expect(await observed).toBe(error);
		expect(early).toBe(false);
		expect(drain).toHaveBeenCalledOnce();
		expect(finalize).toHaveBeenCalledOnce();
	});

	it.each(["agent-idle", "lifecycle-idle", "budget-idle", "control"])(
		"drains independent obligations after %s fails without releasing unconfirmed ownership",
		async (fault) => {
			const { source, owned, error } = fixture(fault);
			const physical = phase3Gate<void>();
			if (!owned.mcp) throw new Error("missing fixture mcp");
			owned.mcp.closeAndWait = () => physical.promise;
			const finalize = vi.fn();
			const close = new SessionShutdown().closeSession(source, owned, finalize);
			let settled = false;
			const observed = close.catch((reason) => {
				settled = true;
				return reason;
			});
			await setImmediate();
			const early = settled;
			physical.resolve();
			expect(await observed).toBe(error);
			expect(early).toBe(false);
			expect(finalize).not.toHaveBeenCalled();
		},
	);

	it("observes one control-server close without retrying away its first rejection", async () => {
		const { source, owned } = fixture();
		const fault = new Error("control close");
		const closeControl = vi.fn().mockRejectedValueOnce(fault).mockResolvedValue(undefined);
		const control = Promise.resolve({ close: closeControl }) as Owned["control"];
		const finalize = vi.fn();
		await expect(new SessionShutdown().closeSession(source, { ...owned, control }, finalize)).rejects.toBe(fault);
		expect(closeControl).toHaveBeenCalledOnce();
		expect(finalize).not.toHaveBeenCalled();
	});

	it("preserves every independent failure and never finalizes a failed drain", async () => {
		const stopError = new Error("stop");
		const drainError = new Error("drain");
		const finalize = vi.fn();
		const close = new SessionShutdown().close(
			() => {
				throw stopError;
			},
			async () => {
				throw drainError;
			},
			finalize,
		);
		await expect(close).rejects.toMatchObject({ errors: [stopError, drainError] });
		expect(finalize).not.toHaveBeenCalled();
	});

	it("keeps admission closed and exposes the shared promise during a reentrant stop", async () => {
		const shutdown = new SessionShutdown();
		const finalize = vi.fn();
		let reentrant: Promise<void> | undefined;
		const close = shutdown.close(
			() => {
				reentrant = shutdown.close(
					() => {
						throw new Error("second stop");
					},
					async () => {},
					finalize,
				);
				expect(() => shutdown.assertOpen()).toThrow("closing");
			},
			async () => {},
			finalize,
		);
		await close;
		expect(reentrant).toBe(close);
		expect(finalize).toHaveBeenCalledOnce();
	});

	it("rejects self-close without poisoning the later external close", async () => {
		const shutdown = new SessionShutdown();
		const finalize = vi.fn();
		await shutdown.run(async () => {
			await expect(
				shutdown.close(
					() => {},
					async () => {},
					finalize,
				),
			).rejects.toThrow("own active operation");
		});
		await shutdown.close(
			() => {},
			async () => {},
			finalize,
		);
		expect(finalize).toHaveBeenCalledOnce();
	});
});
