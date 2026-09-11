import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSummarization } from "../../src/core/compaction/compaction.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.useRealTimers();
});

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("AgentSession shared run budget", () => {
	it("queues follow-up during retry without granting another request allowance", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		const started = deferred();
		const harness = await createHarness({
			settings: {
				retry: { enabled: true, maxRetries: 1, baseDelayMs: 100 },
				resourceGovernor: { mode: "off" },
			},
		});
		harnesses.push(harness);
		harness.session.subscribe((event) => {
			if (event.type === "auto_retry_start") started.resolve();
		});
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("recovered"),
			fauxAssistantMessage("must not dispatch"),
		]);
		const rejected = expect(
			harness.session.prompt("bounded", { runBudget: { maxRequests: 2 } }),
		).rejects.toMatchObject({ code: "requests" });
		await started.promise;
		await harness.session.prompt("follow-up", { streamingBehavior: "followUp" });
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
		expect(harness.faux.state.callCount).toBe(2);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
	});
	it("rejects zero request admission without dispatching a model", async () => {
		const harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
		harnesses.push(harness);
		await expect(harness.session.prompt("blocked", { runBudget: { maxRequests: 0 } })).rejects.toMatchObject({
			code: "requests",
		});
		expect(harness.faux.state.callCount).toBe(0);
		expect(harness.session.lastTermination).toMatchObject({ kind: "budget_exhausted", causeCode: "budget.requests" });
	});

	it("shares request admission with the first-party summarization path", async () => {
		let summary = "";
		const harness: Harness = await createHarness({
			settings: { retry: { enabled: false }, resourceGovernor: { mode: "off" } },
			tools: [
				{
					name: "summarize",
					label: "Summarize",
					description: "Exercise summary dispatch",
					parameters: Type.Object({}),
					execute: async () => {
						const result = await completeSummarization(
							harness.getModel(),
							{ messages: [{ role: "user", content: "summarize", timestamp: 0 }] },
							{},
							harness.session.agent.streamFn,
						);
						summary = result.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("");
						return { content: [{ type: "text", text: summary }], details: {} };
					},
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("summarize", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("summary result"),
			fauxAssistantMessage("must not dispatch"),
		]);
		await expect(harness.session.prompt("summarize", { runBudget: { maxRequests: 2 } })).rejects.toMatchObject({
			code: "requests",
		});
		expect(summary).toBe("summary result");
		expect(harness.faux.state.callCount).toBe(2);
		expect(harness.session.getRunBudgetSnapshot()).toMatchObject({
			requestsStarted: 2,
			activeRequests: 0,
			exhaustedBy: "requests",
		});
	});

	it("cancels retry backoff at the original run deadline", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		const started = deferred();
		const harness = await createHarness({
			settings: {
				retry: { enabled: true, maxRetries: 3, baseDelayMs: 10_000 },
				resourceGovernor: { mode: "off" },
			},
		});
		harnesses.push(harness);
		harness.session.subscribe((event) => {
			if (event.type === "auto_retry_start") started.resolve();
		});
		harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" })]);
		const rejected = expect(harness.session.prompt("retry", { runBudget: { timeoutMs: 100 } })).rejects.toMatchObject(
			{ code: "deadline" },
		);
		await started.promise;
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.session.isRetrying).toBe(false);
		expect(harness.session.lastTermination).toMatchObject({ kind: "budget_exhausted", causeCode: "budget.deadline" });
	});

	it("forwards deadline cancellation to an executing tool", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		const started = deferred();
		let cancelled = false;
		const harness = await createHarness({
			settings: { retry: { enabled: false }, resourceGovernor: { mode: "off" } },
			tools: [
				{
					name: "wait",
					label: "Wait",
					description: "Observe cancellation",
					parameters: Type.Object({}),
					execute: async (_id, _args, signal) => {
						await new Promise<void>((resolve) => {
							signal?.addEventListener(
								"abort",
								() => {
									cancelled = true;
									resolve();
								},
								{ once: true },
							);
							started.resolve();
						});
						return { content: [{ type: "text", text: "stopped" }], details: {} };
					},
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" })]);
		const rejected = expect(harness.session.prompt("wait", { runBudget: { timeoutMs: 100 } })).rejects.toMatchObject({
			code: "deadline",
		});
		await started.promise;
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
		expect(cancelled).toBe(true);
		expect(harness.eventsOfType("prompt_settled").at(-1)?.outcome).toBe("failed");
	});

	it("does not give a provider retry a fresh request allowance", async () => {
		const harness = await createHarness({
			settings: {
				retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
				resourceGovernor: { mode: "off" },
			},
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("must not dispatch"),
		]);
		await expect(harness.session.prompt("retry", { runBudget: { maxRequests: 1 } })).rejects.toMatchObject({
			code: "requests",
		});
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.session.lastTermination).toMatchObject({
			kind: "budget_exhausted",
			causeCode: "budget.requests",
			safeToAutoRetry: false,
		});
		expect(harness.eventsOfType("prompt_settled").at(-1)?.outcome).toBe("failed");
	});

	it("includes preflight waiting in the original deadline", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		const entered = deferred();
		const finish = deferred();
		const harness = await createHarness({
			settings: { resourceGovernor: { mode: "off" } },
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => {
						entered.resolve();
						await finish.promise;
					});
				},
			],
		});
		harnesses.push(harness);
		const pending = harness.session.prompt("deadline", { runBudget: { timeoutMs: 10 } });
		const rejected = expect(pending).rejects.toMatchObject({ code: "deadline" });
		await entered.promise;
		await vi.advanceTimersByTimeAsync(20);
		finish.resolve();
		await rejected;
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("pins caller limits and restores the original stream after a bounded prompt", async () => {
		const entered = deferred();
		const finish = deferred();
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 }, resourceGovernor: { mode: "off" } },
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => {
						entered.resolve();
						await finish.promise;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("next unbounded prompt"),
		]);
		const original = harness.session.agent.streamFn;
		const limits = { maxRequests: 1 };
		const pending = harness.session.prompt("bounded", { runBudget: limits });
		const rejected = expect(pending).rejects.toMatchObject({ code: "requests" });
		await entered.promise;
		limits.maxRequests = 9;
		finish.resolve();
		await rejected;
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.session.agent.streamFn).toBe(original);
		await harness.session.prompt("unbounded");
		expect(harness.faux.state.callCount).toBe(2);
	});
});
