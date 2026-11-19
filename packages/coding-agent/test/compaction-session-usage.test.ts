import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapBudgetStream } from "../src/core/budget-stream.ts";
import { SessionCompactionUsage } from "../src/core/compaction/session-usage.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { GoalAutonomy } from "../src/core/extensions/builtin/goal-autonomy.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import { findGoalCostSink, registerGoalCostAccounting } from "../src/core/extensions/builtin/goal-cost-accounting.ts";
import { createExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "../src/core/extensions/loader.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import { RequestInputAdmissionError } from "../src/core/request-admission-policy.ts";
import { RunBudget } from "../src/core/run-budget.ts";
import { RunBudgetExceededError } from "../src/core/run-budget-policy.ts";
import { SessionRunBudget } from "../src/core/session-run-budget.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];
beforeEach(() => {
	vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0");
	vi.stubEnv("OMK_RESOURCE_GOVERNOR", "off");
	vi.stubGlobal("fetch", () => {
		throw new Error("Network forbidden");
	});
});
afterEach(async () => {
	for (const h of harnesses.splice(0)) {
		await h.session.close();
		h.cleanup();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function message(cost: number): AssistantMessage {
	return {
		...fauxAssistantMessage("summary"),
		usage: {
			input: 10,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 12,
			cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
		},
	};
}
function stream(response: AssistantMessage) {
	const result = createAssistantMessageEventStream();
	result.push({ type: "done", reason: "stop", message: response });
	result.end(response);
	return result;
}
function gate() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function fixture() {
	const h = await createHarness({ extensionFactories: [goalController] });
	harnesses.push(h);
	await h.session.prompt("/goal internal usage boundary");
	await h.session.prompt("/goal budget 1");
	const collector = new SessionCompactionUsage(h.session);
	const receipts = () =>
		h.sessionManager
			.getEntries()
			.flatMap((e) =>
				e.type === "custom" && e.customType === "goal_autonomy_spend"
					? [e.data as { costUsd: number | null; settlementId: string }]
					: [],
			);
	return { h, collector, receipts };
}

async function nativeFixture() {
	const f = await fixture();
	const native = new SessionRunBudget(f.h.session.agent, {
		assertIdle: () => {},
		stop: () => {},
		reject: () => {},
	});
	const collector = new SessionCompactionUsage({
		sessionId: f.h.session.sessionId,
		extensionRunner: f.h.session.extensionRunner,
		resourceLoader: f.h.session.resourceLoader,
		agent: f.h.session.agent,
		getRunBudgetSnapshot: () => native.snapshot(),
	});
	return { ...f, collector, native };
}

describe("private automatic summary observation boundaries", () => {
	it("returns the original stream, observes once despite repeated result reads, and counts reused objects per invocation", async () => {
		const f = await fixture();
		const response = message(0.11);
		const original = stream(response);
		await f.collector.run(async () => {
			const wrapped = f.collector.stream(() => original, "threshold");
			for (let i = 0; i < 2; i++) {
				const returned = await wrapped(f.h.getModel(), { messages: [] });
				expect(returned).toBe(original);
				expect(await returned.result()).toBe(response);
				expect(await returned.result()).toBe(response);
			}
			await Promise.all([f.collector.flush(), f.collector.flush()]);
		});
		expect(f.receipts()).toHaveLength(1);
		expect(f.receipts()[0].costUsd).toBeCloseTo(0.22);
	});

	it.each(["incomplete", "absent", "negative", "nan", "infinity", "default-zero", "overflow"])(
		"seals %s as unknown",
		async (kind) => {
			const f = await fixture();
			let response = message(0.11);
			if (kind === "incomplete") response.diagnostics = [{ type: "usage_incomplete", timestamp: Date.now() }];
			if (kind === "absent") Reflect.deleteProperty(response, "usage");
			if (kind === "negative") response.usage.cost.total = -1;
			if (kind === "nan") response.usage.cost.total = Number.NaN;
			if (kind === "infinity") response.usage.cost.total = Number.POSITIVE_INFINITY;
			if (kind === "default-zero") response = fauxAssistantMessage("no usage");
			if (kind === "overflow") response = message(Number.MAX_VALUE);
			await f.collector.run(async () => {
				const wrapped = f.collector.stream(() => stream(response), "overflow");
				await (await wrapped(f.h.getModel(), { messages: [] })).result();
				if (kind === "overflow") await (await wrapped(f.h.getModel(), { messages: [] })).result();
			});
			expect(f.receipts()).toHaveLength(1);
			expect(f.receipts()[0].costUsd).toBeNull();
		},
	);

	it("knows zero-price positive usage, but emits no empty receipt", async () => {
		const f = await fixture();
		await f.collector.run(async () => {});
		expect(f.receipts()).toEqual([]);
		await f.collector.run(async () => {
			await (
				await f.collector.stream(() => stream(message(0)), "threshold")(f.h.getModel(), { messages: [] })
			).result();
		});
		expect(f.receipts()[0].costUsd).toBe(0);
	});

	it.each(["budget", "input"])("excludes a real native %s preflight refusal before dispatch", async (kind) => {
		const f = await nativeFixture();
		vi.stubEnv("OMK_REQUEST_ADMISSION_MODE", "enforce");
		let dispatched = 0;
		f.h.session.agent.streamFn = () => {
			dispatched++;
			return stream(message(0.07));
		};
		await expect(
			f.native.execute({ maxRequests: 1 }, async () => {
				const source = f.h.session.agent.streamFn;
				if (kind === "budget") await (await source(f.h.getModel(), { messages: [] })).result();
				await f.collector.run(async () => {
					await f.collector.stream(source, "threshold")(
						{ ...f.h.getModel(), ...(kind === "input" ? { contextWindow: 1 } : {}) },
						{ messages: [] },
					);
				}, source);
			}),
		).rejects.toBeInstanceOf(kind === "budget" ? RunBudgetExceededError : RequestInputAdmissionError);
		expect(dispatched).toBe(kind === "budget" ? 1 : 0);
		expect(f.native.snapshot()).toMatchObject({ requestsStarted: dispatched, activeRequests: 0 });
		expect(f.receipts()).toEqual([]);
	});

	it.each(["budget", "input"])("keeps installed native post-dispatch %s result failures unknown", async (kind) => {
		const f = await nativeFixture();
		const failure =
			kind === "budget"
				? new RunBudgetExceededError("requests")
				: new RequestInputAdmissionError({ reason: "over_capacity" });
		const original = stream(message(0.11));
		original.result = () => {
			throw failure;
		};
		f.h.session.agent.streamFn = () => original;
		await expect(
			f.native.execute(undefined, () =>
				f.collector.run(async () => {
					await f.collector.stream(f.h.session.agent.streamFn, "threshold")(f.h.getModel(), { messages: [] });
				}, f.h.session.agent.streamFn),
			),
		).rejects.toBe(failure);
		expect(f.native.snapshot()).toMatchObject({ requestsStarted: 1, activeRequests: 1, closed: true });
		expect(f.receipts().map((r) => r.costUsd)).toEqual([null]);
	});

	it.each(["budget", "input"])("keeps composed post-dispatch %s result failures unknown and owned", async (kind) => {
		const f = await fixture();
		const failure =
			kind === "budget"
				? new RunBudgetExceededError("requests")
				: new RequestInputAdmissionError({ reason: "over_capacity" });
		const budget = new RunBudget(undefined, () => {});
		const original = stream(message(0.11));
		original.result = () => {
			throw failure;
		};
		let dispatched = 0;
		const source = wrapBudgetStream(() => {
			dispatched++;
			return original;
		}, budget);
		try {
			await expect(
				f.collector.run(async () => {
					await f.collector.stream(source, "threshold")(f.h.getModel(), { messages: [] });
				}),
			).rejects.toBe(failure);
			expect(dispatched).toBe(1);
			expect(budget.snapshot()).toMatchObject({ requestsStarted: 1, activeRequests: 1 });
			console.info("composed-result-failure", { kind, budget: budget.snapshot(), receipts: f.receipts() });
			expect(f.receipts().map((r) => r.costUsd)).toEqual([null]);
		} finally {
			budget.close();
		}
	});

	it.each(["budget", "input"])("does not trust an unwrapped %s error class as no-dispatch proof", async (kind) => {
		const f = await fixture();
		const failure =
			kind === "budget"
				? new RunBudgetExceededError("requests")
				: new RequestInputAdmissionError({ reason: "over_capacity" });
		await expect(
			f.collector.run(async () => {
				await f.collector.stream(() => {
					throw failure;
				}, "threshold")(f.h.getModel(), { messages: [] });
			}),
		).rejects.toBe(failure);
		expect(f.receipts().map((r) => r.costUsd)).toEqual([null]);
	});

	it("samples native refusal synchronously even when a parallel summary admits before its catch", async () => {
		const f = await nativeFixture();
		vi.stubEnv("OMK_REQUEST_ADMISSION_MODE", "enforce");
		f.h.session.agent.streamFn = () => stream(message(0.11));
		await f.native.execute(undefined, () =>
			f.collector.run(async () => {
				const observed = f.collector.stream(f.h.session.agent.streamFn, "overflow");
				const refused = observed({ ...f.h.getModel(), contextWindow: 1 }, { messages: [] });
				const admitted = observed(f.h.getModel(), { messages: [] });
				await expect(refused).rejects.toBeInstanceOf(RequestInputAdmissionError);
				await (await admitted).result();
			}, f.h.session.agent.streamFn),
		);
		expect(f.native.snapshot()).toMatchObject({ requestsStarted: 1, activeRequests: 0 });
		expect(f.receipts().map((r) => r.costUsd)).toEqual([0.11]);
	});

	it("does not reuse an earlier preflight error as proof for a dispatched result failure", async () => {
		const f = await nativeFixture();
		vi.stubEnv("OMK_REQUEST_ADMISSION_MODE", "enforce");
		const original = stream(message(0.11));
		f.h.session.agent.streamFn = () => original;
		await expect(
			f.native.execute(undefined, () =>
				f.collector.run(async () => {
					const observed = f.collector.stream(f.h.session.agent.streamFn, "overflow");
					let refusal: unknown;
					try {
						await observed({ ...f.h.getModel(), contextWindow: 1 }, { messages: [] });
					} catch (error) {
						refusal = error;
					}
					expect(refusal).toBeInstanceOf(RequestInputAdmissionError);
					original.result = () => {
						throw refusal;
					};
					await observed(f.h.getModel(), { messages: [] });
				}, f.h.session.agent.streamFn),
			),
		).rejects.toBeInstanceOf(RequestInputAdmissionError);
		expect(f.native.snapshot()).toMatchObject({ requestsStarted: 1, activeRequests: 1 });
		expect(f.receipts().map((r) => r.costUsd)).toEqual([null]);
	});

	it("does not trust a replacement source even inside a native scope", async () => {
		const f = await nativeFixture();
		await expect(
			f.native.execute(undefined, () =>
				f.collector.run(async () => {
					f.h.session.agent.streamFn = async () => {
						throw new RunBudgetExceededError("requests");
					};
					await f.collector.stream(f.h.session.agent.streamFn, "overflow")(f.h.getModel(), { messages: [] });
				}, f.h.session.agent.streamFn),
			),
		).rejects.toBeInstanceOf(RunBudgetExceededError);
		expect(f.native.snapshot()).toMatchObject({ requestsStarted: 0, activeRequests: 0 });
		expect(f.receipts().map((r) => r.costUsd)).toEqual([null]);
	});

	it("seals a fail-fast parallel sibling as unknown and ignores its late result in the next scope", async () => {
		const f = await fixture();
		await f.h.session.prompt("/goal budget - 2099-01-01T00:00:00.000Z");
		const late = createAssistantMessageEventStream();
		await f.collector.run(async () => {
			const first = await f.collector.stream(() => stream(message(0.11)), "overflow")(f.h.getModel(), {
				messages: [],
			});
			await first.result();
			await f.collector.stream(() => late, "overflow")(f.h.getModel(), { messages: [] });
		});
		expect(f.receipts()[0].costUsd).toBeNull();
		late.end(message(0.13));
		await f.collector.run(async () => {
			await (
				await f.collector.stream(() => stream(message(0.07)), "threshold")(f.h.getModel(), { messages: [] })
			).result();
		});
		expect(f.receipts().map((e) => e.costUsd)).toEqual([null, 0.07]);
	});

	it("retries a failed append with the identical batch ID after restoring actual receipts", async () => {
		const f = await fixture();
		const append = f.h.sessionManager.appendCustomEntry.bind(f.h.sessionManager);
		const ids: string[] = [];
		vi.spyOn(f.h.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (type === "goal_autonomy_spend") {
				ids.push((data as { settlementId: string }).settlementId);
				if (ids.length === 1) throw new Error("synthetic append failure");
			}
			return append(type, data);
		});
		await expect(
			f.collector.run(async () => {
				await (
					await f.collector.stream(() => stream(message(0.11)), "threshold")(f.h.getModel(), { messages: [] })
				).result();
				await f.collector.flush();
			}),
		).rejects.toThrow("synthetic append failure");
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
		expect(f.receipts()).toHaveLength(1);
		expect(f.receipts()[0].costUsd).toBe(0.11);
		const goal = await new DurableGoalStore(join(f.h.tempDir, ".omk", "goals", "current.json")).current();
		if (!goal) throw new Error("missing goal");
		const restored = new GoalAutonomy(
			{
				appendEntry: () => {
					throw new Error("duplicate append");
				},
			},
			new GoalAcceptance(),
		);
		restored.restore(f.h.sessionManager.getBranch());
		expect(restored.observeCost(goal, 0.11, f.receipts()[0].settlementId).spentUsd).toBe(0.11);
	});

	it("rejects duplicate registration and multiple loaded sinks, without dispatch", async () => {
		const f = await fixture();
		expect(() =>
			findGoalCostSink([
				...f.h.session.resourceLoader.getExtensions().extensions,
				...f.h.session.resourceLoader.getExtensions().extensions,
			]),
		).toThrow(/one|multiple|duplicate/i);
		await expect(
			loadExtensionFromFactory(
				(api) => {
					goalController(api);
					registerGoalCostAccounting(api, new GoalAutonomy(api, new GoalAcceptance()));
				},
				f.h.tempDir,
				createEventBus(),
				createExtensionRuntime(),
			),
		).rejects.toThrow(/one|multiple|duplicate/i);
	});

	it("persists cross-batch accumulation overflow as null, including after restoring receipts", async () => {
		const f = await fixture();
		await f.collector.run(async () => {
			const wrapped = f.collector.stream(() => stream(message(Number.MAX_VALUE)), "threshold");
			await (await wrapped(f.h.getModel(), { messages: [] })).result();
			await f.collector.flush();
			await (await wrapped(f.h.getModel(), { messages: [] })).result();
		});
		expect(f.receipts().map((e) => e.costUsd)).toEqual([Number.MAX_VALUE, null]);
	});

	it("redelivers the identical persisted batch once and rejects a wrong session", async () => {
		const f = await fixture();
		const sink = findGoalCostSink(f.h.session.resourceLoader.getExtensions().extensions);
		if (!sink) throw new Error("missing loaded sink");
		const batch = { sessionId: f.h.session.sessionId, settlementId: "compaction-usage:duplicate#1", costUsd: 0.11 };
		const ctx = f.h.session.extensionRunner.createContext();
		await sink(batch, ctx, false);
		await sink(batch, ctx, false);
		expect(f.receipts()).toEqual([
			{ costUsd: 0.11, settlementId: batch.settlementId, goalId: "session", createdAt: expect.any(String) },
		]);
		await expect(sink({ ...batch, sessionId: "wrong-session" }, ctx, false)).rejects.toThrow(/Stale/);
		expect(f.receipts()).toHaveLength(1);
	});

	it("treats a result rejection or a synchronous result failure as unknown even for a typed error", async () => {
		const f = await fixture();
		await f.h.session.prompt("/goal budget - 2099-01-01T00:00:00.000Z");
		for (const synchronous of [false, true]) {
			const failure = new RunBudgetExceededError("requests");
			const original = stream(message(0.11));
			original.result = () => {
				if (synchronous) throw failure;
				return Promise.reject(failure);
			};
			await expect(
				f.collector.run(async () => {
					await (await f.collector.stream(() => original, "threshold")(f.h.getModel(), { messages: [] })).result();
				}),
			).rejects.toBe(failure);
		}
		expect(f.receipts().map((e) => e.costUsd)).toEqual([null, null]);
	});

	it("disabled or absent sink leaves the original function, stream, options and metadata alone", async () => {
		for (const mode of ["0", "false", "off", "absent"]) {
			vi.stubEnv("OMK_GOAL_AUTONOMY", mode);
			const h = await createHarness({ extensionFactories: mode === "absent" ? [] : [goalController] });
			harnesses.push(h);
			const collector = new SessionCompactionUsage(h.session);
			const original = stream(message(0.11));
			const options = { maxTokens: 100 };
			const source = (_model: unknown, _context: unknown, actual: unknown) => {
				expect(actual).toBe(options);
				return original;
			};
			await collector.run(async () => {
				expect(collector.stream(source, "threshold")).toBe(source);
				expect(await collector.stream(source, "threshold")(h.getModel(), { messages: [] }, options)).toBe(original);
			});
			expect(findGoalCostSink(h.session.resourceLoader.getExtensions().extensions)).toBeUndefined();
			expect(h.sessionManager.getEntries()).toEqual([]);
		}
	});

	it("never delivers an old scope to a replacement runner", async () => {
		const f = await fixture();
		await expect(
			f.collector.run(async () => {
				await (
					await f.collector.stream(() => stream(message(0.11)), "threshold")(f.h.getModel(), { messages: [] })
				).result();
				// Replace the real runtime; this supplementary collector must not attach its old batch to it.
				await f.h.session.reload();
			}),
		).rejects.toThrow(/Stale.*runtime/);
		expect(f.receipts()).toEqual([]);
	});

	it("captures the exact original context factory at scope entry", async () => {
		const f = await fixture();
		const runner = f.h.session.extensionRunner;
		let restore = () => {};
		try {
			await f.collector.run(async () => {
				const spy = vi.spyOn(runner, "createContext").mockImplementation(() => {
					throw new Error("replacement context factory");
				});
				restore = () => spy.mockRestore();
				await (
					await f.collector.stream(() => stream(message(0.11)), "threshold")(f.h.getModel(), { messages: [] })
				).result();
			});
		} finally {
			restore();
		}
		expect(f.receipts()[0].costUsd).toBeCloseTo(0.11);
	});

	it("keeps an original failure primary even when the bookkeeping error reporter throws", async () => {
		const f = await fixture();
		const primary = new Error("primary operation failure");
		const append = f.h.sessionManager.appendCustomEntry.bind(f.h.sessionManager);
		const ids: string[] = [];
		vi.spyOn(f.h.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (type === "goal_autonomy_spend") {
				ids.push((data as { settlementId: string }).settlementId);
				if (ids.length === 1) throw new Error("bookkeeping failure");
			}
			return append(type, data);
		});
		let reports = 0;
		f.h.session.extensionRunner.onError(() => {
			reports++;
			throw new Error("reporter failure");
		});
		await expect(
			f.collector.run(async () => {
				await (
					await f.collector.stream(() => stream(message(0.11)), "threshold")(f.h.getModel(), { messages: [] })
				).result();
				throw primary;
			}),
		).rejects.toBe(primary);
		expect(reports).toBe(1);
		expect(f.receipts()).toEqual([]);
		await f.collector.run(async () => {});
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
		expect(f.receipts()[0].costUsd).toBeCloseTo(0.11);
	});

	it("transfers the private non-enumerable sink through the stock file loader as well as inline factories", async () => {
		const f = await fixture();
		const file = join(f.h.tempDir, "synthetic-goal-extension.ts");
		const controller = fileURLToPath(new URL("../src/core/extensions/builtin/goal-controller.ts", import.meta.url));
		writeFileSync(file, `import goalController from ${JSON.stringify(controller)}; export default goalController;\n`);
		const loaded = await loadExtensions([file], f.h.tempDir);
		expect(loaded.errors).toEqual([]);
		expect(findGoalCostSink(loaded.extensions)).toBeDefined();
		const inline = f.h.session.resourceLoader.getExtensions().extensions[0];
		for (const extension of [inline, loaded.extensions[0]]) {
			expect(
				Object.getOwnPropertySymbols(extension).some(
					(symbol) => !Object.getOwnPropertyDescriptor(extension, symbol)?.enumerable,
				),
			).toBe(true);
			expect(Object.keys(extension)).not.toContain("goalCostSink");
		}
	});

	it.each(["duplicate", "enumerable", "accessor"])(
		"fails closed on %s private metadata at the loader boundary",
		async (kind) => {
			const f = await fixture();
			let getterCalls = 0;
			await expect(
				loadExtensionFromFactory(
					(api) => {
						if (kind === "duplicate") goalController(api);
						Object.defineProperty(
							api,
							Symbol("goal-compaction-cost"),
							kind === "accessor"
								? {
										get: () => {
											getterCalls++;
											throw new Error("must not read getter");
										},
									}
								: { value: async () => {}, enumerable: kind === "enumerable" },
						);
					},
					f.h.tempDir,
					createEventBus(),
					createExtensionRuntime(),
				),
			).rejects.toThrow(/Duplicate|Invalid private/);
			expect(getterCalls).toBe(0);
		},
	);

	it("external reload also joins a producer while it redelivers a previously failed batch", async () => {
		const f = await fixture();
		const requested = gate(),
			entered = gate(),
			finish = gate();
		const runner = f.h.session.extensionRunner;
		const originalContext = runner.createContext.bind(runner);
		let arm = false;
		const contextSpy = vi.spyOn(runner, "createContext").mockImplementation(() => {
			if (arm) {
				arm = false;
				requested.resolve();
			}
			return originalContext();
		});
		const append = f.h.sessionManager.appendCustomEntry.bind(f.h.sessionManager);
		let attempts = 0;
		vi.spyOn(f.h.sessionManager, "appendCustomEntry").mockImplementation((type, data) => {
			if (type === "goal_autonomy_spend" && attempts++ === 0) throw new Error("first append failed");
			return append(type, data);
		});
		await expect(
			f.collector.run(async () => {
				await (
					await f.collector.stream(() => stream(message(0.11)), "threshold")(f.h.getModel(), { messages: [] })
				).result();
			}),
		).rejects.toThrow("first append failed");
		let reloaded = false;
		// This await is established outside the producer's ALS, just like an external reload caller.
		const reload = (async () => {
			await requested.promise;
			await f.collector.reload(async () => {
				reloaded = true;
				await f.h.session.reload();
			});
		})();
		arm = true;
		const run = f.collector.run(async () => {
			entered.resolve();
			await finish.promise;
		});
		await entered.promise;
		await new Promise<void>((resolve) => setImmediate(resolve));
		try {
			expect(reloaded).toBe(false);
		} finally {
			finish.resolve();
			await Promise.all([run, reload]);
			contextSpy.mockRestore();
		}
		expect(reloaded).toBe(true);
		expect(f.receipts().map((e) => e.costUsd)).toEqual([0.11]);
	});
});
