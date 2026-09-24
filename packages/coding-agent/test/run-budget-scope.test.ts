import { Agent } from "omk-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, registerFauxProvider } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { SessionRunBudget } from "../src/core/session-run-budget.ts";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const lifecycle = () => ({ assertIdle: () => {}, stop: vi.fn(), reject: vi.fn() });

describe("run scope admission", () => {
	it.each([undefined, { maxRequests: 1 }])(
		"rejects a competing %j prompt during unbounded preflight",
		async (limits) => {
			const runtime = new SessionRunBudget(new Agent(), lifecycle());
			const gate = deferred();
			const first = runtime.execute(undefined, () => gate.promise);
			const competing = vi.fn(async () => {});
			try {
				await expect(runtime.execute(limits, competing)).rejects.toThrow(/already processing/i);
				expect(competing).not.toHaveBeenCalled();
			} finally {
				gate.resolve();
				await first;
			}
			await runtime.execute(limits, competing);
			expect(competing).toHaveBeenCalledTimes(1);
		},
	);

	it("owns a default unbounded stream until terminal metadata rather than allowing a second prompt", async () => {
		const faux = registerFauxProvider();
		const stream = createAssistantMessageEventStream();
		const agent = new Agent({ streamFn: () => stream });
		const runtime = new SessionRunBudget(agent, lifecycle());
		const next = vi.fn(async () => {});
		try {
			await runtime.execute(undefined, async () => {
				await agent.streamFn(faux.getModel(), { messages: [] });
			});
			expect(runtime.snapshot()).toMatchObject({ closed: true, activeRequests: 1 });
			await expect(runtime.execute(undefined, next)).rejects.toThrow(/already processing/i);
			expect(next).not.toHaveBeenCalled();
		} finally {
			stream.end(fauxAssistantMessage("terminal"));
			await stream.result();
			faux.unregister();
		}
		await runtime.execute(undefined, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("keeps an outstanding stream owned after scope closure until real terminal metadata arrives", async () => {
		const faux = registerFauxProvider();
		const stream = createAssistantMessageEventStream();
		const agent = new Agent({ streamFn: () => stream });
		const runtime = new SessionRunBudget(agent, lifecycle());
		const next = vi.fn(async () => {});
		try {
			await runtime.execute({ maxConcurrentRequests: 1 }, async () => {
				await agent.streamFn(faux.getModel(), { messages: [] });
			});
			expect(runtime.snapshot()).toMatchObject({ closed: true, activeRequests: 1 });
			await expect(runtime.execute(undefined, next)).rejects.toThrow(/already processing/i);
			await expect(runtime.execute({ maxRequests: 2 }, next)).rejects.toThrow(/already processing/i);
			expect(next).not.toHaveBeenCalled();
		} finally {
			stream.end(fauxAssistantMessage("terminal"));
			await stream.result();
			faux.unregister();
		}
		await runtime.execute(undefined, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("denies an exhausted request before consulting the core credential resolver", async () => {
		const getApiKey = vi.fn(async () => "fixture-credential");
		const agent = new Agent({ getApiKey });
		const runtime = new SessionRunBudget(agent, lifecycle());
		const faux = registerFauxProvider();
		try {
			await expect(
				runtime.execute({ maxRequests: 1 }, async () => {
					await agent.getApiKey?.("fixture");
					const stream = await agent.streamFn(faux.getModel(), { messages: [] });
					await stream.result();
					await agent.getApiKey?.("fixture");
				}),
			).rejects.toMatchObject({ code: "requests" });
			expect(getApiKey).toHaveBeenCalledTimes(1);
			expect(agent.getApiKey).toBe(getApiKey);
		} finally {
			faux.unregister();
		}
	});
});
