import { type Component, Container, Text, TUI } from "omk-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { TodoState } from "../src/core/todo-state.ts";
import { ControlPanelComponent } from "../src/modes/interactive/components/control-panel.ts";
import {
	type ControlPanelContent,
	type ControlPanelStatusSnapshot,
	renderControlPanelLayout,
} from "../src/modes/interactive/components/control-panel-layout.ts";
import {
	buildControlPlaneViewModel,
	type ControlPlaneSignals,
	type EvidenceSignal,
} from "../src/modes/interactive/control-plane-view-model.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const WIDTH = 160;
const HEIGHT = 30;
const TURNS = 8;

interface LiveState {
	signals: ControlPlaneSignals;
	todoState: TodoState | undefined;
}

function initialState(): LiveState {
	return {
		signals: {
			isStreaming: false,
			contextPercent: 3.2,
			contextWindowTokens: 200_000,
			autoCompactEnabled: true,
			governorMode: "adaptive",
			pendingMessageCount: 0,
		},
		todoState: undefined,
	};
}

function panelContent(state: LiveState, calls: { count: number }): ControlPanelContent {
	return {
		appName: "omk",
		version: "0.0.0-test",
		compactInstructions: () => "Ctrl+C interrupt · / commands",
		expandedInstructions: () => "Ctrl+C to interrupt\n/ for commands",
		compactOnboarding: () => "Press Ctrl+O to show full startup help.",
		onboarding: () => "[Context]\n 1 loaded · AGENTS.md",
		statusSnapshot: (): ControlPanelStatusSnapshot => {
			calls.count++;
			return {
				modelProvider: "openrouter",
				modelId: "omk-test-model",
				thinkingLevel: "high",
				mcpCount: 2,
				skillCount: 5,
				cwdLabel: "~/omk",
				gitBranch: "main",
				ansiColorState: "on",
				contextPercent: state.signals.contextPercent,
				contextWindowTokens: state.signals.contextWindowTokens,
				todoState: state.todoState,
				controlPlane: buildControlPlaneViewModel(state.signals),
			};
		},
	};
}

/** The previous header behaviour: lays out the live snapshot on every render. */
class LiveHeader implements Component {
	private readonly content: ControlPanelContent;
	constructor(content: ControlPanelContent) {
		this.content = content;
	}
	invalidate(): void {}
	render(width: number): string[] {
		return renderControlPanelLayout(this.content, false, width);
	}
}

async function flush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender();
	await Promise.resolve();
	await terminal.waitForRender();
}

const VERIFIED: EvidenceSignal = { verification: "verified", receiptPresent: true, receiptFresh: true };

/**
 * Drives a header + transcript through turns that flip every header-related value (RUN state,
 * ctx %, todo list, VERIFY verdict) after the header has scrolled into scrollback.
 */
async function runTurns(makeHeader: (content: ControlPanelContent) => Component) {
	const state = initialState();
	const calls = { count: 0 };
	const terminal = new VirtualTerminal(WIDTH, HEIGHT);
	const tui = new TUI(terminal);
	const chat = new Container();
	tui.addChild(makeHeader(panelContent(state, calls)));
	tui.addChild(chat);
	let line = 0;
	const addTurnOutput = () => {
		for (let i = 0; i < 15; i++) chat.addChild(new Text(`turn line ${String(line++).padStart(5, "0")}`, 0, 0));
	};
	for (let i = 0; i < 6; i++) addTurnOutput();
	tui.start();
	await flush(tui, terminal);
	const redrawsBefore = tui.fullRedraws;
	const callsBefore = calls.count;

	for (let turn = 0; turn < TURNS; turn++) {
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 10 + turn * 9 };
		state.todoState = { items: [{ id: "1", label: `step ${turn}`, status: "active" }], updatedAt: turn };
		await flush(tui, terminal);
		addTurnOutput();
		await flush(tui, terminal);
		state.signals = { ...state.signals, isStreaming: false, evidence: turn % 2 === 0 ? VERIFIED : undefined };
		state.todoState = { items: [{ id: "1", label: `step ${turn}`, status: "done" }], updatedAt: turn + 0.5 };
		await flush(tui, terminal);
	}

	const transcriptRows = terminal
		.getScrollBuffer()
		.map((row) => row.trim())
		.filter((row) => row.startsWith("turn line"));
	const result = {
		extraFullRedraws: tui.fullRedraws - redrawsBefore,
		duplicateRows: transcriptRows.length - new Set(transcriptRows).size,
		uniqueRows: new Set(transcriptRows).size,
		snapshotCallsAfterStart: calls.count - callsBefore,
		totalLines: line,
	};
	tui.stop();
	return result;
}

describe("startup header in scrollback", () => {
	beforeAll(() => {
		initTheme("dark", false);
	});

	test("a header that tracks live RUN/ctx/todo/VERIFY values duplicates the transcript (control)", async () => {
		const live = await runTurns((content) => new LiveHeader(content));
		expect(live.extraFullRedraws).toBeGreaterThan(0);
		expect(live.duplicateRows).toBeGreaterThan(0);
	});

	test("header-related state toggles cause no full redraw and no duplicate scrollback rows", async () => {
		const frozen = await runTurns((content) => new ControlPanelComponent(content));
		expect(frozen.extraFullRedraws).toBe(0);
		expect(frozen.duplicateRows).toBe(0);
		expect(frozen.uniqueRows).toBe(frozen.totalLines);
		// Frozen at the first turn: the status snapshot is read once more (to see the turn start), then never.
		expect(frozen.snapshotCallsAfterStart).toBe(1);
	});

	test("the header shows the pre-turn snapshot after the first turn starts", () => {
		const state = initialState();
		const calls = { count: 0 };
		const header = new ControlPanelComponent(panelContent(state, calls));
		const before = header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 80 };
		state.todoState = { items: [{ id: "1", label: "step", status: "active" }], updatedAt: 1 };
		const during = header.render(WIDTH);
		expect(during).toEqual(before);
		state.signals = { ...state.signals, isStreaming: false };
		expect(header.render(WIDTH)).toEqual(before);
		expect(calls.count).toBe(2);
	});

	test("a frozen header still re-lays out on width and expansion changes", () => {
		const state = initialState();
		const header = new ControlPanelComponent(panelContent(state, { count: 0 }));
		header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: true };
		const wide = header.render(WIDTH);
		expect(header.render(WIDTH)).toBe(wide);
		const narrow = header.render(120);
		expect(narrow).not.toBe(wide);
		header.setExpanded(true);
		expect(header.render(120)).not.toEqual(narrow);
		header.invalidate();
		expect(header.render(120)).not.toBe(narrow);
	});
});
