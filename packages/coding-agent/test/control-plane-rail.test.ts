import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import type { SessionManager } from "../src/core/session-manager.ts";
import {
	ControlPanelComponent,
	type ControlPanelContent,
	ControlPanelRightPaneComponent,
	type ControlPanelStatusSnapshot,
} from "../src/modes/interactive/components/control-panel.ts";
import { createControlPanelStatusSnapshot } from "../src/modes/interactive/components/control-panel-runtime-status.ts";
import {
	authorityStyle,
	authorityText,
	buildControlPlaneViewModel,
	type ControlPlaneSignals,
	type TerminationSignal,
} from "../src/modes/interactive/control-plane-view-model.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// Hermetic snapshot construction: no headroom version probe, no MCP config reads.
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawnSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "" })),
}));
vi.mock("../src/core/mcp-inventory.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/core/mcp-inventory.ts")>()),
	loadMcpInventory: vi.fn(() => ({ entries: [], presets: [], sources: [], errors: [] })),
}));

const SETTLED: ControlPlaneSignals = {
	isStreaming: false,
	isCompacting: false,
	isRetrying: false,
	pendingMessageCount: 0,
};

const TOOL_FATAL: TerminationSignal = {
	kind: "tool_fatal",
	phase: "tool",
	causeCode: "tool.fatal",
	sideEffects: "confirmed",
	retryable: false,
	safeToAutoRetry: false,
	nextAction: "Inspect the failed tool result and repair its configuration before retrying.",
};

const USER_ABORT: TerminationSignal = {
	kind: "user_abort",
	phase: "control",
	causeCode: "session.user_abort",
	sideEffects: "possible",
	retryable: false,
	safeToAutoRetry: false,
	nextAction: "Review possible partial side effects, then retry only if intended.",
};

const LEGACY_SNAPSHOT_KEYS = [
	"runtimeState",
	"routeState",
	"evidenceState",
	"controlState",
	"dagOrchestrationState",
	"startupState",
	"linkState",
	"sidebarState",
	"packageIntake",
	"contextTokens",
] as const;

const FAILURE_CARD_ROW = /\b(cause|phase|effects|retry):/;

function railContent(snapshot: ControlPanelStatusSnapshot): ControlPanelContent {
	return {
		appName: "omk",
		version: "0.0.0-test",
		compactInstructions: () => "",
		expandedInstructions: () => "",
		compactOnboarding: () => "",
		onboarding: () => "",
		statusSnapshot: () => snapshot,
	};
}

/** Viewport-anchored control-pane overlay: may show live values. */
function renderRail(snapshot: ControlPanelStatusSnapshot, width: number): string[] {
	return new ControlPanelRightPaneComponent(railContent(snapshot)).render(width);
}

/** Startup deck (hero + header rail): scrolls into scrollback, so only turn-stable rows. */
function renderHeader(snapshot: ControlPanelStatusSnapshot, width: number): string[] {
	return new ControlPanelComponent(railContent(snapshot)).render(width);
}

beforeAll(() => {
	initTheme("omk-control-grid-dark");
});

describe("control-plane rail RUN section", () => {
	const cases = [
		{ name: "idle", signals: SETTLED, state: "✓ idle", failure: false },
		{ name: "running", signals: { ...SETTLED, isStreaming: true }, state: "● running", failure: false },
		{ name: "compacting", signals: { ...SETTLED, isCompacting: true }, state: "● compacting", failure: false },
		{ name: "blocked", signals: { ...SETTLED, lastTermination: TOOL_FATAL }, state: "! tool_fatal", failure: true },
		{ name: "aborted", signals: { ...SETTLED, lastTermination: USER_ABORT }, state: "▲ aborted", failure: true },
	];

	test.each(cases)("renders $name as glyph + label, failure card only when settled badly", (runCase) => {
		const vm = buildControlPlaneViewModel(runCase.signals);
		const lines = renderRail({ controlPlane: vm }, 38);
		const plain = lines.map(stripAnsi);

		const stateIndex = plain.findIndex((line) => line.includes(`state: ${runCase.state}`));
		expect(stateIndex, plain.join("\n")).toBeGreaterThan(-1);
		// Colour comes only from the typed authority mapping, never from string heuristics.
		expect(lines[stateIndex]).toContain(theme.fg(authorityStyle(vm.run.state).color, authorityText(vm.run)));
		expect(plain.filter((line) => FAILURE_CARD_ROW.test(line))).toHaveLength(runCase.failure ? 4 : 0);
		// TODO always owns one "next:" row; a failure card adds the RUN "next:" row.
		expect(plain.filter((line) => line.includes("next:"))).toHaveLength(runCase.failure ? 2 : 1);
	});

	test("failure card lists cause, phase, effects, retry and next action", () => {
		const plain = renderRail(
			{ controlPlane: buildControlPlaneViewModel({ ...SETTLED, lastTermination: TOOL_FATAL }) },
			38,
		)
			.map(stripAnsi)
			.join("\n");

		expect(plain).toContain("cause: tool.fatal");
		expect(plain).toContain("phase: tool");
		expect(plain).toContain("effects: confirmed");
		expect(plain).toContain("retry: none");
		expect(plain).toMatch(/next: Inspect the failed.*…/);
		expect(plain).toContain("queue: 0");
	});

	test("an empty snapshot renders RUN as unknown with an unknown queue", () => {
		const plain = renderRail({}, 38).map(stripAnsi).join("\n");

		expect(plain).toContain("state: ? unknown");
		expect(plain).toContain("queue: ?");
		expect(plain).not.toMatch(FAILURE_CARD_ROW);
	});
});

describe("control-plane rail width invariant", () => {
	test.each([34, 38, 48])("every right-pane row is exactly %i cells with a 200-char next action", (width) => {
		const nextAction = "Inspect ".repeat(25);
		expect(nextAction).toHaveLength(200);
		const vm = buildControlPlaneViewModel({
			...SETTLED,
			pendingMessageCount: 3,
			lastTermination: { ...TOOL_FATAL, nextAction },
			contextPercent: 97.25,
			contextWindowTokens: 1_000_000,
			systemCpuPercent: 99,
			memoryRssBytes: 3 * 1024 * 1024 * 1024,
			governorMode: "adaptive",
		});
		const lines = renderRail(
			{
				controlPlane: vm,
				modelProvider: "openrouter",
				modelId: "a-very-long-model-identifier-that-cannot-fit-the-rail",
				thinkingLevel: "xhigh",
				headroomStatus: "headroom:0.29.0-with-a-long-build-suffix",
				mcpCount: 12,
				skillCount: 96,
				cwdLabel: "~/a/very/long/current/working/directory/path",
				gitBranch: "feature/a-very-long-branch-name",
			},
			width,
		);

		expect(lines.map((line) => visibleWidth(line))).toEqual(lines.map(() => width));
		const nextRow = lines.map(stripAnsi).find((line) => line.includes("next:"));
		expect(nextRow).toContain("…");
	});
});

describe("control-plane rail VERIFY section", () => {
	test.each([
		["an empty snapshot", {}],
		["a sourced snapshot without evidence", { controlPlane: buildControlPlaneViewModel(SETTLED) }],
	])("renders one verdict row reading unverified for %s", (_name, snapshot: ControlPanelStatusSnapshot) => {
		const plain = renderRail(snapshot, 38).map(stripAnsi);
		const verdictRows = plain.filter((line) => line.includes("verdict:"));

		expect(verdictRows).toHaveLength(1);
		expect(verdictRows[0]).toContain("verdict: ? unverified");
		expect(plain.join("\n")).not.toMatch(/evidence:|verify:/);
	});
});

describe("control-plane rail surfaces", () => {
	const live = buildControlPlaneViewModel({
		...SETTLED,
		pendingMessageCount: 3,
		lastTermination: TOOL_FATAL,
		systemCpuPercent: 91.7,
		busyCpuPercent: 85,
		memoryRssBytes: null,
		governorMode: "observe",
	});

	test("the overlay shows host CPU busy in the warning colour, unknown RSS, and the governor mode", () => {
		const lines = renderRail({ controlPlane: live }, 38);
		const plain = lines.map(stripAnsi);
		const cpuIndex = plain.findIndex((line) => line.includes("cpu: ▲ busy 91%"));

		expect(cpuIndex, plain.join("\n")).toBeGreaterThan(-1);
		expect(lines[cpuIndex]).toContain(theme.fg("warning", "▲ busy 91%"));
		expect(plain.join("\n")).toContain("rss: ?");
		expect(plain.join("\n")).toContain("gov: observe");
		expect(plain.join("\n")).toContain("queue: 3");
		expect(plain.join("\n")).not.toContain("mem:");
	});

	test("the overlay omits the CPU figure when host CPU has no source", () => {
		const plain = renderRail({ controlPlane: buildControlPlaneViewModel(SETTLED) }, 38).map(stripAnsi);

		expect(plain.find((line) => line.includes("cpu:"))).toMatch(/cpu: \? unknown\s+│$/);
	});

	test("the header rail omits the queue, the failure card, host CPU and RSS", () => {
		const plain = renderHeader({ controlPlane: live }, 160).map(stripAnsi).join("\n");

		expect(plain).toContain("state: ! tool_fatal");
		expect(plain).toContain("verdict: ? unverified");
		expect(plain).toContain("gov: observe");
		expect(plain).toContain("ext: MCP:? skills:?");
		for (const row of ["queue:", "cause:", "phase:", "effects:", "retry:", "cpu:", "rss:", "mem:"]) {
			expect(plain).not.toContain(row);
		}
		// Only the TODO section owns a "next:" row in the header.
		expect(plain.split("next:")).toHaveLength(2);
	});

	test.each([
		[75, "ctx: ▲ elevated 75.0%/128k", "75%"],
		[95, "ctx: ! critical 95.0%/128k", "95%"],
		[69.96, "ctx: ✓ normal 69.9%/128k", "69%"],
	])("context at %d%% renders %s and a floored meter figure on both surfaces", (percent, row, figure) => {
		const snapshot: ControlPanelStatusSnapshot = { contextPercent: percent, contextWindowTokens: 128_000 };

		for (const lines of [renderRail(snapshot, 38), renderHeader(snapshot, 160)]) {
			const plain = lines.map(stripAnsi).join("\n");
			expect(plain).toContain(row);
			expect(plain).toMatch(new RegExp(`meter: [█░]{12} ${figure}`));
		}
	});
});

function fakeSession(
	getContextUsage: AgentSession["getContextUsage"],
	overrides: { readonly isStreaming?: boolean; readonly pendingMessageCount?: number } = {},
): AgentSession {
	return {
		isStreaming: overrides.isStreaming ?? true,
		isCompacting: false,
		isRetrying: false,
		pendingMessageCount: overrides.pendingMessageCount ?? 2,
		lastTermination: undefined,
		autoCompactionEnabled: true,
		getContextUsage,
		settingsManager: { getResourceGovernorSettings: () => ({}) },
		state: {
			model: { id: "omk-test-model", provider: "openrouter", contextWindow: 200_000 },
			thinkingLevel: "high",
		},
		resourceLoader: { getSkills: () => ({ skills: [] }) },
	} as unknown as AgentSession;
}

describe("createControlPanelStatusSnapshot", () => {
	const sessionManager = { getCwd: () => "/tmp/omk-control-rail-test" } as unknown as SessionManager;

	test("sources RUN from the live session instead of hardcoded healthy strings", () => {
		const getContextUsage = vi.fn(() => ({ tokens: 54_400, contextWindow: 128_000, percent: 42.5 }));
		const footerData = {
			getGitBranch: () => "main",
			getSystemCpuPercent: () => 12,
			getMemoryRssBytes: () => 64 * 1024 * 1024,
		} as unknown as ReadonlyFooterDataProvider;

		const snapshot = createControlPanelStatusSnapshot(fakeSession(getContextUsage), sessionManager, footerData);

		// Context usage walks the session branch: one read per snapshot, shared by CTX and the view model.
		expect(getContextUsage).toHaveBeenCalledTimes(1);
		expect(snapshot.contextPercent).toBe(42.5);
		expect(snapshot.contextWindowTokens).toBe(128_000);
		expect(snapshot.controlPlane?.run.label).toBe("running");
		expect(snapshot.controlPlane?.run.queued).toBe(2);
		expect(snapshot.controlPlane?.verify.verdict).toBe("unverified");
		expect(snapshot.controlPlane?.context.percent).toBe(42.5);
		expect(snapshot.controlPlane?.resources.systemCpuPercent).toBe(12);
		for (const key of LEGACY_SNAPSHOT_KEYS) expect(snapshot).not.toHaveProperty(key);

		const plain = renderRail(snapshot, 38).map(stripAnsi).join("\n");
		expect(plain).toContain("state: ● running");
		expect(plain).toContain("cpu: ✓ normal 12%");
		expect(plain).toContain("rss: 64M");
	});

	test("falls back to the model context window when usage is unavailable", () => {
		const getContextUsage = vi.fn(() => undefined);

		const snapshot = createControlPanelStatusSnapshot(
			fakeSession(getContextUsage, { isStreaming: false, pendingMessageCount: 0 }),
			sessionManager,
		);

		expect(getContextUsage).toHaveBeenCalledTimes(1);
		expect(snapshot.contextPercent).toBeNull();
		expect(snapshot.contextWindowTokens).toBe(200_000);
		expect(snapshot.controlPlane?.context.windowTokens).toBe(200_000);
		// No footer metrics port: host CPU and RSS have no source.
		expect(snapshot.controlPlane?.resources.state).toBe("unknown");
		expect(snapshot.controlPlane?.resources.memoryRssBytes).toBeNull();
	});
});
