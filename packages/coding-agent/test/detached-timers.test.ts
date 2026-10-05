import { Container, Loader, type TUI } from "omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import { ChatContainer } from "../src/modes/interactive/components/chat-container.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type HandleEvent = (this: unknown, event: AgentSessionEvent) => Promise<void>;
const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as HandleEvent;
const stopWorkingLoader = Reflect.get(InteractiveMode.prototype, "stopWorkingLoader") as (this: unknown) => void;

function fakeUi() {
	return { requestRender: vi.fn() };
}

/** A bash tool row mid-execution: its renderer runs a 1 s elapsed-time ticker. */
function runningBashRow(ui: ReturnType<typeof fakeUi>): ToolExecutionComponent {
	const row = new ToolExecutionComponent(
		"bash",
		"call-1",
		{ command: "sleep 60" },
		{},
		undefined,
		ui as unknown as TUI,
		process.cwd(),
	);
	row.markExecutionStarted();
	row.updateResult({ content: [{ type: "text", text: "partial output" }], isError: false }, true);
	return row;
}

describe("detached timers", () => {
	beforeAll(() => {
		initTheme("dark", false);
	});
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	test("a running bash row ticks renders until disposed, then leaves no timer and requests no render", () => {
		const ui = fakeUi();
		const row = runningBashRow(ui);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(2_100);
		expect(ui.requestRender.mock.calls.length).toBeGreaterThanOrEqual(2);

		row.dispose();
		ui.requestRender.mockClear();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(ui.requestRender).not.toHaveBeenCalled();
	});

	test("clearing the chat stops the timers of running tool rows", () => {
		const ui = fakeUi();
		const chat = new ChatContainer();
		chat.addChild(runningBashRow(ui));
		chat.addChild(runningBashRow(ui));
		expect(vi.getTimerCount()).toBe(2);

		chat.clear();
		ui.requestRender.mockClear();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(ui.requestRender).not.toHaveBeenCalled();
	});

	test("agent_end disposes tools that are still pending", async () => {
		const ui = fakeUi();
		const pendingTools = new Map([["call-1", runningBashRow(ui)]]);
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			settingsManager: { getShowTerminalProgress: () => false },
			loadingAnimation: undefined,
			streamingComponent: undefined,
			pendingTools,
			checkShutdownRequested: async () => {},
			ui,
		};
		expect(vi.getTimerCount()).toBe(1);

		await handleEvent.call(fakeThis, { type: "agent_end", messages: [] } as unknown as AgentSessionEvent);
		ui.requestRender.mockClear();
		expect(pendingTools.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(ui.requestRender).not.toHaveBeenCalled();
	});

	test("compaction_start stops the working loader instead of detaching it", async () => {
		const ui = fakeUi();
		const statusContainer = new Container();
		const working = new Loader(
			ui as unknown as TUI,
			(s) => s,
			(s) => s,
			"Working...",
		);
		statusContainer.addChild(working);
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			settingsManager: { getShowTerminalProgress: () => false },
			defaultEditor: { onEscape: undefined },
			session: { abortCompaction: vi.fn() },
			loadingAnimation: working as Loader | undefined,
			autoCompactionLoader: undefined as Loader | undefined,
			statusContainer,
			ui,
			stopWorkingLoader,
		};
		expect(vi.getTimerCount()).toBe(1);

		await handleEvent.call(fakeThis, { type: "compaction_start", reason: "threshold" });
		expect(fakeThis.loadingAnimation).toBeUndefined();
		expect(statusContainer.children).toEqual([fakeThis.autoCompactionLoader]);
		// Only the compaction loader is left running.
		expect(vi.getTimerCount()).toBe(1);

		fakeThis.autoCompactionLoader?.stop();
		ui.requestRender.mockClear();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(2_000);
		expect(ui.requestRender).not.toHaveBeenCalled();
	});
});
