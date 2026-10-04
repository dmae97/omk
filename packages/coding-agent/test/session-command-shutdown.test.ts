import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { SessionShutdown } from "../src/core/session-shutdown.ts";
import { phase3Gate } from "./fixtures/phase3-gate.ts";

describe("registered command shutdown handoff", () => {
	it("releases only its command control frame before joining other producers", async () => {
		const shutdown = new SessionShutdown();
		const other = phase3Gate<void>();
		const ordinary = shutdown.run(() => other.promise);
		const finalize = vi.fn();
		const command = shutdown.run(() =>
			shutdown.runCommand(async () => {
				const close = shutdown.close(
					() => {},
					async () => {},
					finalize,
				);
				expect(shutdown.closedByCommand).toBe(true);
				await close;
			}),
		);
		await setImmediate();
		expect(finalize).not.toHaveBeenCalled();
		expect(() => shutdown.assertOpen()).toThrow("closing");
		other.resolve();
		await ordinary;
		await command;
		expect(finalize).toHaveBeenCalledOnce();
	});

	it("still joins an ordinary command when shutdown starts externally", async () => {
		const shutdown = new SessionShutdown();
		const gate = phase3Gate<void>();
		const work = shutdown.run(() => shutdown.runCommand(() => gate.promise));
		const finalize = vi.fn();
		const close = shutdown.close(
			() => {},
			async () => {},
			finalize,
		);
		await setImmediate();
		expect(finalize).not.toHaveBeenCalled();
		gate.resolve();
		await work;
		await close;
		expect(finalize).toHaveBeenCalledOnce();
	});

	it("cannot turn a command nested inside a prompt/tool producer into self-close permission", async () => {
		const shutdown = new SessionShutdown();
		const finalize = vi.fn();
		await shutdown.run(async () => {
			await expect(
				shutdown.run(() =>
					shutdown.runCommand(() =>
						shutdown.close(
							() => {},
							async () => {},
							finalize,
						),
					),
				),
			).rejects.toThrow("own active operation");
		});
		expect(shutdown.isClosing).toBe(false);
		await shutdown.close(
			() => {},
			async () => {},
			finalize,
		);
		expect(finalize).toHaveBeenCalledOnce();
	});
});
