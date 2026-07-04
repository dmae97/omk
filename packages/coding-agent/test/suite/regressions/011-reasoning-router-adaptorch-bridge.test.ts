/**
 * Reasoning-router AdaptOrch advisory bridge - Goal 009 Lane B regression tests.
 *
 * The bridge module (src/core/adaptorch-bridge.ts) is a standalone, default-off,
 * advisory-only primitive. It is NOT wired into agent-session.ts by this lane
 * (see the read-first plan at
 * .omk/goals/008-reasoning-router-advanced-accuracy-plan/laneC-privacy-adaptorch.md,
 * Part B). These tests exercise the module entirely in isolation via an
 * injected fake advisory function and an injected clock - no real MCP call,
 * no real timers/waits beyond a handful of milliseconds for the timeout path.
 */
import { describe, expect, it } from "vitest";
import {
	ADAPTORCH_BRIDGE_DEFAULTS,
	ADAPTORCH_READONLY_TOOL_ALLOWLIST,
	type AdaptorchAdvisoryResult,
	type AdaptorchConsultPayload,
	containsForbiddenField,
	createAdaptorchBridge,
	isAdaptorchToolAllowed,
	looksMutatingToolName,
	sanitizeAdvisoryResult,
	sanitizeConsultPayload,
	withAdvisoryTimeout,
} from "../../../src/core/adaptorch-bridge.ts";

function validPayload(overrides: Partial<AdaptorchConsultPayload> = {}): AdaptorchConsultPayload {
	return {
		schemaVersion: 1,
		taskClass: "debug",
		runnerUp: "code-gen",
		marginBucket: "low",
		lenBucket: 3,
		hadFence: false,
		hadDiff: true,
		pressureBucket: 1,
		laneType: "coder",
		...overrides,
	};
}

function validResult(overrides: Partial<AdaptorchAdvisoryResult> = {}): AdaptorchAdvisoryResult {
	return {
		schemaVersion: 1,
		taskClass: "debug",
		confidenceBand: "high",
		...overrides,
	};
}

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeClock(startMs: number): { now: () => number; advance: (ms: number) => void } {
	let current = startMs;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

describe("adaptorch-bridge: sanitizeConsultPayload", () => {
	it("accepts a well-formed payload unchanged", () => {
		expect(sanitizeConsultPayload(validPayload())).toEqual(validPayload());
	});

	it("accepts a well-formed payload without the optional laneType", () => {
		const { laneType: _laneType, ...rest } = validPayload();
		const sanitized = sanitizeConsultPayload(rest);
		expect(sanitized).toEqual(rest);
		expect(sanitized).not.toHaveProperty("laneType");
	});

	it.each(["prompt", "promptHash", "filePath", "modelId", "sessionId", "toolName", "hookOutput", "providerId"])(
		"rejects a payload carrying a forbidden %s field",
		(field) => {
			const forbidden = { ...validPayload(), [field]: "leaked-value" };
			expect(sanitizeConsultPayload(forbidden)).toBeNull();
		},
	);

	it("rejects a payload with any unexpected extra key, even a benign one", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), extraDiagnostic: true })).toBeNull();
	});

	it("rejects an unknown taskClass/runnerUp enum value", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), taskClass: "not-a-class" })).toBeNull();
		expect(sanitizeConsultPayload({ ...validPayload(), runnerUp: "not-a-class" })).toBeNull();
	});

	it("rejects an unknown marginBucket or laneType enum value", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), marginBucket: "huge" })).toBeNull();
		expect(sanitizeConsultPayload({ ...validPayload(), laneType: "orchestrator" })).toBeNull();
	});

	it("rejects a non-boolean hadFence/hadDiff", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), hadFence: "yes" })).toBeNull();
		expect(sanitizeConsultPayload({ ...validPayload(), hadDiff: 1 })).toBeNull();
	});

	it("rejects a wrong schemaVersion", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), schemaVersion: 2 })).toBeNull();
	});

	it("rejects a lenBucket/pressureBucket of the wrong type instead of coercing it", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), lenBucket: "3" })).toBeNull();
		expect(sanitizeConsultPayload({ ...validPayload(), pressureBucket: null })).toBeNull();
	});

	it("clamps an out-of-range lenBucket into the closed [0,7] bound", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), lenBucket: 999 })?.lenBucket).toBe(7);
		expect(sanitizeConsultPayload({ ...validPayload(), lenBucket: -5 })?.lenBucket).toBe(0);
	});

	it("clamps a non-integer lenBucket down to a truncated integer within range", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), lenBucket: 3.9 })?.lenBucket).toBe(3);
	});

	it("clamps an out-of-range pressureBucket into the closed [0,3] bound", () => {
		expect(sanitizeConsultPayload({ ...validPayload(), pressureBucket: 50 })?.pressureBucket).toBe(3);
		expect(sanitizeConsultPayload({ ...validPayload(), pressureBucket: -1 })?.pressureBucket).toBe(0);
	});

	it("rejects non-object candidates without throwing", () => {
		expect(sanitizeConsultPayload(null)).toBeNull();
		expect(sanitizeConsultPayload(undefined)).toBeNull();
		expect(sanitizeConsultPayload("payload")).toBeNull();
		expect(sanitizeConsultPayload(42)).toBeNull();
		expect(sanitizeConsultPayload([validPayload()])).toBeNull();
	});
});

describe("adaptorch-bridge: sanitizeAdvisoryResult", () => {
	it("accepts a well-formed advisory result unchanged", () => {
		expect(sanitizeAdvisoryResult(validResult())).toEqual(validResult());
	});

	it("rejects a result carrying a forbidden-named field", () => {
		expect(sanitizeAdvisoryResult({ ...validResult(), toolName: "adaptorch_run" })).toBeNull();
		expect(sanitizeAdvisoryResult({ ...validResult(), sessionId: "abc" })).toBeNull();
	});

	it("rejects a result with any unexpected extra key", () => {
		expect(sanitizeAdvisoryResult({ ...validResult(), extra: 1 })).toBeNull();
	});

	it("rejects an unknown taskClass or confidenceBand enum value", () => {
		expect(sanitizeAdvisoryResult({ ...validResult(), taskClass: "unknown" })).toBeNull();
		expect(sanitizeAdvisoryResult({ ...validResult(), confidenceBand: "certain" })).toBeNull();
	});

	it("rejects a wrong schemaVersion", () => {
		expect(sanitizeAdvisoryResult({ ...validResult(), schemaVersion: 0 })).toBeNull();
	});

	it("rejects non-object candidates without throwing", () => {
		expect(sanitizeAdvisoryResult(null)).toBeNull();
		expect(sanitizeAdvisoryResult(undefined)).toBeNull();
		expect(sanitizeAdvisoryResult("result")).toBeNull();
		expect(sanitizeAdvisoryResult([validResult()])).toBeNull();
	});
});

describe("adaptorch-bridge: containsForbiddenField", () => {
	it("flags known-sensitive key names case-insensitively", () => {
		expect(containsForbiddenField({ PromptText: "x" })).toBe(true);
		expect(containsForbiddenField({ SessionID: "x" })).toBe(true);
		expect(containsForbiddenField({ ModelName: "x" })).toBe(true);
		expect(containsForbiddenField({ HookOutput: "x" })).toBe(true);
	});

	it("does not flag the legitimate closed-schema field names", () => {
		expect(containsForbiddenField(validPayload())).toBe(false);
		expect(containsForbiddenField(validResult())).toBe(false);
	});
});

describe("adaptorch-bridge: read-only tool allowlist", () => {
	it("contains exactly the two read/local tools identified in the read-first plan (section 4.2)", () => {
		expect(ADAPTORCH_READONLY_TOOL_ALLOWLIST.length).toBe(2);
		expect([...ADAPTORCH_READONLY_TOOL_ALLOWLIST].sort()).toEqual(
			["adaptorch_capabilities", "adaptorch_route_topology"].sort(),
		);
	});

	it("never allows a mutating tool name into the allowlist", () => {
		for (const name of ADAPTORCH_READONLY_TOOL_ALLOWLIST) {
			expect(looksMutatingToolName(name)).toBe(false);
			expect(isAdaptorchToolAllowed(name)).toBe(true);
		}
	});

	it("flags the real write tools (submit/cancel) as mutating and not allowed", () => {
		for (const name of ["adaptorch_run", "adaptorch_cancel_run"]) {
			expect(looksMutatingToolName(name)).toBe(true);
			expect(isAdaptorchToolAllowed(name)).toBe(false);
		}
	});

	it("rejects unrecognized or out-of-scope read tool names", () => {
		expect(isAdaptorchToolAllowed("adaptorch_get_run")).toBe(false);
		expect(isAdaptorchToolAllowed("adaptorch_list_runs")).toBe(false);
		expect(isAdaptorchToolAllowed("adaptorch_get_artifacts")).toBe(false);
		expect(isAdaptorchToolAllowed("adaptorch_get_traces")).toBe(false);
		expect(isAdaptorchToolAllowed("adaptorch_server_metrics")).toBe(false);
		expect(isAdaptorchToolAllowed("adaptorch_plan_catalog")).toBe(false);
		expect(isAdaptorchToolAllowed("something_else")).toBe(false);
	});

	it("uses the exact TTL/budget/circuit-breaker defaults from the read-first plan (section 4.8)", () => {
		expect(ADAPTORCH_BRIDGE_DEFAULTS).toEqual({
			ttlMs: 5 * 60 * 1000,
			minTtlMs: 30 * 1000,
			maxTtlMs: 5 * 60 * 1000,
			maxTurnsPerEntry: 10,
			cacheSize: 16,
			maxConsultsPerSession: 5,
			minIntervalMs: 60 * 1000,
			timeoutMs: 1500,
			minTimeoutMs: 1,
			maxTimeoutMs: 30 * 1000,
			failureThreshold: 3,
			cooldownMs: 10 * 60 * 1000,
		});
	});
});

describe("adaptorch-bridge: withAdvisoryTimeout", () => {
	it("resolves with the underlying value when it settles before the timeout", async () => {
		await expect(withAdvisoryTimeout(async () => "ok", 50)).resolves.toBe("ok");
	});

	it("rejects once the timeout elapses for a call that never settles", async () => {
		await expect(withAdvisoryTimeout(() => new Promise(() => {}), 10)).rejects.toThrow(/timed out/);
	});

	it("propagates a synchronous throw from the wrapped call as a rejection", async () => {
		await expect(
			withAdvisoryTimeout(() => {
				throw new Error("sync boom");
			}, 50),
		).rejects.toThrow("sync boom");
	});

	it("propagates an asynchronous rejection from the wrapped call", async () => {
		await expect(
			withAdvisoryTimeout(async () => {
				throw new Error("async boom");
			}, 50),
		).rejects.toThrow("async boom");
	});
});

describe("adaptorch-bridge: createAdaptorchBridge cache/TTL/budget/circuit-breaker", () => {
	it("returns no hint when the cache is empty (silent fallback)", () => {
		const bridge = createAdaptorchBridge({ advisoryFn: async () => validResult() });
		expect(bridge.getFreshHint(validPayload())).toBeNull();
	});

	it("caches a successful consult result and serves it back from getFreshHint", async () => {
		const clock = makeClock(0);
		const bridge = createAdaptorchBridge({ advisoryFn: async () => validResult(), now: clock.now, minIntervalMs: 0 });
		const result = await bridge.consult(validPayload());
		expect(result).toEqual(validResult());
		expect(bridge.getFreshHint(validPayload())).toEqual(validResult());
	});

	it("expires a cache entry once the TTL elapses", async () => {
		const clock = makeClock(0);
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => validResult(),
			now: clock.now,
			ttlMs: 30_000,
			minIntervalMs: 0,
		});
		await bridge.consult(validPayload());
		expect(bridge.getFreshHint(validPayload())).toEqual(validResult());
		clock.advance(30_001);
		expect(bridge.getFreshHint(validPayload())).toBeNull();
	});

	it("expires a cache entry once the turn cap elapses even if the TTL has not", async () => {
		const clock = makeClock(0);
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => validResult(),
			now: clock.now,
			maxTurnsPerEntry: 2,
			minIntervalMs: 0,
		});
		await bridge.consult(validPayload());
		expect(bridge.getFreshHint(validPayload())).toEqual(validResult()); // turn 1: still fresh
		expect(bridge.getFreshHint(validPayload())).toBeNull(); // turn 2: expired by the turn cap
	});

	it("evicts the oldest entry once the LRU cache size is exceeded", async () => {
		const bridge = createAdaptorchBridge({
			advisoryFn: async (payload) => validResult({ taskClass: payload.taskClass }),
			cacheSize: 1,
			minIntervalMs: 0,
		});
		await bridge.consult(validPayload({ taskClass: "debug", runnerUp: "review" }));
		await bridge.consult(validPayload({ taskClass: "plan", runnerUp: "review" }));
		expect(bridge.getFreshHint(validPayload({ taskClass: "debug", runnerUp: "review" }))).toBeNull();
		expect(bridge.getFreshHint(validPayload({ taskClass: "plan", runnerUp: "review" }))?.taskClass).toBe("plan");
	});

	it("stops consulting once the per-session budget is exhausted, falling back silently", async () => {
		let calls = 0;
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => {
				calls += 1;
				return validResult();
			},
			maxConsultsPerSession: 2,
			minIntervalMs: 0,
		});
		await bridge.consult(validPayload({ taskClass: "debug" }));
		await bridge.consult(validPayload({ taskClass: "plan" }));
		const third = await bridge.consult(validPayload({ taskClass: "review" }));
		expect(third).toBeNull();
		expect(calls).toBe(2);
	});

	it("skips a consult attempt before the minimum interval elapses, then allows one after", async () => {
		const clock = makeClock(0);
		let calls = 0;
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => {
				calls += 1;
				return validResult();
			},
			now: clock.now,
			minIntervalMs: 60_000,
		});
		await bridge.consult(validPayload({ taskClass: "debug" }));
		clock.advance(1_000);
		const second = await bridge.consult(validPayload({ taskClass: "plan" }));
		expect(second).toBeNull();
		expect(calls).toBe(1);

		clock.advance(60_000);
		const third = await bridge.consult(validPayload({ taskClass: "review" }));
		expect(third).toEqual(validResult());
		expect(calls).toBe(2);
	});

	it("opens the circuit after consecutive failures and silently falls back while open", async () => {
		const clock = makeClock(0);
		let calls = 0;
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => {
				calls += 1;
				throw new Error("transport down");
			},
			now: clock.now,
			minIntervalMs: 0,
			failureThreshold: 3,
			cooldownMs: 600_000,
			maxConsultsPerSession: 100,
		});
		await bridge.consult(validPayload({ taskClass: "debug" }));
		await bridge.consult(validPayload({ taskClass: "plan" }));
		await bridge.consult(validPayload({ taskClass: "review" }));
		expect(calls).toBe(3);
		expect(bridge.getStats().circuitOpen).toBe(true);

		const duringOpen = await bridge.consult(validPayload({ taskClass: "refactor" }));
		expect(duringOpen).toBeNull();
		expect(calls).toBe(3); // circuit open: the advisory function was never invoked again

		clock.advance(600_001);
		const afterCooldown = await bridge.consult(validPayload({ taskClass: "refactor" }));
		expect(afterCooldown).toBeNull(); // still fails, but this proves the circuit re-permitted an attempt
		expect(calls).toBe(4);
	});

	it("treats a hung advisory call as a timeout failure without hanging the caller", async () => {
		const bridge = createAdaptorchBridge({
			advisoryFn: () => new Promise(() => {}),
			timeoutMs: 10,
			minIntervalMs: 0,
		});
		const result = await bridge.consult(validPayload());
		expect(result).toBeNull();
	});

	it("rejects a schema-invalid advisory response without throwing, and does not cache it", async () => {
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => ({ schemaVersion: 1, taskClass: "debug", toolName: "adaptorch_run" }),
			minIntervalMs: 0,
		});
		const result = await bridge.consult(validPayload());
		expect(result).toBeNull();
		expect(bridge.getFreshHint(validPayload())).toBeNull();
	});

	it("never forwards a payload with a forbidden field to the advisory function, even past the type system", async () => {
		let calls = 0;
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => {
				calls += 1;
				return validResult();
			},
			minIntervalMs: 0,
		});
		const forged = { ...validPayload(), sessionId: "abc" } as unknown as AdaptorchConsultPayload;
		const result = await bridge.consult(forged);
		expect(result).toBeNull();
		expect(calls).toBe(0);
	});

	it("requestRefresh is fire-and-forget and populates the cache for a later call", async () => {
		const bridge = createAdaptorchBridge({ advisoryFn: async () => validResult(), minIntervalMs: 0 });
		expect(() => bridge.requestRefresh(validPayload())).not.toThrow();
		await flushMicrotasks();
		expect(bridge.getFreshHint(validPayload())).toEqual(validResult());
	});

	it("requestRefresh swallows advisory failures without an unhandled rejection", async () => {
		const bridge = createAdaptorchBridge({
			advisoryFn: async () => {
				throw new Error("boom");
			},
			minIntervalMs: 0,
		});
		expect(() => bridge.requestRefresh(validPayload())).not.toThrow();
		await flushMicrotasks();
		expect(bridge.getFreshHint(validPayload())).toBeNull();
	});

	it("getStats reports consult/circuit/cache state without exposing payload or result content", async () => {
		const bridge = createAdaptorchBridge({ advisoryFn: async () => validResult(), minIntervalMs: 0 });
		await bridge.consult(validPayload());
		const stats = bridge.getStats();
		expect(stats.consultCount).toBe(1);
		expect(stats.failureStreak).toBe(0);
		expect(stats.circuitOpen).toBe(false);
		expect(stats.cacheEntryCount).toBe(1);
		expect(Object.keys(stats).sort()).toEqual(
			["cacheEntryCount", "circuitOpen", "circuitOpenUntilMs", "consultCount", "failureStreak"].sort(),
		);
	});
});
