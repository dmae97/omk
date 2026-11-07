import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { GoalAutonomy, settledRunCostUsd } from "../src/core/extensions/builtin/goal-autonomy.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import { registerGoalCostAccounting } from "../src/core/extensions/builtin/goal-cost-accounting.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import { RunBudgetExceededError } from "../src/core/run-budget-policy.ts";
import { type AgentSettledEvent, SessionExtensionSettlement } from "../src/core/session-extension-settlement.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { PromptExecutionBusyError } from "../src/core/session-prompt-lifecycle.ts";
import { SessionRunBudget } from "../src/core/session-run-budget.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];
let networkAttempts = 0;
beforeEach(() => {
	vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
	vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "0");
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0");
	vi.stubEnv("OMK_RESOURCE_GOVERNOR", "off");
	networkAttempts = 0;
	vi.stubGlobal("fetch", () => {
		networkAttempts++;
		throw new Error("Offline compaction accounting test: network forbidden");
	});
});
afterEach(async () => {
	for (const harness of harnesses.splice(0)) {
		await harness.session.close();
		harness.cleanup();
	}
	expect(networkAttempts).toBe(0);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function usage(cost: number, tokens = 118): AssistantMessage["usage"] {
	return {
		input: tokens - 17,
		output: 17,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: tokens,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

function seed(harness: Harness, tokens = 179_990): void {
	const model = harness.getModel();
	harness.sessionManager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() - 1000 });
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("seeded history"),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: usage(0, tokens),
		timestamp: Date.now() - 500,
	});
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function spendReceipts(harness: Harness) {
	return harness.sessionManager
		.getEntries()
		.flatMap((entry) =>
			entry.type === "custom" && entry.customType === "goal_autonomy_spend"
				? [entry.data as { costUsd: number | null; settlementId: string }]
				: [],
		);
}

type Step =
	| number
	| {
			cost: number;
			kind?: "error" | "thinking";
			tokens?: number;
			response?: AssistantMessage;
			before?: () => Promise<void> | void;
			errorText?: string;
	  };
async function fixture(
	costs: Step[],
	options: {
		controller?: boolean;
		goal?: boolean;
		budget?: string | null;
		paused?: boolean;
		reasoning?: boolean;
		compactor?: boolean;
		extensions?: ExtensionFactory[];
		persist?: boolean;
	} = {},
) {
	const settlements: AgentSettledEvent[] = [];
	const responses: AssistantMessage[] = [];
	const requests: Array<{ reasoning: unknown; keys: string[]; model: string }> = [];
	const harness = await createHarness({
		models: [
			{
				id: "compaction-accounting-offline",
				contextWindow: 200_000,
				maxTokens: 20_000,
				reasoning: options.reasoning ?? false,
			},
			...(options.compactor ? [{ id: "compaction-only-offline", contextWindow: 200_000, maxTokens: 20_000 }] : []),
		],
		persistSession: options.persist,
		settings: {
			compaction: {
				enabled: true,
				reserveTokens: 8192,
				keepRecentTokens: 1,
				...(options.compactor ? { model: "faux/compaction-only-offline" } : {}),
			},
			retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
		},
		extensionFactories: [
			(omk) => {
				if (options.controller !== false) goalController(omk);
				omk.on("agent_settled", (event) => {
					settlements.push(event);
				});
			},
			...(options.extensions ?? []),
		],
	});
	harnesses.push(harness);
	harness.session.agent.streamFn = async (model, _context, request) => {
		const item = costs[requests.length];
		if (item === undefined) throw new Error("Offline adapter exhausted");
		const step = typeof item === "number" ? { cost: item } : item;
		requests.push({ reasoning: request?.reasoning, keys: Object.keys(request ?? {}).sort(), model: model.id });
		await step.before?.();
		const message: AssistantMessage = step.response ?? {
			...fauxAssistantMessage(step.kind ? "" : "synthetic text"),
			api: model.api,
			provider: model.provider,
			model: model.id,
			responseId: `synthetic-${responses.length}`,
			usage: usage(step.cost, step.tokens),
			stopReason: step.kind === "error" ? "error" : step.kind === "thinking" ? "length" : "stop",
			...(step.kind === "error" ? { errorMessage: step.errorText ?? "503 service unavailable" } : {}),
			...(step.kind === "thinking"
				? { content: [{ type: "thinking" as const, thinking: "synthetic reasoning" }] }
				: {}),
		};
		responses.push(message);
		const stream = createAssistantMessageEventStream();
		if (message.stopReason === "error" || message.stopReason === "aborted")
			stream.push({ type: "error", reason: message.stopReason, error: message });
		else stream.push({ type: "done", reason: message.stopReason, message });
		stream.end(message);
		return stream;
	};
	if (options.reasoning) harness.session.setThinkingLevel("max");
	if (options.controller !== false && options.goal !== false) {
		await harness.session.prompt("/goal synthetic accounting regression");
		if (options.budget !== null) await harness.session.prompt(`/goal budget ${options.budget ?? "0.05"}`);
		if (options.paused) await harness.session.prompt("/goal pause");
	}
	const store = new DurableGoalStore(join(harness.tempDir, ".omk", "goals", "current.json"));
	return { harness, settlements, responses, requests, store };
}

function total(h: Harness) {
	const receipts = spendReceipts(h);
	return receipts.some((e) => e.costUsd === null)
		? undefined
		: receipts.reduce((sum, e) => sum + Number(e.costUsd), 0);
}
function gate() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function idle(h: Harness): Promise<void> {
	await h.session.agent.waitForIdle();
	await vi.waitFor(() => expect(h.session.extensionRunner.createContext().isIdle()).toBe(true), { timeout: 5000 });
}

describe("automatic compaction goal cost, real public session", () => {
	describe("recovery ownership review regressions", () => {
		it.each(
			[false, true].flatMap((recovering) =>
				(["steer", "followUp"] as const).flatMap((mode) =>
					[
						{ policy: "zero", limits: { maxRequests: 0 } },
						{ policy: "one", limits: { maxRequests: 1 } },
						{ policy: "empty", limits: {} },
					].map(({ policy, limits }) => ({ recovering, mode, policy, limits })),
				),
			),
		)(
			"does not ignore $policy runBudget on queued $mode input, recovery=$recovering",
			async ({ recovering, mode, limits }) => {
				const entered = gate(),
					release = gate();
				const f = await fixture([0.07, 0.07], {
					extensions: [
						(omk) =>
							omk.on("agent_settled", async () => {
								entered.resolve();
								await release.promise;
							}),
					],
				});
				const error = new Error("explicit queued budget receipt failure");
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				let fail = recovering;
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) throw error;
					return append(type, data);
				});
				const original = f.harness.session
					.prompt("original", { runBudget: { maxRequests: 2 } })
					.catch((failure: unknown) => failure);
				if (recovering) expect(await original).toBe(error);
				else await entered.promise;
				const dispatched = vi.fn(() => release.resolve());
				try {
					await expect(
						f.harness.session.prompt("must not silently queue", {
							streamingBehavior: mode,
							runBudget: limits,
							dispatched,
						}),
					).rejects.toBeInstanceOf(PromptExecutionBusyError);
					expect(dispatched).not.toHaveBeenCalled();
					expect(f.harness.session.agent.hasQueuedMessages()).toBe(false);
					expect(f.harness.session.getRunBudgetSnapshot()?.limits.maxRequests).toBe(2);
					expect(f.harness.session.getRunBudgetSnapshot()?.requestsStarted).toBe(1);
					expect(f.requests).toHaveLength(1);
				} finally {
					fail = false;
					release.resolve();
					await original;
					await f.harness.session.close();
				}
			},
		);
		it("does not treat a streaming session command as queued input through failed accounting", async () => {
			const f = await fixture([0.07]);
			const error = new Error("command still requires accounting recovery");
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) throw error;
				return append(type, data);
			});
			try {
				await expect(f.harness.session.prompt("original")).rejects.toBe(error);
				await expect(f.harness.session.prompt("/goal pause", { streamingBehavior: "followUp" })).rejects.toBe(
					error,
				);
				expect((await f.store.current())?.status).toBe("active");
				expect(f.requests).toHaveLength(1);
			} finally {
				fail = false;
				await f.harness.session.close();
			}
		});
		it.each(["tree", "summarized-tree", "extension-summary"] as const)(
			"rechecks a delayed %s hook after accounting becomes blocked",
			async (mode) => {
				const answerEntered = gate(),
					answerRelease = gate(),
					treeEntered = gate(),
					treeRelease = gate();
				const f = await fixture(
					[
						{
							cost: 0.07,
							before: async () => {
								answerEntered.resolve();
								await answerRelease.promise;
							},
						},
						0.11,
					],
					{
						extensions: [
							(omk) =>
								omk.on("session_before_tree", async () => {
									treeEntered.resolve();
									await treeRelease.promise;
									return mode === "extension-summary"
										? { summary: { summary: "synthetic branch override" } }
										: undefined;
								}),
						],
					},
				);
				for (let i = 0; i < 3; i++) seed(f.harness, 1000);
				const target = f.harness.sessionManager.getEntries().find((entry) => entry.type === "message");
				if (!target) throw new Error("missing tree target");
				const error = new Error("accounting failed during tree hook");
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				let fail = true;
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) throw error;
					return append(type, data);
				});
				const run = f.harness.session.prompt("original").catch((failure) => failure);
				await answerEntered.promise;
				const tree = f.harness.session.navigateTree(target.id, { summarize: mode !== "tree" }).then(
					(result) => ({ result }),
					(failure: unknown) => ({ error: failure }),
				);
				try {
					await treeEntered.promise;
					answerRelease.resolve();
					expect(await run).toBe(error);
					const leaf = f.harness.sessionManager.getLeafId();
					treeRelease.resolve();
					expect(await tree).toEqual({ error });
					expect(f.requests).toHaveLength(1);
					expect(f.harness.sessionManager.getLeafId()).toBe(leaf);
					expect(f.settlements).toHaveLength(0);
				} finally {
					fail = false;
					answerRelease.resolve();
					treeRelease.resolve();
					await tree;
					await f.harness.session.close();
				}
			},
		);
		it.each([false, true])("refuses delayed branch work crossing close, retained recovery=%s", async (recovering) => {
			const recoveryEntered = gate(),
				recoveryRelease = gate(),
				authEntered = gate(),
				authRelease = gate();
			const f = await fixture([0.07, 0.11]);
			for (let i = 0; i < 3; i++) seed(f.harness, 1000);
			const execute = vi.spyOn(SessionRunBudget.prototype, "execute");
			const source = f.harness.session.agent.streamFn;
			f.harness.session.agent.streamFn = (...args) => {
				args[2]?.signal?.throwIfAborted();
				return source(...args);
			};
			const start = SessionExtensionSettlement.prototype.start;
			let deliveries = 0;
			vi.spyOn(SessionExtensionSettlement.prototype, "start").mockImplementation(function (
				this: SessionExtensionSettlement,
				event,
				runOwned,
				emit,
				idle,
				failed,
			) {
				return start.call(
					this,
					event,
					runOwned,
					async (actual) => {
						if (recovering && ++deliveries === 2) {
							recoveryEntered.resolve();
							await recoveryRelease.promise;
						}
						await emit(actual);
					},
					idle,
					failed,
				);
			});
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = recovering;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) {
					fail = false;
					throw new Error("tree close receipt failure");
				}
				return append(type, data);
			});
			const run = f.harness.session.prompt("original", { runBudget: { maxRequests: 1 } });
			if (recovering) await expect(run).rejects.toThrow("tree close receipt failure");
			else await run;
			const target = f.harness.sessionManager.getEntries().find((entry) => entry.type === "message");
			if (!target) throw new Error("missing tree target");
			const auth = f.harness.session.modelRegistry.getApiKeyAndHeaders.bind(f.harness.session.modelRegistry);
			vi.spyOn(f.harness.session.modelRegistry, "getApiKeyAndHeaders").mockImplementation(async (...args) => {
				authEntered.resolve();
				await authRelease.promise;
				return auth(...args);
			});
			const branch = vi.spyOn(f.harness.sessionManager, "branchWithSummary");
			const tree = f.harness.session.navigateTree(target.id, { summarize: true }).catch((error: unknown) => error);
			if (recovering) await recoveryEntered.promise;
			else await authEntered.promise;
			const close = f.harness.session.close();
			try {
				recoveryRelease.resolve();
				const owner = execute.mock.contexts[0] as SessionRunBudget;
				await owner.waitForExecution();
			} finally {
				authRelease.resolve();
				recoveryRelease.resolve();
			}
			await tree;
			await close;
			expect(f.requests).toHaveLength(1);
			expect(branch).not.toHaveBeenCalled();
			expect(f.harness.sessionManager.getEntries().filter((entry) => entry.type === "branch_summary")).toHaveLength(
				0,
			);
		});
		it.each(
			[false, true].flatMap((recovering) =>
				[1, 2].flatMap((cap) => (["steer", "followUp"] as const).map((mode) => ({ recovering, cap, mode }))),
			),
		)("keeps public queued $mode under cap $cap, recovery=$recovering", async ({ mode, recovering, cap }) => {
			const entered = gate(),
				release = gate();
			let first = true;
			const f = await fixture([0.07, 0.07], {
				extensions: [
					(omk) =>
						omk.on("agent_settled", async () => {
							if (first) {
								first = false;
								entered.resolve();
								await release.promise;
							}
						}),
				],
			});
			const execute = vi.spyOn(SessionRunBudget.prototype, "execute");
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = recovering,
				queued = false;
			const error = new Error("queued prompt receipt failure");
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) {
					fail = false;
					throw error;
				}
				return append(type, data);
			});
			const original = f.harness.session
				.prompt("original", { runBudget: { maxRequests: cap } })
				.catch((failure: unknown) => failure);
			if (recovering) expect(await original).toBe(error);
			else await entered.promise;
			const input = f.harness.session
				.prompt("queued explicit input", {
					streamingBehavior: mode,
					dispatched: () => {
						queued = true;
					},
				})
				.catch((failure: unknown) => failure);
			try {
				await entered.promise;
				await vi.waitFor(() => expect(queued).toBe(true), { timeout: 500 });
				release.resolve();
				await Promise.all([original, input]);
				await idle(f.harness);
				expect(f.requests).toHaveLength(cap);
				expect(execute).toHaveBeenCalledOnce();
				expect(f.harness.session.getRunBudgetSnapshot()?.limits.maxRequests).toBe(cap);
				expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
			} finally {
				release.resolve();
				await Promise.all([original, input]);
				await f.harness.session.close();
				execute.mockRestore();
			}
		});
		it("does not retry away a control-close fault after accounting recovery", async () => {
			const f = await fixture([0.07]);
			const receiptError = new Error("persistent receipt before close");
			const controlError = new Error("original control close failed");
			const closeControl = vi.fn().mockRejectedValueOnce(controlError).mockResolvedValue(undefined);
			Object.defineProperty(f.harness.session, "_control", {
				value: Promise.resolve({ close: closeControl }),
				writable: true,
				configurable: true,
			});
			const invalidate = vi.spyOn(f.harness.session.extensionRunner, "invalidate");
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) throw receiptError;
				return append(type, data);
			});
			try {
				await expect(f.harness.session.prompt("original")).rejects.toBe(receiptError);
				const first = f.harness.session.close();
				expect(f.harness.session.close()).toBe(first);
				await expect(first).rejects.toBe(receiptError);
				expect(closeControl).toHaveBeenCalledOnce();
				fail = false;
				const second = f.harness.session.close();
				expect(f.harness.session.close()).toBe(second);
				await expect(second).rejects.toBe(controlError);
				expect(closeControl).toHaveBeenCalledOnce();
				expect(invalidate).not.toHaveBeenCalled();
				expect(f.requests).toHaveLength(1);
				expect(f.settlements).toHaveLength(1);
				expect(total(f.harness)).toBeCloseTo(0.07);
				await expect(f.harness.session.prompt("must remain closed")).rejects.toThrow("closing or closed");
			} finally {
				fail = false;
				await f.harness.session.close().catch(() => {});
				// This synthetic control failure intentionally leaves shutdown unconfirmed; it owns no server/socket.
				harnesses.splice(harnesses.indexOf(f.harness), 1);
				f.harness.cleanup();
			}
		});
		it("does not renew the original request cap for a recovered under-cap continuation", async () => {
			const f = await fixture([0.07, 0.07], { budget: "1" });
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) {
					fail = false;
					throw new Error("review capped receipt failure");
				}
				return append(type, data);
			});
			await expect(f.harness.session.prompt("original", { runBudget: { maxRequests: 1 } })).rejects.toThrow(
				"review capped receipt failure",
			);
			await f.harness.session.reload();
			expect(f.requests).toHaveLength(1);
			expect(f.harness.session.getRunBudgetSnapshot()?.requestsStarted).toBe(1);
			expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
		});
		it("keeps reentrant post-ACK input recoverable across a reload barrier", async () => {
			let autonomy: GoalAutonomy | undefined;
			const f = await fixture([0.07, 0.07], {
				controller: false,
				extensions: [
					(omk) => {
						autonomy = new GoalAutonomy(omk, new GoalAcceptance());
						registerGoalCostAccounting(omk, autonomy);
					},
				],
			});
			const goal = await f.store.create(
				createDurableGoal({
					id: "session",
					objective: "reentrant reload",
					maxRounds: 8,
					now: new Date().toISOString(),
				}),
			);
			if (!autonomy) throw new Error("missing accountant");
			autonomy.setBudget(goal, { maxCostUsd: 1 });
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let appends = 0,
				fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && [1, 3].includes(++appends) && fail)
					throw new Error("review reentrant receipt failure");
				return append(type, data);
			});
			try {
				await expect(f.harness.session.prompt("first")).rejects.toThrow("review reentrant receipt failure");
				let sent = false;
				let sendError: unknown;
				f.harness.session.subscribe((event) => {
					if (event.type === "prompt_settled" && !sent) {
						sent = true;
						void f.harness.session
							.sendCustomMessage(
								{ customType: "post-ack", content: "second", display: false },
								{ triggerTurn: true },
							)
							.catch((error) => {
								sendError = error;
							});
					}
				});
				await f.harness.session.reload();
				await vi.waitFor(() => expect(appends).toBe(3));
				await f.harness.session.reload();
				expect(f.requests).toHaveLength(2);
				expect(f.settlements).toHaveLength(2);
				expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(2);
				expect(sendError).toBeUndefined();
				expect(total(f.harness)).toBeCloseTo(0.14);
			} finally {
				fail = false;
				await f.harness.session.close();
			}
		});
		it.each([false, true])(
			"does not admit settlement compaction beyond the request cap, recovery=%s",
			async (recovering) => {
				let observed: unknown;
				const f = await fixture([0.07, 0.11, 0.11], {
					extensions: [
						(omk) => {
							omk.on("agent_settled", async (_event, ctx) => {
								try {
									await new Promise<void>((resolve, reject) =>
										ctx.compact({ onComplete: () => resolve(), onError: reject }),
									);
								} catch (error) {
									observed = error;
								}
							});
						},
					],
				});
				for (let i = 0; i < 3; i++) seed(f.harness, 1000);
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				let fail = recovering;
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) {
						fail = false;
						throw new Error("review receipt failure");
					}
					return append(type, data);
				});
				await f.harness.session.prompt("original", { runBudget: { maxRequests: 1 } }).catch(() => {});
				if (recovering) await f.harness.session.reload();
				expect(observed).toBeInstanceOf(Error);
				expect(f.requests).toHaveLength(1);
				expect(f.harness.session.getRunBudgetSnapshot()?.requestsStarted).toBe(1);
			},
		);
		it.each(["compact", "tree", "summarized-tree"])(
			"blocks external %s before retained accounting recovers",
			async (mode) => {
				const f = await fixture([0.07, 0.11, 0.11]);
				for (let i = 0; i < 3; i++) seed(f.harness, 1000);
				const target = f.harness.sessionManager.getEntries().find((entry) => entry.type === "message");
				if (!target) throw new Error("missing history target");
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				const error = new Error("review persistent receipt failure");
				let fail = true;
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) throw error;
					return append(type, data);
				});
				try {
					await expect(f.harness.session.prompt("original")).rejects.toBe(error);
					const leaf = f.harness.sessionManager.getLeafId();
					const operation =
						mode === "compact"
							? f.harness.session.compact()
							: f.harness.session.navigateTree(target.id, { summarize: mode === "summarized-tree" });
					await expect(operation).rejects.toBe(error);
					expect(f.requests).toHaveLength(1);
					expect(f.harness.sessionManager.getLeafId()).toBe(leaf);
				} finally {
					fail = false;
					await f.harness.session.close();
				}
			},
		);
		it.each([false, true])(
			"preserves an under-cap goal continuation and its original budget, recovery=%s",
			async (recovering) => {
				const f = await fixture([0.07, 0.07], { budget: "0.1" });
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				let fail = recovering;
				const reports: string[] = [];
				f.harness.session.extensionRunner.onError((error) => reports.push(error.event ?? ""));
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) {
						fail = false;
						throw new Error("review continuation receipt failure");
					}
					return append(type, data);
				});
				await f.harness.session.prompt("original", { runBudget: { maxRequests: 2 } }).catch(() => {});
				if (recovering) await f.harness.session.reload();
				await idle(f.harness);
				expect(f.requests).toHaveLength(2);
				expect(f.harness.session.getRunBudgetSnapshot()?.requestsStarted).toBe(2);
				expect(total(f.harness)).toBeCloseTo(0.14);
				expect((await f.store.current())?.status).toBe("blocked");
				expect(f.settlements).toHaveLength(2);
				expect(reports).not.toContain("send_user_message");
				expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
			},
		);
		it.each(["steer", "followUp"] as const)(
			"services accepted %s input after recovery without a new budget",
			async (mode) => {
				const f = await fixture([0.07, 0.07]);
				const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
				let fail = true;
				vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
					if (type === "goal_autonomy_spend" && fail) throw new Error("review queued receipt failure");
					return append(type, data);
				});
				try {
					await expect(f.harness.session.prompt("original", { runBudget: { maxRequests: 2 } })).rejects.toThrow(
						"review queued receipt failure",
					);
					await f.harness.session[mode]("accepted input");
					fail = false;
					await f.harness.session.reload();
					expect(f.requests).toHaveLength(2);
					expect(f.harness.session.agent.hasQueuedMessages()).toBe(false);
					expect(f.harness.session.getRunBudgetSnapshot()?.requestsStarted).toBe(2);
					expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
				} finally {
					fail = false;
					f.harness.session.clearQueue();
					await f.harness.session.close();
				}
			},
		);
		it("retains a loop for custom input accepted during the first accounting attempt", async () => {
			const f = await fixture([0.07, 0.07]);
			const entered = gate(),
				release = gate();
			const start = SessionExtensionSettlement.prototype.start;
			let first = true;
			vi.spyOn(SessionExtensionSettlement.prototype, "start").mockImplementation(function (
				this: SessionExtensionSettlement,
				event,
				runOwned,
				emit,
				notify,
				failed,
			) {
				return start.call(
					this,
					event,
					runOwned,
					async (actual) => {
						if (first) {
							first = false;
							entered.resolve();
							await release.promise;
						}
						await emit(actual);
					},
					notify,
					failed,
				);
			});
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			let fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) {
					fail = false;
					throw new Error("review in-flight receipt failure");
				}
				return append(type, data);
			});
			const run = f.harness.session.prompt("original", { runBudget: { maxRequests: 2 } });
			const rejection = expect(run).rejects.toThrow("review in-flight receipt failure");
			try {
				await entered.promise;
				await f.harness.session.sendCustomMessage(
					{ customType: "during-accounting", content: "accepted", display: false },
					{ triggerTurn: true },
				);
				release.resolve();
				await rejection;
				await f.harness.session.reload();
				expect(f.requests).toHaveLength(2);
				expect(f.harness.session.agent.hasQueuedMessages()).toBe(false);
				expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
			} finally {
				release.resolve();
				f.harness.session.clearQueue();
				await f.harness.session.close();
			}
		});
		it("rejects a reload begun before the accounting failure without retiring its runner", async () => {
			const entered = gate(),
				release = gate();
			const f = await fixture([
				{
					cost: 0.07,
					before: async () => {
						entered.resolve();
						await release.promise;
					},
				},
			]);
			const original = f.harness.session.extensionRunner;
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			const failure = new Error("review late accounting failure");
			let fail = true;
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (type === "goal_autonomy_spend" && fail) throw failure;
				return append(type, data);
			});
			const run = f.harness.session.prompt("original");
			const rejected = expect(run).rejects.toBe(failure);
			await entered.promise;
			const reload = f.harness.session.reload();
			const refused = expect(reload).rejects.toBe(failure);
			release.resolve();
			try {
				await rejected;
				await refused;
				expect(f.harness.session.extensionRunner).toBe(original);
				fail = false;
				await f.harness.session.reload();
				expect(f.settlements).toHaveLength(1);
				expect(f.requests).toHaveLength(1);
			} finally {
				fail = false;
				await f.harness.session.close();
			}
		});
		it.each(["0", "1"])(
			"seals and coalesces close during a handler without a controller, autonomy=%s",
			async (flag) => {
				vi.stubEnv("OMK_GOAL_AUTONOMY", flag);
				const entered = gate(),
					release = gate();
				const f = await fixture([0.07], {
					controller: false,
					extensions: [
						(omk) => {
							omk.on("agent_settled", async () => {
								entered.resolve();
								await release.promise;
							});
						},
					],
				});
				const run = f.harness.session.prompt("original");
				await entered.promise;
				const first = f.harness.session.close(),
					second = f.harness.session.close();
				let backend = 0;
				const bash = f.harness.session.executeBash("synthetic", undefined, {
					operations: {
						exec: async () => {
							backend++;
							return { exitCode: 0 };
						},
					},
				});
				const refused = expect(bash).rejects.toThrow(/closing or closed/);
				try {
					expect.soft(first).toBe(second);
					await refused;
					expect(backend).toBe(0);
				} finally {
					release.resolve();
					await Promise.allSettled([run, first, second, bash]);
				}
			},
		);
	});
	it("keeps exhausted settlement blocked through abort, close, reload and custom input until recovery", async () => {
		const f = await fixture([0.11, 0.07]);
		seed(f.harness);
		const started = vi.spyOn(SessionExtensionSettlement.prototype, "start");
		const failure = new Error("persistent summary receipt failure");
		const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
		let fail = true;
		const ids: string[] = [];
		const trace: Array<Array<string | number>> = [];
		const snapshot = (stage: string) => {
			trace.push([
				stage,
				f.requests.length,
				f.settlements.length,
				f.harness.eventsOfType("prompt_settled").length,
				Math.round((total(f.harness) ?? Number.NaN) * 100),
				new Set(ids).size,
				spendReceipts(f.harness).length,
				Number(f.settlements[0] === started.mock.calls[0]?.[0]),
			]);
		};
		vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (
				type === "goal_autonomy_spend" &&
				(data as { settlementId: string }).settlementId.startsWith("compaction-usage:")
			) {
				ids.push((data as { settlementId: string }).settlementId);
				if (fail) throw failure;
			}
			return append(type, data);
		});
		try {
			await expect(f.harness.session.prompt("original")).rejects.toBe(failure);
			const answer = f.harness
				.eventsOfType("message_end")
				.find((event) => event.message.role === "assistant")?.message;
			snapshot("prompt_failed");
			await expect(f.harness.session.reload()).rejects.toBe(failure);
			snapshot("reload_failed");
			await expect(f.harness.session.close()).rejects.toBe(failure);
			snapshot("close_failed");
			await expect(
				f.harness.session.sendCustomMessage(
					{ customType: "next", content: "later", display: false },
					{ triggerTurn: true },
				),
			).rejects.toThrow("Session is closing or closed");
			snapshot("custom_failed");
			await f.harness.session.abort();
			snapshot("aborted");
			expect(f.harness.session.extensionRunner.createContext().isIdle()).toBe(false);
			expect(f.requests).toHaveLength(2);
			expect(f.settlements).toEqual([]);
			expect(f.harness.eventsOfType("prompt_settled")).toEqual([]);
			fail = false;
			await f.harness.session.close();
			snapshot("recovered");
			expect(f.settlements).toEqual([started.mock.calls[0][0]]);
			expect(f.settlements[0].messages.at(-1)).toBe(answer);
			expect(f.requests).toHaveLength(2);
			expect(total(f.harness)).toBeCloseTo(0.18);
			expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
			const path = process.env.N00_TEST_TRACE;
			if (path)
				writeFileSync(
					path,
					`${[
						"stage\trequests\tdelivered\tfinalized\tcents\tbatch_ids\treceipts\toriginal_event",
						...trace.map((row) => row.join("\t")),
					].join("\n")}\n`,
					{ flag: "wx" },
				);
		} finally {
			fail = false;
			await f.harness.session.close();
		}
	});
	it("reconciles an accepted summary receipt before redelivering its original event", async () => {
		const f = await fixture([0.11, 0.07], { persist: true });
		seed(f.harness);
		const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
		const failure = new Error("summary ACK lost");
		let summaryAppends = 0;
		vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			const id = append(type, data);
			if (
				type === "goal_autonomy_spend" &&
				(data as { settlementId: string }).settlementId.startsWith("compaction-usage:")
			) {
				summaryAppends++;
				if (summaryAppends === 1) throw failure;
			}
			return id;
		});
		await expect(f.harness.session.prompt("original")).rejects.toBe(failure);
		await f.harness.session.reload();
		expect(summaryAppends).toBe(1);
		expect(spendReceipts(f.harness).map((receipt) => receipt.costUsd)).toEqual([0.11, 0.07]);
		expect(f.settlements).toHaveLength(1);
		expect(f.requests).toHaveLength(2);
	});
	it("refuses own-handler reload during recovery before replacing the captured runner", async () => {
		let h: Harness;
		let refused = false;
		const f = await fixture([0.11, 0.07], {
			extensions: [
				(omk) => {
					omk.on("agent_settled", async () => {
						await expect(h.session.reload()).rejects.toThrow(/active.*settlement/);
						refused = true;
					});
				},
			],
		});
		h = f.harness;
		seed(h);
		const append = h.sessionManager.appendCustomEntry.bind(h.sessionManager);
		let failed = false;
		vi.spyOn(h.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (type === "goal_autonomy_spend" && !failed) {
				failed = true;
				throw new Error("one append failure");
			}
			return append(type, data);
		});
		await expect(h.session.prompt("original")).rejects.toThrow("one append failure");
		await h.session.reload();
		expect(refused).toBe(true);
		expect(f.requests).toHaveLength(2);
		expect(f.settlements).toHaveLength(1);
	});
	it.each(["before", "after"])("retains genuine answer accounting after an %s-append rejection", async (when) => {
		const f = await fixture([0.11, 0.07]);
		seed(f.harness);
		const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
		const failure = new Error("ordinary receipt acknowledgement failed");
		let rejected = false;
		vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (
				type === "goal_autonomy_spend" &&
				(data as { settlementId: string }).settlementId.startsWith("prompt-run-") &&
				!rejected
			) {
				rejected = true;
				if (when === "after") append(type, data);
				throw failure;
			}
			return append(type, data);
		});
		await expect(f.harness.session.prompt("original")).rejects.toBe(failure);
		expect(f.settlements).toEqual([]);
		expect(f.harness.eventsOfType("prompt_settled")).toEqual([]);
		expect(f.harness.session.extensionRunner.createContext().isIdle()).toBe(false);
		await f.harness.session.reload();
		expect(total(f.harness)).toBeCloseTo(0.18);
		expect(f.requests).toHaveLength(2);
		expect(f.settlements).toHaveLength(1);
		expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
	});
	it("reports observer errors after delivering every settlement listener without replay", async () => {
		let later = 0;
		const f = await fixture([0.07], {
			extensions: [
				(omk) => {
					omk.on("agent_settled", () => {
						throw new Error("observer failed");
					});
					omk.on("agent_settled", () => {
						later++;
					});
				},
			],
		});
		let reports = 0;
		f.harness.session.extensionRunner.onError(() => {
			reports++;
			throw new Error("reporter failed");
		});
		await f.harness.session.prompt("answer");
		expect(later).toBe(1);
		expect(reports).toBe(1);
		expect(f.settlements).toHaveLength(1);
		expect(total(f.harness)).toBeCloseTo(0.07);
	});
	it("normal positive control charges only .07 and emits no empty summary receipt", async () => {
		const f = await fixture([0.07]);
		await f.harness.session.prompt("synthetic question");
		expect(total(f.harness)).toBeCloseTo(0.07);
		expect(spendReceipts(f.harness)).toHaveLength(1);
		expect(spendReceipts(f.harness)[0].settlementId).toMatch(/^prompt-run-.*#1$/);
		expect(f.harness.eventsOfType("compaction_start")).toEqual([]);
	});
	it("adds .11 preflight summary to .07 goal spend without adding summary messages", async () => {
		const f = await fixture([0.11, 0.07]);
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(f.responses).toHaveLength(2);
		expect(f.harness.faux.state.callCount).toBe(0);
		expect(f.settlements).toHaveLength(1);
		const actualSettlement = f.settlements[0];
		const actualAnswer = f.harness.eventsOfType("message_end").find((e) => e.message.role === "assistant")?.message;
		expect(settledRunCostUsd(actualSettlement.messages)).toBeCloseTo(0.07);
		// The existing public event also includes its genuine user message, never the summary.
		expect(actualSettlement.messages).toEqual([expect.objectContaining({ role: "user" }), actualAnswer]);
		expect(actualSettlement.messages.filter((m) => m.role === "assistant")).toEqual([actualAnswer]);
		expect(actualSettlement.messages.at(-1)).toBe(actualAnswer);
		expect(Object.keys(actualSettlement).sort()).toEqual(["aborted", "messages", "settlementId", "type"]);
		const goalSpendUsd = spendReceipts(f.harness).reduce((sum, receipt) => sum + Number(receipt.costUsd), 0);
		expect(goalSpendUsd).toBeCloseTo(0.18);
		expect((await f.store.current())?.status).toBe("blocked");
		expect(f.harness.session.getSessionStats().cost).toBeCloseTo(0.07);
		expect(spendReceipts(f.harness).map((e) => e.costUsd)).toEqual([0.11, 0.07]);
	});

	it.each([
		{ kind: "retry", first: { cost: 0.02, kind: "error" as const }, expected: 0.2 },
		{ kind: "reasoning", first: { cost: 0.03, kind: "thinking" as const }, expected: 0.21 },
	])("includes billed $kind attempts without changing ordinary settlement", async ({ kind, first, expected }) => {
		const f = await fixture([first, 0.11, 0.07], { reasoning: kind === "reasoning" });
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(total(f.harness)).toBeCloseTo(expected);
		expect(f.requests).toHaveLength(3);
		expect(f.settlements).toHaveLength(1);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.07);
		if (kind === "retry") expect(f.harness.eventsOfType("summarization_retry_scheduled")).toHaveLength(1);
		else {
			expect(f.requests[0].reasoning).toBeDefined();
			expect(f.requests[1].reasoning).toBeUndefined();
		}
	});

	it("includes both postflight split summaries (.31), even in reverse completion order", async () => {
		const hold = gate();
		const f = await fixture([
			{ cost: 0.07, tokens: 179_990 },
			{ cost: 0.11, before: () => hold.promise },
			{
				cost: 0.13,
				before: () => {
					setImmediate(hold.resolve);
				},
			},
		]);
		seed(f.harness, 100);
		await f.harness.session.prompt("synthetic question");
		expect(f.responses.map((m) => m.usage.cost.total)).toEqual([0.07, 0.13, 0.11]);
		expect(total(f.harness)).toBeCloseTo(0.31);
		expect(f.settlements).toHaveLength(1);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.07);
	});

	it("accounts preflight at the real terminal request refusal without agent settlement, acceptance, or round advancement", async () => {
		const f = await fixture([0.11]);
		seed(f.harness);
		await expect(
			f.harness.session.prompt("synthetic question", { runBudget: { maxRequests: 1 } }),
		).rejects.toMatchObject({ name: "RunBudgetExceededError", code: "requests" });
		expect(total(f.harness)).toBeCloseTo(0.11);
		expect(f.requests).toHaveLength(1);
		expect(f.settlements).toEqual([]);
		// The native run already began before its answer dispatch was refused; retain its failed lifecycle.
		expect(f.harness.eventsOfType("agent_start")).toHaveLength(1);
		expect(f.harness.eventsOfType("prompt_settled")).toHaveLength(1);
		expect(f.harness.eventsOfType("prompt_settled")[0]).toMatchObject({ outcome: "failed" });
		expect(
			f.harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && /acceptance|goal_check|goal_round/.test(e.customType)),
		).toEqual([]);
		expect(await f.store.current()).toMatchObject({ status: "blocked", completedRounds: 0 });
		expect(f.harness.session.getRunBudgetSnapshot()).toMatchObject({
			requestsStarted: 1,
			activeRequests: 0,
			closed: true,
			exhaustedBy: "requests",
		});
	});

	it("accounts and stops on a true pre-agent failure without inventing any agent lifecycle", async () => {
		const f = await fixture([0.11]);
		seed(f.harness);
		const refusal = new Error("synthetic caller preflight failure");
		await expect(
			f.harness.session.prompt("synthetic question", {
				preflightResult: (accepted) => {
					if (accepted) throw refusal;
				},
			}),
		).rejects.toBe(refusal);
		expect(total(f.harness)).toBeCloseTo(0.11);
		expect(f.settlements).toEqual([]);
		expect(f.harness.eventsOfType("agent_start")).toEqual([]);
		expect(f.harness.eventsOfType("prompt_settled")).toEqual([]);
		expect(await f.store.current()).toMatchObject({ status: "blocked", completedRounds: 0 });
	});

	it("manual summaries are excluded even from an extension inside an eligible native prompt", async () => {
		let h: Harness;
		const f = await fixture([0.11, 0.07], {
			extensions: [
				(api) => {
					api.on("input", async (event) => {
						if (event.text === "manual inside") await h.session.compact();
					});
				},
			],
		});
		h = f.harness;
		seed(h, 100);
		await h.session.prompt("manual inside");
		expect(total(h)).toBeCloseTo(0.07);
		expect(f.requests).toHaveLength(2);
		expect(spendReceipts(h)).toHaveLength(1);
	});

	it("paused deliveries are discarded, never carried into a resumed goal", async () => {
		const f = await fixture([0.11, 0.07, 0.07], { paused: true });
		seed(f.harness);
		await f.harness.session.prompt("while paused");
		expect(spendReceipts(f.harness)).toEqual([]);
		await idle(f.harness);
		// Public resume queues its genuine continuation; only that later answer is charged.
		await f.harness.session.prompt("/goal resume");
		await vi.waitFor(() => expect(f.settlements).toHaveLength(2), { timeout: 5000 });
		expect(total(f.harness)).toBeCloseTo(0.07);
	});

	it("budgetless deliveries are not carried into a later budget", async () => {
		const f = await fixture([0.11, ...Array<number>(9).fill(0.07), 0.07], { budget: null });
		seed(f.harness);
		await f.harness.session.prompt("before budget");
		expect(spendReceipts(f.harness)).toEqual([]);
		await f.harness.session.prompt("/goal budget 0.05");
		await f.harness.session.prompt("after budget");
		expect(total(f.harness)).toBeCloseTo(0.07);
	});

	it.each(["0", "false", "off", "no-controller"])(
		"%s leaves summary stream/events/receipts unextended",
		async (mode) => {
			if (mode !== "no-controller") vi.stubEnv("OMK_GOAL_AUTONOMY", mode);
			const f = await fixture([0.11, 0.07], { goal: false, controller: mode !== "no-controller" });
			seed(f.harness);
			await f.harness.session.prompt("synthetic question");
			expect(f.requests).toHaveLength(2);
			expect(spendReceipts(f.harness)).toEqual([]);
			expect(f.settlements).toHaveLength(1);
			expect(Object.keys(f.settlements[0]).sort()).toEqual(["aborted", "messages", "settlementId", "type"]);
			expect(settledRunCostUsd(f.settlements[0].messages)).toBe(0.07);
			expect(f.requests[0].keys).not.toContain("compactionUsage");
		},
	);

	it("selects the active goal and latest monetary cap at delivery, not dispatch", async () => {
		const entered = gate(),
			release = gate();
		const f = await fixture([
			{
				cost: 0.11,
				before: async () => {
					entered.resolve();
					await release.promise;
				},
			},
			0.07,
		]);
		seed(f.harness);
		const run = f.harness.session.prompt("synthetic question");
		await entered.promise;
		await f.harness.session.prompt("/goal pause");
		await f.harness.session.prompt("/goal clear");
		await f.harness.session.prompt("/goal replacement");
		await f.harness.session.prompt("/goal budget 0.15");
		const current = await f.store.current();
		release.resolve();
		await run;
		expect(total(f.harness)).toBeCloseTo(0.18);
		expect((await f.store.current())?.status).toBe("blocked");
		const spend = f.harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "custom" && e.customType === "goal_autonomy_spend");
		for (const entry of spend) expect(entry).toMatchObject({ data: { createdAt: current?.createdAt } });
	});

	it("external reload waits through summary accounting; own-scope reload refuses before the first summary", async () => {
		const entered = gate(),
			release = gate();
		const f = await fixture([
			{
				cost: 0.11,
				before: async () => {
					entered.resolve();
					await release.promise;
				},
			},
			0.07,
		]);
		seed(f.harness);
		const original = f.harness.session.extensionRunner;
		const run = f.harness.session.prompt("synthetic question");
		await entered.promise;
		let reloaded = false;
		const reload = f.harness.session.reload().then(() => {
			reloaded = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(reloaded).toBe(false);
		expect(f.harness.session.extensionRunner).toBe(original);
		release.resolve();
		await Promise.all([run, reload]);
		expect(total(f.harness)).toBeCloseTo(0.18);
		expect(f.harness.session.extensionRunner).not.toBe(original);
		let own: Harness;
		let refused = false;
		const g = await fixture([0.11, 0.07], {
			extensions: [
				(api) => {
					api.on("input", async (e) => {
						if (e.text !== "reload own scope") return;
						await expect(own.session.reload()).rejects.toThrow(/active.*accounting scope/);
						refused = true;
					});
				},
			],
		});
		own = g.harness;
		seed(own);
		await own.session.prompt("reload own scope");
		expect(refused).toBe(true);
		expect(total(own)).toBeCloseTo(0.18);
	});

	it("close waits for an in-flight preflight and accounts a billed aborted summary", async () => {
		const entered = gate(),
			release = gate();
		const f = await fixture([
			{
				cost: 0.11,
				before: async () => {
					entered.resolve();
					await release.promise;
				},
			},
		]);
		seed(f.harness);
		const run = f.harness.session.prompt("synthetic question").catch((error: unknown) => error);
		await entered.promise;
		let closed = false;
		const close = f.harness.session.close().then(() => {
			closed = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(closed).toBe(false);
		release.resolve();
		await close;
		expect(await run).toBeInstanceOf(Error);
		expect(total(f.harness)).toBeCloseTo(0.11);
		expect(f.settlements).toEqual([]);
	});

	it("restores persisted summary IDs and keeps unknown spend unknown after resume/restore", async () => {
		const unknown = {
			...fauxAssistantMessage("summary"),
			diagnostics: [{ type: "usage_incomplete", timestamp: Date.now() }],
		};
		const f = await fixture([{ cost: 0, response: unknown }, 0.07, 0.07], { persist: true });
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(total(f.harness)).toBeUndefined();
		const file = f.harness.session.sessionFile;
		if (!file) throw new Error("missing persistent session");
		const recorded = spendReceipts(f.harness);
		await idle(f.harness);
		await f.harness.session.prompt("/goal resume");
		await vi.waitFor(() => expect(f.settlements).toHaveLength(2), { timeout: 5000 });
		await idle(f.harness);
		await f.harness.session.close();
		const restored = new GoalAutonomy(
			{
				appendEntry: () => {
					throw new Error("duplicate persisted receipt");
				},
			},
			new GoalAcceptance(),
		);
		restored.restore(SessionManager.open(file).getBranch());
		const goal = await f.store.current();
		if (!goal) throw new Error("missing goal");
		expect(restored.observeCost(goal, 0.11, recorded[0].settlementId).spentUsd).toBeUndefined();
		expect((await f.store.current())?.status).toBe("blocked");
	});

	it("counts a discarded automatic summary and its real transaction regeneration", async () => {
		let h: Harness;
		const f = await fixture([
			{
				cost: 0.11,
				before: () => {
					h.sessionManager.appendMessage({
						role: "user",
						content: "concurrent non-inert append",
						timestamp: Date.now(),
					});
				},
			},
			0.13,
			0.07,
		]);
		h = f.harness;
		seed(h);
		await h.session.prompt("synthetic question");
		expect(f.requests).toHaveLength(3);
		expect(h.sessionManager.getEntries().filter((e) => e.type === "compaction")).toHaveLength(1);
		expect(total(h)).toBeCloseTo(0.31);
		expect(f.settlements).toHaveLength(1);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.07);
	});

	it("retains billed quota failure before deterministic rescue, without charging the trim", async () => {
		const f = await fixture([
			{ cost: 0.02, kind: "error", errorText: "billing hard limit reached: insufficient_quota" },
			0.07,
		]);
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(f.requests).toHaveLength(2);
		expect(total(f.harness)).toBeCloseTo(0.09);
		const compaction = f.harness.sessionManager.getEntries().find((e) => e.type === "compaction");
		expect(compaction).toMatchObject({ details: { deterministicEmergency: true } });
	});

	it("includes billed compaction-model failure and the real session-model rescue", async () => {
		const f = await fixture(
			[{ cost: 0.02, kind: "error", errorText: "billing hard limit reached: insufficient_quota" }, 0.11, 0.07],
			{ compactor: true },
		);
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(f.requests.map((r) => r.model)).toEqual([
			"compaction-only-offline",
			"compaction-accounting-offline",
			"compaction-accounting-offline",
		]);
		expect(total(f.harness)).toBeCloseTo(0.2);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.07);
	});

	it.each(["1", "0", "false", "off"])(
		"OAuth recovery preserves fresh per-attempt summary options with autonomy=%s",
		async (mode) => {
			vi.stubEnv("OMK_GOAL_AUTONOMY", mode);
			const f = await fixture([{ cost: 0.02, kind: "error", errorText: "401 token_expired" }, 0.11, 0.13, 0.07], {
				reasoning: true,
				goal: mode === "1",
			});
			// Only the credential boundary is deterministic; OAuth recovery, summaries and accounting remain real.
			const refresh = vi
				.spyOn(f.harness.session.modelRegistry, "refreshRejectedOAuthToken")
				.mockImplementation(async () => {
					f.harness.session.setThinkingLevel("off");
					return "synthetic-refreshed-token";
				});
			seed(f.harness);
			await f.harness.session.prompt("synthetic question");
			expect(refresh).toHaveBeenCalledTimes(1);
			expect(f.requests[0].reasoning).toBeDefined();
			expect(f.requests[1].reasoning).toBeUndefined();
			// The public thinking change moves the captured transcript head, so the real transaction regenerates once.
			expect(f.requests).toHaveLength(4);
			expect(total(f.harness)).toBeCloseTo(mode === "1" ? 0.33 : 0);
			expect(
				f.settlements.map((s) => ({
					cost: settledRunCostUsd(s.messages),
					roles: s.messages.map((m) => m.role),
					id: s.settlementId,
				})),
			).toEqual([{ cost: 0.07, roles: ["user", "assistant"], id: expect.any(String) }]);
		},
	);

	it("keeps queued input ahead of the budget stop and accounts only after its genuine answers", async () => {
		let h: Harness;
		const f = await fixture([{ cost: 0.11, before: () => h.session.followUp("queued user input") }, 0.07, 0.09]);
		h = f.harness;
		seed(h);
		await h.session.prompt("synthetic question");
		expect(f.requests).toHaveLength(3);
		expect(f.settlements).toHaveLength(1);
		expect(total(h)).toBeCloseTo(0.27);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.16);
		expect((await f.store.current())?.status).toBe("blocked");
	});

	it("extension-supplied summaries invoke no summary adapter and add no zero-cost receipt", async () => {
		const f = await fixture([0.07], {
			extensions: [
				(api) => {
					api.on("session_before_compact", (event) => ({
						compaction: {
							summary: "extension-supplied synthetic summary",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		seed(f.harness);
		await f.harness.session.prompt("synthetic question");
		expect(f.requests).toHaveLength(1);
		expect(spendReceipts(f.harness)).toHaveLength(1);
		expect(total(f.harness)).toBeCloseTo(0.07);
	});

	it("fail-fast postflight keeps an unresolved parallel request unknown and seals its late result", async () => {
		const entered = gate(),
			release = gate();
		const f = await fixture([
			{ cost: 0.07, tokens: 179_990 },
			{
				cost: 0.11,
				before: async () => {
					entered.resolve();
					await release.promise;
				},
			},
			{ cost: 0.13, kind: "error", errorText: "invalid unsupported parameter" },
		]);
		seed(f.harness, 100);
		const run = f.harness.session.prompt("synthetic question");
		await entered.promise;
		await run;
		expect(f.harness.session.getRunBudgetSnapshot()?.activeRequests).toBe(1);
		expect(total(f.harness)).toBeUndefined();
		expect(spendReceipts(f.harness).map((e) => e.costUsd)).toEqual([null, 0.07]);
		expect(f.settlements).toHaveLength(1);
		release.resolve();
		await vi.waitFor(() => expect(f.harness.session.getRunBudgetSnapshot()?.activeRequests).toBe(0));
		expect(spendReceipts(f.harness).map((e) => e.costUsd)).toEqual([null, 0.07]);
	});

	it.each([false, true])("accounts custom-message native producer, deferred=%s", async (deferred) => {
		const entered = gate(),
			release = gate();
		const steps: Step[] = [{ cost: 0.07, tokens: 179_990 }, 0.11];
		if (deferred)
			steps.unshift({
				cost: 0.09,
				before: async () => {
					entered.resolve();
					await release.promise;
				},
			});
		const f = await fixture(steps);
		seed(f.harness, 100);
		const manual = deferred ? f.harness.session.compact() : undefined;
		if (deferred) await entered.promise;
		const send = f.harness.session.sendCustomMessage(
			{ customType: "synthetic-trigger", content: "synthetic question", display: false },
			{ triggerTurn: true },
		);
		release.resolve();
		await manual;
		await send;
		await vi.waitFor(() => expect(f.settlements).toHaveLength(1));
		// Custom input does not create the user-turn prefix of the split-summary fixture.
		expect(total(f.harness)).toBeCloseTo(0.18);
		expect(f.requests).toHaveLength(deferred ? 3 : 2);
		expect(settledRunCostUsd(f.settlements[0].messages)).toBeCloseTo(0.07);
		expect(f.settlements[0].messages.map((m) => m.role)).toEqual(["custom", "assistant"]);
	});

	it("branch summaries remain excluded and cannot carry into later prompt accounting", async () => {
		const f = await fixture([0.11, 0.07]);
		seed(f.harness, 100);
		const target = f.harness.sessionManager.getLeafId();
		if (!target) throw new Error("missing branch target");
		seed(f.harness, 100);
		const result = await f.harness.session.navigateTree(target, { summarize: true });
		expect(result.summaryEntry).toBeDefined();
		expect(spendReceipts(f.harness)).toEqual([]);
		await f.harness.session.prompt("after branch summary");
		expect(total(f.harness)).toBeCloseTo(0.07);
	});

	it("preserves the original request-budget failure when bookkeeping fails, then redelivers the same ID", async () => {
		const f = await fixture([0.11, 0.07]);
		seed(f.harness);
		const ids: string[] = [];
		const errors: string[] = [];
		f.harness.session.extensionRunner.onError((event) => errors.push(event.error));
		const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
		vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (
				type === "goal_autonomy_spend" &&
				(data as { settlementId: string }).settlementId.startsWith("compaction-usage:")
			) {
				ids.push((data as { settlementId: string }).settlementId);
				if (ids.length === 1) throw new Error("synthetic accounting append failure");
			}
			return append(type, data);
		});
		await expect(f.harness.session.prompt("request cap", { runBudget: { maxRequests: 1 } })).rejects.toBeInstanceOf(
			RunBudgetExceededError,
		);
		expect(errors).toContain("synthetic accounting append failure");
		expect(spendReceipts(f.harness)).toEqual([]);
		expect(f.settlements).toEqual([]);
		await f.harness.session.prompt("later explicit user work");
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
		// Redelivery stops the current goal before the new explicit user's answer; blocked costs stay excluded.
		expect(total(f.harness)).toBeCloseTo(0.11);
		expect(f.requests).toHaveLength(2);
		expect(f.settlements).toHaveLength(1);
	});

	it.each([1, 3])(
		"retains the genuine settlement through %i failed summary appends and redelivery",
		async (failures) => {
			const f = await fixture([0.11, 0.07, 0.09]);
			seed(f.harness);
			const started = vi.spyOn(SessionExtensionSettlement.prototype, "start");
			const order: string[] = [];
			f.harness.session.subscribe((event) => {
				if (event.type === "agent_end" || event.type === "prompt_settled") order.push(event.type);
			});
			const emit = f.harness.session.extensionRunner.emit.bind(f.harness.session.extensionRunner);
			vi.spyOn(f.harness.session.extensionRunner, "emit").mockImplementation(async (event) => {
				if (event.type === "agent_settled") order.push(`settled:${event.settlementId}`);
				return emit(event);
			});
			const ids: string[] = [];
			const errors: string[] = [];
			f.harness.session.extensionRunner.onError((event) => errors.push(event.error));
			const append = f.harness.sessionManager.appendCustomEntry.bind(f.harness.sessionManager);
			const failure = new Error("genuine settlement summary append failure");
			vi.spyOn(f.harness.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
				if (
					type === "goal_autonomy_spend" &&
					(data as { settlementId: string }).settlementId.startsWith("compaction-usage:")
				) {
					ids.push((data as { settlementId: string }).settlementId);
					if (ids.length <= failures) {
						expect(f.settlements).toEqual([]);
						expect(f.requests).toHaveLength(2);
						expect(
							f.harness.sessionManager
								.getEntries()
								.filter((e) => e.type === "custom" && /acceptance|goal_round/.test(e.customType)),
						).toEqual([]);
						throw failure;
					}
				}
				return append(type, data);
			});
			await expect(f.harness.session.prompt("original genuine answer")).rejects.toBe(failure);
			const original = started.mock.calls[0][0];
			const answer = f.harness.eventsOfType("message_end").find((e) => e.message.role === "assistant")?.message;
			expect(original.messages.at(-1)).toBe(answer);
			expect(original.settlementId).toMatch(/^prompt-run-.*#1$/);
			for (let retryIndex = 0; retryIndex <= failures && ids.length <= failures; retryIndex++) {
				const retry = f.harness.session.prompt("later explicit user work");
				if (ids.length < failures) await expect(retry).rejects.toBe(failure);
				else await retry;
			}
			console.info("genuine-settlement-redelivery", {
				failures,
				ids,
				originalId: original.settlementId,
				delivered: f.settlements.map((s) => ({ id: s.settlementId, cost: settledRunCostUsd(s.messages) })),
				costs: spendReceipts(f.harness).map((r) => r.costUsd),
				order,
				errors,
			});
			expect.soft(total(f.harness)).toBeCloseTo(0.18);
			expect.soft(f.settlements.filter((s) => s === original)).toHaveLength(1);
			expect.soft(f.settlements.find((s) => s === original)?.messages.at(-1)).toBe(answer);
			expect
				.soft(spendReceipts(f.harness).filter((r) => r.settlementId === original.settlementId))
				.toEqual([expect.objectContaining({ costUsd: 0.07 })]);
			expect(new Set(ids).size).toBe(1);
			expect.soft(order.indexOf(`settled:${original.settlementId}`)).toBeGreaterThan(order.indexOf("agent_end"));
			expect.soft(order.indexOf(`settled:${original.settlementId}`)).toBeLessThan(order.indexOf("prompt_settled"));
			expect(await f.store.current()).toMatchObject({ status: "blocked", completedRounds: 0 });
		},
	);
});
