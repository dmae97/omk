import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { ResourceGovernorMode } from "../src/core/resource-admission-config.ts";
import { DEFAULT_RESOURCE_ADMISSION_THRESHOLDS } from "../src/core/resource-admission-config.ts";
import {
	SESSION_TERMINATION_KIND_VALUES,
	type SessionTerminationCauseCode,
	type SessionTerminationPhase,
} from "../src/core/session-termination-types.ts";
import {
	type AuthorityStyle,
	authorityStyle,
	authorityText,
	buildControlPlaneViewModel,
	CONTEXT_CRITICAL_PERCENT,
	CONTEXT_ELEVATED_PERCENT,
	type ContextPressure,
	type ContextView,
	type ControlPlaneSignals,
	contextPressure,
	DEFAULT_BUSY_CPU_PERCENT,
	type EvidenceSignal,
	type EvidenceUiVerdict,
	evidenceVerdict,
	type FailureCard,
	type ResourceView,
	type TerminationSignal,
	UI_AUTHORITY_STATES,
	type UiAuthorityState,
	type VerifyView,
} from "../src/modes/interactive/control-plane-view-model.ts";

const NUM_RUNS = 300;

function termination(overrides: Partial<TerminationSignal> = {}): TerminationSignal {
	return {
		kind: "provider_network",
		phase: "provider",
		causeCode: "provider.network",
		sideEffects: "none",
		retryable: true,
		safeToAutoRetry: false,
		nextAction: "Check connectivity, then resend the prompt.",
		...overrides,
	};
}

function evidenceOf(
	verification: EvidenceSignal["verification"],
	overrides: Partial<EvidenceSignal> = {},
): EvidenceSignal {
	return { verification, receiptPresent: true, receiptFresh: true, ...overrides };
}

const COMPLETED = termination({
	kind: "completed",
	phase: "completed",
	causeCode: "session.completed",
	retryable: false,
	nextAction: "No action required.",
});
const USER_ABORT = termination({
	kind: "user_abort",
	phase: "control",
	causeCode: "session.user_abort",
	sideEffects: "possible",
	retryable: false,
	nextAction: "Resend the prompt when ready.",
});
const PROVIDER_AUTH = termination({
	kind: "provider_auth",
	causeCode: "provider.auth",
	retryable: false,
	nextAction: "Run /login, then resend the prompt.",
});
const IDLE: ControlPlaneSignals = { isStreaming: false, isCompacting: false, isRetrying: false };

describe("constants", () => {
	test("thresholds and the authority vocabulary", () => {
		expect(CONTEXT_ELEVATED_PERCENT).toBe(70);
		expect(CONTEXT_CRITICAL_PERCENT).toBe(90);
		expect(DEFAULT_BUSY_CPU_PERCENT).toBe(DEFAULT_RESOURCE_ADMISSION_THRESHOLDS.busyCpuPercent);
		expect(UI_AUTHORITY_STATES).toEqual(["ok", "active", "blocked", "degraded", "unknown", "stale", "inconclusive"]);
	});
});

describe("evidenceVerdict", () => {
	const cases: readonly { name: string; signal: EvidenceSignal | undefined; expected: EvidenceUiVerdict }[] = [
		{ name: "no evidence workflow", signal: undefined, expected: "unverified" },
		{ name: "not requested with a fresh receipt", signal: evidenceOf("not_requested"), expected: "unverified" },
		{
			name: "verified without a receipt",
			signal: evidenceOf("verified", { receiptPresent: false }),
			expected: "unverified",
		},
		{
			name: "violated without a receipt",
			signal: evidenceOf("violated", { receiptPresent: false, receiptFresh: false }),
			expected: "unverified",
		},
		{
			name: "verified with a stale receipt",
			signal: evidenceOf("verified", { receiptFresh: false }),
			expected: "stale",
		},
		{
			name: "violated with a stale receipt",
			signal: evidenceOf("violated", { receiptFresh: false }),
			expected: "stale",
		},
		{
			name: "inconclusive with a stale receipt",
			signal: evidenceOf("inconclusive", { receiptFresh: false }),
			expected: "stale",
		},
		{ name: "violated with a fresh receipt", signal: evidenceOf("violated"), expected: "failed" },
		{ name: "inconclusive with a fresh receipt", signal: evidenceOf("inconclusive"), expected: "inconclusive" },
		{ name: "verified with a fresh receipt", signal: evidenceOf("verified"), expected: "verified" },
	];
	test.each(cases)("$name -> $expected", ({ signal, expected }) => {
		expect(evidenceVerdict(signal)).toBe(expected);
	});
});

describe("VERIFY cell", () => {
	const cases: readonly { name: string; evidence: EvidenceSignal | undefined; expected: VerifyView }[] = [
		{
			name: "verified",
			evidence: evidenceOf("verified"),
			expected: { state: "ok", label: "verified", verdict: "verified" },
		},
		{
			name: "failed",
			evidence: evidenceOf("violated"),
			expected: { state: "blocked", label: "failed", verdict: "failed" },
		},
		{
			name: "inconclusive",
			evidence: evidenceOf("inconclusive"),
			expected: { state: "inconclusive", label: "inconclusive", verdict: "inconclusive" },
		},
		{
			name: "stale",
			evidence: evidenceOf("verified", { receiptFresh: false }),
			expected: { state: "stale", label: "stale", verdict: "stale" },
		},
		{
			name: "unverified",
			evidence: undefined,
			expected: { state: "unknown", label: "unverified", verdict: "unverified" },
		},
	];
	test.each(cases)("$name", ({ evidence, expected }) => {
		expect(buildControlPlaneViewModel({ ...IDLE, evidence }).verify).toEqual(expected);
	});

	test("a completed turn without an evidence source stays unverified", () => {
		const vm = buildControlPlaneViewModel({ ...IDLE, lastTermination: COMPLETED });
		expect(vm.run).toMatchObject({ state: "ok", label: "idle" });
		expect(vm.verify).toEqual({ state: "unknown", label: "unverified", verdict: "unverified" });
	});
});

describe("contextPressure", () => {
	const cases: readonly { input: number | null | undefined; expected: ContextPressure }[] = [
		{ input: undefined, expected: "unknown" },
		{ input: null, expected: "unknown" },
		{ input: Number.NaN, expected: "unknown" },
		{ input: Number.POSITIVE_INFINITY, expected: "unknown" },
		{ input: Number.NEGATIVE_INFINITY, expected: "unknown" },
		{ input: -5, expected: "normal" },
		{ input: 0, expected: "normal" },
		{ input: 69.999, expected: "normal" },
		{ input: 70, expected: "elevated" },
		{ input: 89.999, expected: "elevated" },
		{ input: 90, expected: "critical" },
		{ input: 100, expected: "critical" },
		{ input: 150, expected: "critical" },
	];
	test.each(cases)("$input -> $expected", ({ input, expected }) => {
		expect(contextPressure(input)).toBe(expected);
	});
});

describe("CONTEXT cell", () => {
	const noSource: ContextView = {
		state: "unknown",
		label: "unknown",
		percent: null,
		windowTokens: 0,
		pressure: "unknown",
		compacting: false,
		autoCompact: null,
	};
	const cases: readonly { name: string; signals: ControlPlaneSignals; expected: ContextView }[] = [
		{ name: "no source", signals: {}, expected: noSource },
		{
			name: "normal",
			signals: { contextPercent: 42.5, contextWindowTokens: 200_000, autoCompactEnabled: true },
			expected: {
				...noSource,
				state: "ok",
				label: "normal",
				percent: 42.5,
				windowTokens: 200_000,
				pressure: "normal",
				autoCompact: true,
			},
		},
		{
			name: "elevated",
			signals: { contextPercent: 70, contextWindowTokens: 128_000, autoCompactEnabled: false },
			expected: {
				...noSource,
				state: "degraded",
				label: "elevated",
				percent: 70,
				windowTokens: 128_000,
				pressure: "elevated",
				autoCompact: false,
			},
		},
		{
			name: "critical while compacting",
			signals: { contextPercent: 95, isCompacting: true },
			expected: {
				...noSource,
				state: "blocked",
				label: "critical",
				percent: 95,
				pressure: "critical",
				compacting: true,
			},
		},
		{
			name: "above 100 clamps to 100",
			signals: { contextPercent: 150 },
			expected: { ...noSource, state: "blocked", label: "critical", percent: 100, pressure: "critical" },
		},
		{
			name: "below 0 clamps to 0",
			signals: { contextPercent: -5 },
			expected: { ...noSource, state: "ok", label: "normal", percent: 0, pressure: "normal" },
		},
		{ name: "NaN has no source", signals: { contextPercent: Number.NaN }, expected: noSource },
		{ name: "Infinity has no source", signals: { contextPercent: Number.POSITIVE_INFINITY }, expected: noSource },
		{
			name: "unknown tokens keep the window",
			signals: { contextPercent: null, contextWindowTokens: 200_000 },
			expected: { ...noSource, windowTokens: 200_000 },
		},
	];
	test.each(cases)("$name", ({ signals, expected }) => {
		expect(buildControlPlaneViewModel(signals).context).toEqual(expected);
	});
});

describe("RUN cell (first match wins)", () => {
	const cases: readonly { name: string; signals: ControlPlaneSignals; state: UiAuthorityState; label: string }[] = [
		{ name: "no streaming source", signals: {}, state: "unknown", label: "unknown" },
		{
			name: "no streaming source ignores every other flag",
			signals: { isCompacting: true, isRetrying: true, lastTermination: PROVIDER_AUTH },
			state: "unknown",
			label: "unknown",
		},
		{
			name: "compacting wins over retrying and streaming",
			signals: { isStreaming: true, isCompacting: true, isRetrying: true },
			state: "active",
			label: "compacting",
		},
		{
			name: "compacting while idle hides the last failure",
			signals: { ...IDLE, isCompacting: true, lastTermination: PROVIDER_AUTH },
			state: "active",
			label: "compacting",
		},
		{
			name: "retrying wins over streaming",
			signals: { isStreaming: true, isRetrying: true },
			state: "degraded",
			label: "retrying",
		},
		{
			name: "streaming hides the last failure",
			signals: { isStreaming: true, lastTermination: PROVIDER_AUTH },
			state: "active",
			label: "running",
		},
		{ name: "idle without a termination", signals: IDLE, state: "ok", label: "idle" },
		{
			name: "idle after a completed turn",
			signals: { ...IDLE, lastTermination: COMPLETED },
			state: "ok",
			label: "idle",
		},
	];
	test.each(cases)("$name", ({ signals, state, label }) => {
		expect(buildControlPlaneViewModel(signals).run).toMatchObject({ state, label, failure: null });
	});

	test("user abort is degraded 'aborted' with a failure card", () => {
		expect(buildControlPlaneViewModel({ ...IDLE, lastTermination: USER_ABORT }).run).toEqual({
			state: "degraded",
			label: "aborted",
			queued: null,
			failure: {
				causeCode: "session.user_abort",
				phase: "control",
				sideEffects: "possible",
				retry: "none",
				nextAction: "Resend the prompt when ready.",
			},
		});
	});

	test("non-retryable failure is blocked and labelled with its kind", () => {
		expect(buildControlPlaneViewModel({ ...IDLE, lastTermination: PROVIDER_AUTH }).run).toMatchObject({
			state: "blocked",
			label: "provider_auth",
			failure: { causeCode: "provider.auth", phase: "provider", retry: "none" },
		});
	});

	const retryCases: readonly {
		safeToAutoRetry: boolean;
		retryable: boolean;
		retry: FailureCard["retry"];
		state: UiAuthorityState;
	}[] = [
		{ safeToAutoRetry: true, retryable: true, retry: "auto", state: "degraded" },
		{ safeToAutoRetry: true, retryable: false, retry: "auto", state: "blocked" },
		{ safeToAutoRetry: false, retryable: true, retry: "manual", state: "degraded" },
		{ safeToAutoRetry: false, retryable: false, retry: "none", state: "blocked" },
	];
	test.each(retryCases)(
		"safeToAutoRetry=$safeToAutoRetry retryable=$retryable -> $state, retry $retry",
		({ safeToAutoRetry, retryable, retry, state }) => {
			const lastTermination = termination({
				kind: "tool_timeout",
				causeCode: "tool.timeout",
				safeToAutoRetry,
				retryable,
			});
			const { run } = buildControlPlaneViewModel({ ...IDLE, lastTermination });
			expect(run.state).toBe(state);
			expect(run.label).toBe("tool_timeout");
			expect(run.failure?.retry).toBe(retry);
		},
	);

	const queuedCases: readonly { input: number | undefined; expected: number | null }[] = [
		{ input: undefined, expected: null },
		{ input: 0, expected: 0 },
		{ input: 3, expected: 3 },
		{ input: 2.9, expected: 2 },
		{ input: -1, expected: null },
		{ input: Number.NaN, expected: null },
		{ input: Number.POSITIVE_INFINITY, expected: null },
	];
	test.each(queuedCases)("pendingMessageCount $input -> queued $expected", ({ input, expected }) => {
		expect(buildControlPlaneViewModel({ ...IDLE, pendingMessageCount: input }).run.queued).toBe(expected);
	});
});

describe("RESOURCES cell", () => {
	const noSource: ResourceView = {
		state: "unknown",
		label: "unknown",
		governorMode: null,
		systemCpuPercent: null,
		memoryRssBytes: null,
	};
	const normal = (systemCpuPercent: number): ResourceView => ({
		...noSource,
		state: "ok",
		label: "normal",
		systemCpuPercent,
	});
	const busy = (systemCpuPercent: number): ResourceView => ({
		...noSource,
		state: "degraded",
		label: "busy",
		systemCpuPercent,
	});
	const cases: readonly { name: string; signals: ControlPlaneSignals; expected: ResourceView }[] = [
		{ name: "no source", signals: {}, expected: noSource },
		{
			name: "null cpu keeps the governor mode",
			signals: { systemCpuPercent: null, governorMode: "observe" },
			expected: { ...noSource, governorMode: "observe" },
		},
		{ name: "NaN cpu has no source", signals: { systemCpuPercent: Number.NaN }, expected: noSource },
		{ name: "below the default threshold", signals: { systemCpuPercent: 84.9 }, expected: normal(84.9) },
		{ name: "at the default threshold", signals: { systemCpuPercent: 85 }, expected: busy(85) },
		{ name: "above 100 clamps to 100", signals: { systemCpuPercent: 150 }, expected: busy(100) },
		{ name: "below 0 clamps to 0", signals: { systemCpuPercent: -3 }, expected: normal(0) },
		{ name: "custom threshold", signals: { systemCpuPercent: 60, busyCpuPercent: 50 }, expected: busy(60) },
		{ name: "threshold 1 is valid", signals: { systemCpuPercent: 1, busyCpuPercent: 1 }, expected: busy(1) },
		{
			name: "threshold 100 is valid",
			signals: { systemCpuPercent: 99.9, busyCpuPercent: 100 },
			expected: normal(99.9),
		},
		{
			name: "threshold 0 falls back to 85",
			signals: { systemCpuPercent: 60, busyCpuPercent: 0 },
			expected: normal(60),
		},
		{
			name: "threshold 101 falls back to 85",
			signals: { systemCpuPercent: 90, busyCpuPercent: 101 },
			expected: busy(90),
		},
		{
			name: "NaN threshold falls back to 85",
			signals: { systemCpuPercent: 86, busyCpuPercent: Number.NaN },
			expected: busy(86),
		},
		{
			name: "Infinity threshold falls back to 85",
			signals: { systemCpuPercent: 86, busyCpuPercent: Number.POSITIVE_INFINITY },
			expected: busy(86),
		},
		{
			name: "governor mode and memory pass through",
			signals: { systemCpuPercent: 10, governorMode: "adaptive", memoryRssBytes: 123_456_789 },
			expected: { ...normal(10), governorMode: "adaptive", memoryRssBytes: 123_456_789 },
		},
		{
			name: "zero memory is a reading",
			signals: { memoryRssBytes: 0 },
			expected: { ...noSource, memoryRssBytes: 0 },
		},
		{ name: "negative memory has no source", signals: { memoryRssBytes: -1 }, expected: noSource },
		{ name: "NaN memory has no source", signals: { memoryRssBytes: Number.NaN }, expected: noSource },
		{
			name: "Infinity memory has no source",
			signals: { memoryRssBytes: Number.POSITIVE_INFINITY },
			expected: noSource,
		},
	];
	test.each(cases)("$name", ({ signals, expected }) => {
		expect(buildControlPlaneViewModel(signals).resources).toEqual(expected);
	});
});

describe("authority presentation", () => {
	const expectedStyles: Readonly<Record<UiAuthorityState, AuthorityStyle>> = {
		ok: { color: "success", glyph: "✓" },
		active: { color: "accent", glyph: "●" },
		blocked: { color: "error", glyph: "!" },
		degraded: { color: "warning", glyph: "▲" },
		unknown: { color: "muted", glyph: "?" },
		stale: { color: "warning", glyph: "~" },
		inconclusive: { color: "warning", glyph: "◐" },
	};
	test.each(UI_AUTHORITY_STATES)("authorityStyle(%s)", (state) => {
		expect(authorityStyle(state)).toEqual(expectedStyles[state]);
	});

	test("authorityText prefixes the glyph so status never depends on colour alone", () => {
		expect(authorityText({ state: "ok", label: "idle" })).toBe("✓ idle");
		expect(authorityText({ state: "blocked", label: "provider_auth" })).toBe("! provider_auth");
		expect(authorityText({ state: "unknown", label: "unverified" })).toBe("? unverified");
	});
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const optional = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(arb, { nil: undefined });

const PHASES: readonly SessionTerminationPhase[] = [
	"completed",
	"control",
	"preflight",
	"provider",
	"tool",
	"compaction",
	"persistence",
	"process",
	"resume",
];
const CAUSE_CODES: readonly SessionTerminationCauseCode[] = [
	"session.completed",
	"session.user_abort",
	"provider.network",
	"provider.auth",
	"tool.timeout",
	"compaction.failed",
	"resource.memory",
	"internal.unclassified",
];
const GOVERNOR_MODES: readonly ResourceGovernorMode[] = ["off", "observe", "adaptive", "strict"];

const terminationArb: fc.Arbitrary<TerminationSignal> = fc.record({
	kind: fc.constantFrom(...SESSION_TERMINATION_KIND_VALUES),
	phase: fc.constantFrom(...PHASES),
	causeCode: fc.constantFrom(...CAUSE_CODES),
	sideEffects: fc.constantFrom("none", "possible", "confirmed"),
	retryable: fc.boolean(),
	safeToAutoRetry: fc.boolean(),
	nextAction: fc.string({ maxLength: 40 }),
});

const evidenceArb: fc.Arbitrary<EvidenceSignal> = fc.record({
	verification: fc.constantFrom("not_requested", "verified", "violated", "inconclusive"),
	receiptPresent: fc.boolean(),
	receiptFresh: fc.boolean(),
});

/** Realistic percentages, the exact thresholds, and every junk double (NaN, ±Infinity, -0, huge). */
const percentArb = fc.oneof(
	fc.double({ min: -20, max: 160, noNaN: true }),
	fc.constantFrom(0, 69.999, 70, 85, 89.999, 90, 100),
	fc.double(),
);

/** Every signal except `isStreaming` and `evidence`; any key may be absent. */
const baseSignalsArb = fc.record(
	{
		isCompacting: fc.boolean(),
		isRetrying: fc.boolean(),
		pendingMessageCount: fc.oneof(fc.integer({ min: -3, max: 50 }), fc.double()),
		lastTermination: terminationArb,
		contextPercent: fc.option(percentArb, { nil: null }),
		contextWindowTokens: fc.nat({ max: 2_000_000 }),
		autoCompactEnabled: fc.boolean(),
		governorMode: fc.constantFrom(...GOVERNOR_MODES),
		busyCpuPercent: fc.oneof(fc.integer({ min: 0, max: 101 }), fc.double()),
		systemCpuPercent: fc.option(percentArb, { nil: null }),
		memoryRssBytes: fc.option(fc.oneof(fc.nat(), fc.double()), { nil: null }),
	},
	{ requiredKeys: [] },
);

function signalsArb(
	streaming: fc.Arbitrary<boolean | undefined>,
	evidence: fc.Arbitrary<EvidenceSignal | undefined>,
): fc.Arbitrary<ControlPlaneSignals> {
	return fc
		.tuple(streaming, evidence, baseSignalsArb)
		.map(([isStreaming, signalEvidence, base]) => ({ ...base, isStreaming, evidence: signalEvidence }));
}

const anySignalsArb = signalsArb(optional(fc.boolean()), optional(evidenceArb));

const PRESSURE_RANK: Readonly<Record<ContextPressure, number>> = { unknown: -1, normal: 0, elevated: 1, critical: 2 };

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function expectPercentOrNull(value: number | null): void {
	if (value === null) return;
	expect(value).toBeGreaterThanOrEqual(0);
	expect(value).toBeLessThanOrEqual(100);
}

describe("control-plane view-model properties", () => {
	test("P1: only verified evidence with a present, fresh receipt is 'verified'", () => {
		fc.assert(
			fc.property(evidenceArb, (signal) => {
				const expected = signal.verification === "verified" && signal.receiptPresent && signal.receiptFresh;
				expect(evidenceVerdict(signal) === "verified").toBe(expected);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P2: prompt settlement never upgrades evidence (no evidence source => unverified)", () => {
		const settledArb = fc
			.tuple(signalsArb(optional(fc.boolean()), fc.constant(undefined)), terminationArb)
			.map(([signals, lastTermination]) => ({ ...signals, lastTermination }));
		fc.assert(
			fc.property(settledArb, (signals) => {
				const { verify } = buildControlPlaneViewModel(signals);
				expect(verify.verdict).toBe("unverified");
				expect(verify.state).toBe("unknown");
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P3: authorityStyle is total with non-empty, pairwise-distinct glyphs", () => {
		const glyphs = UI_AUTHORITY_STATES.map((state) => authorityStyle(state).glyph);
		for (const glyph of glyphs) expect(glyph.trim()).not.toBe("");
		expect(new Set(glyphs).size).toBe(UI_AUTHORITY_STATES.length);
		expect(new Set(UI_AUTHORITY_STATES).size).toBe(UI_AUTHORITY_STATES.length);
	});

	test("P3: every produced cell uses the typed vocabulary and renders glyph + label", () => {
		fc.assert(
			fc.property(anySignalsArb, (signals) => {
				const vm = buildControlPlaneViewModel(signals);
				for (const cell of [vm.run, vm.verify, vm.context, vm.resources]) {
					expect(UI_AUTHORITY_STATES).toContain(cell.state);
					expect(cell.label).not.toBe("");
					expect(authorityText(cell)).toBe(`${authorityStyle(cell.state).glyph} ${cell.label}`);
				}
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P3: authorityText is glyph, one space, then the label for any cell", () => {
		const cellArb = fc.record({
			state: fc.constantFrom(...UI_AUTHORITY_STATES),
			label: fc.string({ maxLength: 30 }),
		});
		fc.assert(
			fc.property(cellArb, (cell) => {
				expect(authorityText(cell)).toBe(`${authorityStyle(cell.state).glyph} ${cell.label}`);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P4: context pressure is monotone non-decreasing over finite percentages", () => {
		const finiteArb = fc.oneof(
			fc.double({ noNaN: true, noDefaultInfinity: true }),
			fc.double({ min: 60, max: 100, noNaN: true }),
		);
		fc.assert(
			fc.property(finiteArb, finiteArb, (a, b) => {
				const low = PRESSURE_RANK[contextPressure(Math.min(a, b))];
				const high = PRESSURE_RANK[contextPressure(Math.max(a, b))];
				expect(low).toBeGreaterThanOrEqual(0);
				expect(high).toBeGreaterThanOrEqual(low);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P5: without a streaming source RUN is unknown and carries no failure", () => {
		fc.assert(
			fc.property(signalsArb(fc.constant(undefined), optional(evidenceArb)), (signals) => {
				const { run } = buildControlPlaneViewModel(signals);
				expect(run.state).toBe("unknown");
				expect(run.label).toBe("unknown");
				expect(run.failure).toBeNull();
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P6: a failure card appears only for a settled, non-completed turn", () => {
		fc.assert(
			fc.property(anySignalsArb, (signals) => {
				const { run } = buildControlPlaneViewModel(signals);
				const last = signals.lastTermination;
				const settledFailure =
					signals.isStreaming === false &&
					!signals.isCompacting &&
					!signals.isRetrying &&
					last !== undefined &&
					last.kind !== "completed";
				expect(run.failure !== null).toBe(settledFailure);
				if (run.failure !== null && last !== undefined) {
					expect(run.failure).toMatchObject({
						causeCode: last.causeCode,
						phase: last.phase,
						sideEffects: last.sideEffects,
						nextAction: last.nextAction,
					});
					expect(["degraded", "blocked"]).toContain(run.state);
				}
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P7: the builder never mutates a deeply frozen input and is deterministic", () => {
		fc.assert(
			fc.property(anySignalsArb, (signals) => {
				const snapshot = structuredClone(signals);
				const frozen = deepFreeze(structuredClone(signals));
				const first = buildControlPlaneViewModel(frozen);
				const second = buildControlPlaneViewModel(frozen);
				expect(frozen).toEqual(snapshot);
				expect(second).toEqual(first);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("numeric outputs are normalized for rendering", () => {
		fc.assert(
			fc.property(anySignalsArb, (signals) => {
				const { run, context, resources } = buildControlPlaneViewModel(signals);
				expectPercentOrNull(context.percent);
				expectPercentOrNull(resources.systemCpuPercent);
				if (run.queued !== null) {
					expect(Number.isInteger(run.queued)).toBe(true);
					expect(run.queued).toBeGreaterThanOrEqual(0);
				}
				if (resources.memoryRssBytes !== null) {
					expect(Number.isFinite(resources.memoryRssBytes)).toBe(true);
					expect(resources.memoryRssBytes).toBeGreaterThanOrEqual(0);
				}
			}),
			{ numRuns: NUM_RUNS },
		);
	});
});
