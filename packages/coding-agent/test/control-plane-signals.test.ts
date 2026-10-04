import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ContextUsage } from "../src/core/extensions/types.ts";
import {
	DEFAULT_RESOURCE_GOVERNOR_MODE,
	RESOURCE_GOVERNOR_MODE_ENV,
	type ResourceGovernorSettings,
} from "../src/core/resource-governor-settings.ts";
import {
	type ControlPlaneMetricsPort,
	type ControlPlaneSessionPort,
	readControlPlaneSignals,
} from "../src/modes/interactive/control-plane-signals.ts";
import {
	buildControlPlaneViewModel,
	type TerminationSignal,
} from "../src/modes/interactive/control-plane-view-model.ts";

// Compile-time check (tsgo): the live session satisfies the port without casts.
const _portCheck: (s: AgentSession) => ControlPlaneSessionPort = (s) => s;
void _portCheck;

interface FakeSessionState {
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly isRetrying: boolean;
	readonly pendingMessageCount: number;
	readonly lastTermination: TerminationSignal | undefined;
	readonly autoCompactionEnabled: boolean;
	readonly usage: ContextUsage | undefined;
	readonly governor: ResourceGovernorSettings;
}

const IDLE_STATE: FakeSessionState = {
	isStreaming: false,
	isCompacting: false,
	isRetrying: false,
	pendingMessageCount: 0,
	lastTermination: undefined,
	autoCompactionEnabled: true,
	usage: undefined,
	governor: {},
};

const PROVIDER_NETWORK: TerminationSignal = {
	kind: "provider_network",
	phase: "provider",
	causeCode: "provider.network",
	sideEffects: "none",
	retryable: true,
	safeToAutoRetry: true,
	nextAction: "Check connectivity, then resend the prompt.",
};

function readLog() {
	const reads = new Map<string, number>();
	function read<T>(key: string, value: T): T {
		reads.set(key, (reads.get(key) ?? 0) + 1);
		return value;
	}
	return { reads, read };
}

function fakeSession(overrides: Partial<FakeSessionState> = {}) {
	const state: FakeSessionState = { ...IDLE_STATE, ...overrides };
	const { reads, read } = readLog();
	const port: ControlPlaneSessionPort = {
		get isStreaming() {
			return read("isStreaming", state.isStreaming);
		},
		get isCompacting() {
			return read("isCompacting", state.isCompacting);
		},
		get isRetrying() {
			return read("isRetrying", state.isRetrying);
		},
		get pendingMessageCount() {
			return read("pendingMessageCount", state.pendingMessageCount);
		},
		get lastTermination() {
			return read("lastTermination", state.lastTermination);
		},
		get autoCompactionEnabled() {
			return read("autoCompactionEnabled", state.autoCompactionEnabled);
		},
		getContextUsage: () => read("getContextUsage", state.usage),
		settingsManager: { getResourceGovernorSettings: () => read("getResourceGovernorSettings", state.governor) },
	};
	return { port, reads };
}

function fakeMetrics(systemCpuPercent: number | null, memoryRssBytes: number | null) {
	const { reads, read } = readLog();
	const metrics: ControlPlaneMetricsPort = {
		getSystemCpuPercent: () => read("getSystemCpuPercent", systemCpuPercent),
		getMemoryRssBytes: () => read("getMemoryRssBytes", memoryRssBytes),
	};
	return { metrics, reads };
}

// The resolver honours the operator env override; pin it off so results depend on settings only.
beforeEach(() => {
	vi.stubEnv(RESOURCE_GOVERNOR_MODE_ENV, "");
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("readControlPlaneSignals", () => {
	test("maps every session field and metric, reading each source once", () => {
		const session = fakeSession({
			isStreaming: true,
			isRetrying: true,
			pendingMessageCount: 2,
			lastTermination: PROVIDER_NETWORK,
			autoCompactionEnabled: false,
			usage: { tokens: 1_000, contextWindow: 200_000, percent: 0.5 },
			governor: { mode: "adaptive", busyCpuPercent: 70 },
		});
		const { metrics, reads: metricReads } = fakeMetrics(12.5, 4_096);

		const signals = readControlPlaneSignals(session.port, metrics, 128_000);

		expect(signals).toEqual({
			isStreaming: true,
			isCompacting: false,
			isRetrying: true,
			pendingMessageCount: 2,
			lastTermination: PROVIDER_NETWORK,
			contextPercent: 0.5,
			contextWindowTokens: 200_000,
			autoCompactEnabled: false,
			governorMode: "adaptive",
			busyCpuPercent: 70,
			systemCpuPercent: 12.5,
			memoryRssBytes: 4_096,
		});
		expect(Object.fromEntries(session.reads)).toEqual({
			isStreaming: 1,
			isCompacting: 1,
			isRetrying: 1,
			pendingMessageCount: 1,
			lastTermination: 1,
			autoCompactionEnabled: 1,
			getContextUsage: 1,
			getResourceGovernorSettings: 1,
		});
		expect(Object.fromEntries(metricReads)).toEqual({ getSystemCpuPercent: 1, getMemoryRssBytes: 1 });
	});

	const windowCases: readonly {
		name: string;
		usage: ContextUsage | undefined;
		fallback: number | undefined;
		percent: number | null;
		window: number;
	}[] = [
		{ name: "no usage uses the fallback", usage: undefined, fallback: 128_000, percent: null, window: 128_000 },
		{ name: "no usage and no fallback is 0", usage: undefined, fallback: undefined, percent: null, window: 0 },
		{
			name: "usage wins over the fallback",
			usage: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
			fallback: 128_000,
			percent: 25,
			window: 200_000,
		},
		{
			name: "unknown tokens keep the usage window",
			usage: { tokens: null, contextWindow: 200_000, percent: null },
			fallback: 128_000,
			percent: null,
			window: 200_000,
		},
		{
			name: "a zero usage window is kept",
			usage: { tokens: null, contextWindow: 0, percent: null },
			fallback: 128_000,
			percent: null,
			window: 0,
		},
	];
	test.each(windowCases)("context: $name", ({ usage, fallback, percent, window }) => {
		const signals = readControlPlaneSignals(fakeSession({ usage }).port, undefined, fallback);
		expect(signals.contextPercent).toBe(percent);
		expect(signals.contextWindowTokens).toBe(window);
	});

	test("missing metrics yield null cpu and memory", () => {
		const signals = readControlPlaneSignals(fakeSession().port);
		expect(signals.systemCpuPercent).toBeNull();
		expect(signals.memoryRssBytes).toBeNull();
	});

	test("metrics without a reading stay null", () => {
		const signals = readControlPlaneSignals(fakeSession().port, fakeMetrics(null, null).metrics);
		expect(signals.systemCpuPercent).toBeNull();
		expect(signals.memoryRssBytes).toBeNull();
	});

	test("invalid governor settings do not throw and resolve to the fallbacks", () => {
		const session = fakeSession({ governor: { mode: "bogus" as never, busyCpuPercent: 999 } });
		let signals: ReturnType<typeof readControlPlaneSignals> | undefined;
		expect(() => {
			signals = readControlPlaneSignals(session.port);
		}).not.toThrow();
		expect(signals?.governorMode).toBe(DEFAULT_RESOURCE_GOVERNOR_MODE);
		expect(signals?.busyCpuPercent).toBe(85);
	});

	test("the operator env override decides the reported governor mode", () => {
		vi.stubEnv(RESOURCE_GOVERNOR_MODE_ENV, "strict");
		const signals = readControlPlaneSignals(fakeSession({ governor: { mode: "adaptive" } }).port);
		expect(signals.governorMode).toBe("strict");
	});

	test("evidence stays undefined, so a completed turn renders VERIFY as unverified", () => {
		const completed: TerminationSignal = {
			kind: "completed",
			phase: "completed",
			causeCode: "session.completed",
			sideEffects: "none",
			retryable: false,
			safeToAutoRetry: false,
			nextAction: "No action required.",
		};
		const signals = readControlPlaneSignals(
			fakeSession({ lastTermination: completed }).port,
			fakeMetrics(5, 1).metrics,
		);
		expect(signals.evidence).toBeUndefined();

		const vm = buildControlPlaneViewModel(signals);
		expect(vm.run).toMatchObject({ state: "ok", label: "idle" });
		expect(vm.verify).toEqual({ state: "unknown", label: "unverified", verdict: "unverified" });
	});
});
