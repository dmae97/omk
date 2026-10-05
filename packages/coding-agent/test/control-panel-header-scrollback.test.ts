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
	modelId: string;
	sessionId: string;
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
		modelId: "omk-test-model",
		sessionId: "session-1",
	};
}

function snapshotOf(state: LiveState): ControlPanelStatusSnapshot {
	return {
		modelProvider: "openrouter",
		modelId: state.modelId,
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
			return snapshotOf(state);
		},
		headerKey: () => ({ model: `openrouter/${state.modelId}/high`, session: state.sessionId }),
	};
}

/** What a new header renders for `content` (same plain/colour mode as the header under test). */
function freshRender(content: ControlPanelContent): string[] {
	return new ControlPanelComponent({ ...content, headerKey: undefined }).render(WIDTH);
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

function countCopies(rows: readonly string[]): Map<string, number> {
	const copies = new Map<string, number>();
	for (const row of rows) copies.set(row, (copies.get(row) ?? 0) + 1);
	return copies;
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
async function runTurns(
	makeHeader: (content: ControlPanelContent) => Component,
	betweenTurns?: (state: LiveState, turn: number) => void,
) {
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
		betweenTurns?.(state, turn);
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
		maxCopies: Math.max(0, ...countCopies(transcriptRows).values()),
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

	test("after /model the frozen header shows the new model and the current idle snapshot", () => {
		const state = initialState();
		const calls = { count: 0 };
		const header = new ControlPanelComponent(panelContent(state, calls));
		header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 40 };
		const frozen = header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: false };
		state.todoState = { items: [{ id: "1", label: "step", status: "done" }], updatedAt: 1 };
		expect(header.render(WIDTH)).toBe(frozen);
		expect(frozen.join("\n")).not.toContain("omk-next-model");

		state.modelId = "omk-next-model";
		const refreshed = header.render(WIDTH);
		expect(refreshed.join("\n")).toContain("omk-next-model");
		expect(refreshed).toEqual(freshRender(panelContent(state, { count: 0 })));
		// Frozen again on the re-captured snapshot: later turns do not change it.
		const callsAfterRefresh = calls.count;
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 90 };
		expect(header.render(WIDTH)).toBe(refreshed);
		expect(calls.count).toBe(callsAfterRefresh);
	});

	test("a model change during a turn updates only the model rows of the frozen header", () => {
		const state = initialState();
		const header = new ControlPanelComponent(panelContent(state, { count: 0 }));
		header.render(WIDTH);
		const preTurn = snapshotOf(state);
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 70 };
		header.render(WIDTH);
		state.modelId = "omk-next-model";
		const expected = freshRender({
			...panelContent(state, { count: 0 }),
			statusSnapshot: () => ({ ...preTurn, modelId: "omk-next-model" }),
		});
		expect(header.render(WIDTH)).toEqual(expected);
	});

	test("after /new or /resume the header is live again until the new session's first turn", () => {
		const state = initialState();
		const calls = { count: 0 };
		const header = new ControlPanelComponent(panelContent(state, calls));
		header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 55 };
		const frozen = header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: false };

		// /resume: another session with its own ctx, TODO and model.
		state.sessionId = "session-2";
		state.modelId = "omk-resumed-model";
		state.signals = { ...state.signals, contextPercent: 61 };
		state.todoState = { items: [{ id: "1", label: "resumed step", status: "active" }], updatedAt: 2 };
		const resumed = header.render(WIDTH);
		expect(resumed).not.toEqual(frozen);
		expect(resumed).toEqual(freshRender(panelContent(state, { count: 0 })));
		expect(resumed.join("\n")).toContain("omk-resumed-model");

		// Live before the first turn of the new session...
		state.signals = { ...state.signals, contextPercent: 62 };
		const beforeTurn = header.render(WIDTH);
		expect(beforeTurn).toEqual(freshRender(panelContent(state, { count: 0 })));
		// ...then frozen on its last pre-turn snapshot once the turn starts.
		state.signals = { ...state.signals, isStreaming: true, contextPercent: 95 };
		expect(header.render(WIDTH)).toEqual(beforeTurn);
		state.signals = { ...state.signals, isStreaming: false };
		const callsWhenFrozen = calls.count;
		expect(header.render(WIDTH)).toEqual(beforeTurn);
		expect(calls.count).toBe(callsWhenFrozen);

		// /new: a fresh session resets the same way.
		state.sessionId = "session-3";
		state.todoState = undefined;
		state.signals = { ...state.signals, contextPercent: 0 };
		expect(header.render(WIDTH)).toEqual(freshRender(panelContent(state, { count: 0 })));
	});

	test("refreshHeaderSnapshot() re-captures a frozen header explicitly", () => {
		const state = initialState();
		const content = { ...panelContent(state, { count: 0 }), headerKey: undefined };
		const header = new ControlPanelComponent(content);
		header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: true };
		const frozen = header.render(WIDTH);
		state.signals = { ...state.signals, isStreaming: false, contextPercent: 33 };
		state.modelId = "omk-next-model";
		expect(header.render(WIDTH)).toBe(frozen);
		header.refreshHeaderSnapshot();
		expect(header.render(WIDTH)).toEqual(freshRender(content));
	});

	test("a /model between turns repaints the scrolled-off header once, then turns stay redraw-free", async () => {
		const result = await runTurns(
			(content) => new ControlPanelComponent(content),
			(state, turn) => {
				if (turn === 4) state.modelId = "omk-next-model";
			},
		);
		// The model rows sit in scrollback, so showing the new model needs one repaint from the
		// header down (one extra copy of the transcript so far); the other turns add nothing.
		expect(result.extraFullRedraws).toBe(1);
		expect(result.maxCopies).toBeLessThanOrEqual(2);
		expect(result.uniqueRows).toBe(result.totalLines);
	});

	test("/new or /resume (transcript cleared, new session key) does not duplicate the old transcript", async () => {
		const state = initialState();
		const terminal = new VirtualTerminal(WIDTH, HEIGHT);
		const tui = new TUI(terminal);
		const chat = new Container();
		tui.addChild(new ControlPanelComponent(panelContent(state, { count: 0 })));
		tui.addChild(chat);
		for (let i = 0; i < 90; i++) chat.addChild(new Text(`old line ${String(i).padStart(5, "0")}`, 0, 0));
		tui.start();
		await flush(tui, terminal);
		state.signals = { ...state.signals, isStreaming: true };
		await flush(tui, terminal);
		state.signals = { ...state.signals, isStreaming: false, contextPercent: 41 };
		await flush(tui, terminal);

		state.sessionId = "session-2";
		state.modelId = "omk-resumed-model";
		chat.clear();
		for (let i = 0; i < 5; i++) chat.addChild(new Text(`resumed line ${i}`, 0, 0));
		await flush(tui, terminal);
		const oldRows = terminal
			.getScrollBuffer()
			.map((row) => row.trim())
			.filter((row) => row.startsWith("old line"));
		expect(Math.max(...countCopies(oldRows).values())).toBe(1);
		expect(terminal.getViewport().join("\n")).toContain("omk-resumed-model");
		tui.stop();
	});
});
