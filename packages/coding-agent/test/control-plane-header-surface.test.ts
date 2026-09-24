import fc from "fast-check";
import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ResourceGovernorMode } from "../src/core/resource-admission-config.ts";
import {
	type ControlPanelContent,
	type ControlPanelStatusSnapshot,
	renderControlPanelLayout,
	renderControlPanelRightPane,
} from "../src/modes/interactive/components/control-panel-layout.ts";
import {
	buildControlPlaneViewModel,
	type ControlPlaneViewModel,
	type FailureCard,
	type TerminationSignal,
	UI_AUTHORITY_STATES,
	type UiAuthorityState,
} from "../src/modes/interactive/control-plane-view-model.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const HEADER_WIDTHS = [90, 119, 120, 160] as const;
const HEADER_CASES = [false, true].flatMap((expanded) => HEADER_WIDTHS.map((width) => [expanded, width] as const));
const OVERLAY_WIDTH = 38;
const NUM_RUNS = 50;
const GOVERNOR_MODES: readonly ResourceGovernorMode[] = ["off", "observe", "adaptive", "strict"];

const TOOL_FATAL: TerminationSignal = {
	kind: "tool_fatal",
	phase: "tool",
	causeCode: "tool.fatal",
	sideEffects: "confirmed",
	retryable: false,
	safeToAutoRetry: false,
	nextAction: "Inspect the failed tool result before retrying.",
};

/** Turn-stable descriptors shared by every variant; only the live fields change between renders. */
const DESCRIPTORS: ControlPanelStatusSnapshot = {
	modelProvider: "openrouter",
	modelId: "omk-test-model",
	thinkingLevel: "high",
	headroomStatus: "headroom:0.29.0",
	mcpCount: 12,
	skillCount: 96,
	cwdLabel: "~/omk",
	gitBranch: "main",
	ansiColorState: "on",
};

function panelContent(statusSnapshot: () => ControlPanelStatusSnapshot): ControlPanelContent {
	return {
		appName: "omk",
		version: "0.0.0-test",
		compactInstructions: () => "Ctrl+C interrupt · / commands",
		expandedInstructions: () => "Ctrl+C to interrupt\n/ for commands",
		compactOnboarding: () => "Press Ctrl+O to show full startup help.",
		onboarding: () => "[Context]\n 1 loaded · AGENTS.md",
		statusSnapshot,
	};
}

/** Values that change without a turn boundary (queue, failure card, host CPU, RSS, busy state). */
interface LiveFields {
	readonly queued: number | null;
	readonly failure: FailureCard | null;
	readonly systemCpuPercent: number | null;
	readonly memoryRssBytes: number | null;
	readonly resourceState: UiAuthorityState;
	readonly resourceLabel: string;
}

const failureArb: fc.Arbitrary<FailureCard | null> = fc.option(
	fc.record({
		causeCode: fc.string({ maxLength: 40 }),
		phase: fc.string({ maxLength: 16 }),
		sideEffects: fc.constantFrom("none", "possible", "confirmed"),
		retry: fc.constantFrom("auto", "manual", "none"),
		nextAction: fc.string({ maxLength: 160 }),
	}),
	{ nil: null },
);

const liveFieldsArb: fc.Arbitrary<LiveFields> = fc.record({
	queued: fc.option(fc.nat({ max: 10_000 }), { nil: null }),
	failure: failureArb,
	systemCpuPercent: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
	memoryRssBytes: fc.option(fc.maxSafeNat(), { nil: null }),
	resourceState: fc.constantFrom(...UI_AUTHORITY_STATES),
	resourceLabel: fc.string({ maxLength: 24 }),
});

/** A sourced base view model whose run cell is fixed, so variants differ only in the live fields. */
const baseArb: fc.Arbitrary<ControlPlaneViewModel> = fc
	.record({
		runState: fc.constantFrom(...UI_AUTHORITY_STATES),
		runLabel: fc.constantFrom("idle", "running", "tool_fatal", "aborted"),
		contextPercent: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
		governorMode: fc.constantFrom(...GOVERNOR_MODES),
	})
	.map(({ runState, runLabel, contextPercent, governorMode }) => {
		const vm = buildControlPlaneViewModel({
			isStreaming: false,
			contextPercent,
			contextWindowTokens: 128_000,
			governorMode,
		});
		return { ...vm, run: { ...vm.run, state: runState, label: runLabel } };
	});

/** Spread, not the builder: the builder would re-derive run/resource state from the live fields. */
function withLiveFields(base: ControlPlaneViewModel, live: LiveFields): ControlPlaneViewModel {
	return {
		...base,
		run: { ...base.run, queued: live.queued, failure: live.failure },
		resources: {
			...base.resources,
			state: live.resourceState,
			label: live.resourceLabel,
			systemCpuPercent: live.systemCpuPercent,
			memoryRssBytes: live.memoryRssBytes,
		},
	};
}

function renderHeader(controlPlane: ControlPlaneViewModel, expanded: boolean, width: number): string[] {
	return renderControlPanelLayout(
		panelContent(() => ({ ...DESCRIPTORS, controlPlane })),
		expanded,
		width,
	);
}

beforeAll(() => {
	initTheme("omk-control-grid-dark");
});

describe("header surfaces carry only turn-stable values", () => {
	test.each(HEADER_CASES)("expanded=%s width=%i renders identically across live-field changes", (expanded, width) => {
		fc.assert(
			fc.property(baseArb, liveFieldsArb, liveFieldsArb, (base, first, second) => {
				expect(renderHeader(withLiveFields(base, second), expanded, width)).toEqual(
					renderHeader(withLiveFields(base, first), expanded, width),
				);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("the viewport-anchored overlay still renders the live fields", () => {
		const base = buildControlPlaneViewModel({ isStreaming: false, governorMode: "observe" });
		const idle: LiveFields = {
			queued: 0,
			failure: null,
			systemCpuPercent: 12,
			memoryRssBytes: 64 * 1024 * 1024,
			resourceState: "ok",
			resourceLabel: "normal",
		};
		const overlay = (live: LiveFields) =>
			renderControlPanelRightPane(
				panelContent(() => ({ ...DESCRIPTORS, controlPlane: withLiveFields(base, live) })),
				OVERLAY_WIDTH,
			);

		expect(overlay({ ...idle, queued: 3 })).not.toEqual(overlay(idle));
		expect(overlay({ ...idle, systemCpuPercent: 13 })).not.toEqual(overlay(idle));
		expect(overlay({ ...idle, memoryRssBytes: 65 * 1024 * 1024 })).not.toEqual(overlay(idle));
	});
});

describe("one status snapshot per render call", () => {
	test.each([
		[false, 90],
		[false, 160],
		[true, 60],
		[true, 96],
		[true, 120],
		[true, 172],
	])("renderControlPanelLayout(expanded=%s, width=%i) reads the snapshot provider once", (expanded, width) => {
		const statusSnapshot = vi.fn(() => DESCRIPTORS);
		renderControlPanelLayout(panelContent(statusSnapshot), expanded, width);
		expect(statusSnapshot).toHaveBeenCalledTimes(1);
	});

	test("renderControlPanelRightPane reads the snapshot provider once", () => {
		const statusSnapshot = vi.fn(() => DESCRIPTORS);
		renderControlPanelRightPane(panelContent(statusSnapshot), OVERLAY_WIDTH);
		expect(statusSnapshot).toHaveBeenCalledTimes(1);
	});
});

/** Any ESC that does not start an SGR colour sequence can drive the terminal (clipboard, clear, cursor). */
const NON_SGR_ESCAPE = /\x1b(?!\[[0-9;]*m)/;
const C1_OR_BIDI = /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/;
const PAYLOADS = {
	osc52: "\x1b]52;c;ZXZpbA==\x07",
	clear: "\x1b[2J",
	rlo: "\u202e",
	c1csi: "\u009b",
	combined: "\x1b]52;c;ZXZpbA==\x07\x1b[2J\u202e\u009b",
} as const;

function injectedSnapshot(payload: string): ControlPanelStatusSnapshot {
	return {
		...DESCRIPTORS,
		modelId: `model-${payload}-id`,
		cwdLabel: `~/work/${payload}/repo`,
		gitBranch: `feature/${payload}`,
		todoState: {
			items: [{ id: "active", label: `todo ${payload} label`, status: "active" }],
			updatedAt: 1,
		},
		controlPlane: buildControlPlaneViewModel({
			isStreaming: false,
			lastTermination: { ...TOOL_FATAL, nextAction: `next ${payload} step` },
		}),
	};
}

function unsafeLines(lines: readonly string[]): string[] {
	return lines.filter((line) => NON_SGR_ESCAPE.test(line) || C1_OR_BIDI.test(line));
}

describe("session, model and file-system text cannot drive the terminal", () => {
	test.each(Object.entries(PAYLOADS))("%s payload stays inert in every header layout", (_name, payload) => {
		for (const [expanded, width] of HEADER_CASES) {
			const lines = renderControlPanelLayout(
				panelContent(() => injectedSnapshot(payload)),
				expanded,
				width,
			);
			expect(unsafeLines(lines), `expanded=${expanded} width=${width}`).toEqual([]);
			expect(lines.map((line) => visibleWidth(line))).toEqual(lines.map(() => width));
		}
	});

	test.each(Object.entries(PAYLOADS))("%s payload stays inert in the overlay rail", (_name, payload) => {
		const lines = renderControlPanelRightPane(
			panelContent(() => injectedSnapshot(payload)),
			OVERLAY_WIDTH,
		);
		expect(unsafeLines(lines)).toEqual([]);
		expect(lines.map((line) => visibleWidth(line))).toEqual(lines.map(() => OVERLAY_WIDTH));
		// The failure card is on the overlay, so the injected next action was actually rendered.
		expect(lines.some((line) => line.includes("next") && line.includes("step"))).toBe(true);
	});
});
