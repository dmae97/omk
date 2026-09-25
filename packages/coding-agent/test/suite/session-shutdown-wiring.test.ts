import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { inspectSessionOwnerLeaseSync } from "../../src/core/session-owner-lease.ts";
import { phase3Gate } from "../fixtures/phase3-gate.ts";
import { createHarness } from "./harness.ts";

describe("session shutdown ownership", () => {
	it("retains the transcript lease until independent bash actually settles", async () => {
		const h = await createHarness({ persistSession: true });
		const started = phase3Gate<void>();
		const stopped = phase3Gate<void>();
		const path = h.session.sessionFile;
		if (!path) throw new Error("missing persisted session");
		const work = h.session.executeBash("printf fixture", undefined, {
			operations: {
				exec: async () => {
					started.resolve();
					await stopped.promise;
					return { exitCode: 0 };
				},
			},
		});
		try {
			await started.promise;
			h.session.dispose();
			expect(inspectSessionOwnerLeaseSync(path).status).not.toBe("absent");
			await expect(h.session.prompt("must not run")).rejects.toThrow();
		} finally {
			stopped.resolve();
			await work;
			await h.session.close();
			const state = inspectSessionOwnerLeaseSync(path).status;
			h.cleanup();
			expect(state).toBe("absent");
		}
	});

	it("close joins preflight and is idempotent without admitting another prompt", async () => {
		const entered = phase3Gate<void>();
		const release = phase3Gate<void>();
		const h = await createHarness({
			persistSession: true,
			extensionFactories: [
				(api) =>
					api.on("input", async () => {
						entered.resolve();
						await release.promise;
						return { action: "continue" };
					}),
			],
		});
		await h.session.bindExtensions({});
		h.setResponses([fauxAssistantMessage("must not dispatch")]);
		const work = h.session.prompt("start").catch(() => {});
		try {
			await entered.promise;
			let closed = false;
			const close = h.session.close();
			expect(h.session.close()).toBe(close);
			void close.then(() => {
				closed = true;
			});
			await expect(h.session.prompt("competing")).rejects.toThrow();
			expect(closed).toBe(false);
			release.resolve();
			await work;
			await close;
			expect(closed).toBe(true);
			expect(h.getPendingResponseCount()).toBe(1);
		} finally {
			release.resolve();
			await work;
			h.cleanup();
		}
	});
});
