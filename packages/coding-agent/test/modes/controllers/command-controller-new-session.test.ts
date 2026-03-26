import { beforeAll, describe, expect, it, vi } from "bun:test";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { type Component, Spacer, Text } from "@oh-my-pi/pi-tui";

const setSessionTerminalTitleMock = vi.fn();

vi.mock("@oh-my-pi/pi-coding-agent/utils/title-generator", () => ({
	setSessionTerminalTitle: setSessionTerminalTitleMock,
}));

type TestContainer = {
	children: Component[];
	clear: () => void;
	addChild: (child: Component) => void;
};

type TestContext = InteractiveModeContext & {
	chatContainer: TestContainer;
	pendingMessagesContainer: TestContainer;
	statusContainer: TestContainer;
	pendingTools: {
		clear: () => void;
	};
	loadingAnimation:
		| {
				stop: () => void;
		  }
		| undefined;
	statusLine: {
		invalidate: () => void;
		setSessionStartTime: (time: number) => void;
	};
	ui: {
		requestRender: () => void;
		terminal: { columns: number; rows: number };
	};
	session: {
		canStartNewSession: () => Promise<boolean>;
		newSession: (...args: unknown[]) => Promise<boolean>;
		isStreaming: boolean;
		isCompacting: boolean;
		abortCompaction: () => void;
	};
	sessionManager: {
		getSessionName: () => string;
		getCwd: () => string;
	};
	reloadTodos: () => Promise<void>;
	updateEditorTopBorder: () => void;
};

function createTrackedContainer(name: string, calls: string[], initialChildren: Component[] = []): TestContainer {
	const container: TestContainer = {
		children: [...initialChildren],
		clear: vi.fn(() => {
			container.children = [];
			calls.push(`${name}.clear`);
		}),
		addChild: vi.fn((child: Component) => {
			container.children.push(child);
			calls.push(`${name}.addChild`);
		}),
	};

	return container;
}

function createContext(options?: {
	withLoadingAnimation?: boolean;
	canStartNewSessionResult?: boolean;
	newSessionResult?: boolean;
	isStreaming?: boolean;
}): { ctx: TestContext; calls: string[] } {
	const calls: string[] = [];
	const chatContainer = createTrackedContainer("chatContainer", calls, [new Text("stale chat", 0, 0)]);
	const pendingMessagesContainer = createTrackedContainer("pendingMessagesContainer", calls, [
		new Text("pending", 0, 0),
	]);
	const statusContainer = createTrackedContainer("statusContainer", calls, [new Text("streaming status", 0, 0)]);
	const loadingAnimation =
		options?.withLoadingAnimation === false
			? undefined
			: {
					stop: vi.fn(() => {
						calls.push("loadingAnimation.stop");
					}),
				};

	const ctx = {
		chatContainer,
		pendingMessagesContainer,
		statusContainer,
		pendingTools: {
			clear: vi.fn(() => {
				calls.push("pendingTools.clear");
			}),
		},
		loadingAnimation,
		compactionQueuedMessages: ["queued"],
		streamingComponent: { active: true },
		streamingMessage: { active: true },
		statusLine: {
			invalidate: vi.fn(() => {
				calls.push("statusLine.invalidate");
			}),
			setSessionStartTime: vi.fn(() => {
				calls.push("statusLine.setSessionStartTime");
			}),
		},
		ui: {
			requestRender: vi.fn(() => {
				calls.push("ui.requestRender");
			}),
			terminal: { columns: 120, rows: 40 },
		},
		session: {
			canStartNewSession: vi.fn(async () => {
				calls.push("session.canStartNewSession");
				return options?.canStartNewSessionResult ?? true;
			}),
			newSession: vi.fn(async () => {
				calls.push("session.newSession");
				return options?.newSessionResult ?? true;
			}),
			isStreaming: options?.isStreaming ?? false,
			isCompacting: false,
			abortCompaction: vi.fn(),
		},
		sessionManager: {
			getSessionName: vi.fn(() => "Fresh session"),
			getCwd: vi.fn(() => "/tmp/project"),
		},
		reloadTodos: vi.fn(async () => {
			calls.push("reloadTodos");
		}),
		updateEditorTopBorder: vi.fn(() => {
			calls.push("updateEditorTopBorder");
		}),
	} as unknown as TestContext;

	return { ctx, calls };
}

beforeAll(() => {
	initTheme();
});

describe("CommandController /new command", () => {
	it("clearCommand clears session state and starts a fresh session without extra renders", async () => {
		setSessionTerminalTitleMock.mockReset();
		const { ctx, calls } = createContext();
		const loadingAnimation = ctx.loadingAnimation;
		setSessionTerminalTitleMock.mockImplementation(() => {
			calls.push("setSessionTerminalTitle");
		});
		const controller = new CommandController(ctx);

		const result = await controller.handleClearCommand();
		expect(result).toBe(true);

		expect(ctx.session.canStartNewSession).toHaveBeenCalledTimes(1);
		expect(ctx.session.newSession).toHaveBeenCalledTimes(1);
		expect(ctx.session.abortCompaction).not.toHaveBeenCalled();
		expect(ctx.chatContainer.clear).toHaveBeenCalledTimes(1);
		expect(ctx.pendingMessagesContainer.clear).toHaveBeenCalledTimes(1);
		expect(ctx.statusContainer.clear).toHaveBeenCalledTimes(1);
		expect(ctx.pendingTools.clear).toHaveBeenCalledTimes(1);
		expect(loadingAnimation?.stop).toHaveBeenCalledTimes(1);
		expect(ctx.loadingAnimation).toBeUndefined();
		expect(ctx.streamingComponent).toBeUndefined();
		expect(ctx.streamingMessage).toBeUndefined();
		expect(ctx.compactionQueuedMessages).toEqual([]);
		expect(ctx.statusLine.invalidate).toHaveBeenCalledTimes(1);
		expect(ctx.statusLine.setSessionStartTime).toHaveBeenCalledTimes(1);
		expect(ctx.reloadTodos).toHaveBeenCalledTimes(1);
		expect(ctx.ui.requestRender).toHaveBeenCalledTimes(2);
		expect(setSessionTerminalTitleMock).toHaveBeenCalledWith("Fresh session", "/tmp/project");
		expect(calls).toEqual(
			expect.arrayContaining([
				"session.canStartNewSession",
				"session.newSession",
				"loadingAnimation.stop",
				"statusContainer.clear",
				"setSessionTerminalTitle",
				"statusLine.invalidate",
				"statusLine.setSessionStartTime",
				"updateEditorTopBorder",
				"chatContainer.clear",
				"pendingMessagesContainer.clear",
				"pendingTools.clear",
				"reloadTodos",
			]),
		);
	});

	it("clearCommand without loadingAnimation does not throw", async () => {
		setSessionTerminalTitleMock.mockReset();
		const { ctx, calls } = createContext({ withLoadingAnimation: false });
		const controller = new CommandController(ctx);

		await expect(controller.handleClearCommand()).resolves.toBe(true);

		expect(ctx.loadingAnimation).toBeUndefined();
		expect(calls).not.toContain("loadingAnimation.stop");
		expect(ctx.ui.requestRender).toHaveBeenCalledTimes(2);
	});

	it("clearCommand keeps the current streaming session UI when newSession is cancelled", async () => {
		setSessionTerminalTitleMock.mockReset();
		const { ctx, calls } = createContext({ canStartNewSessionResult: false, isStreaming: true });
		expect(ctx.session.isStreaming).toBe(true);
		const loadingAnimation = ctx.loadingAnimation;
		const controller = new CommandController(ctx);

		const result = await controller.handleClearCommand();
		expect(result).toBe(false);
		expect(ctx.session.canStartNewSession).toHaveBeenCalledTimes(1);
		expect(ctx.session.newSession).not.toHaveBeenCalled();
		expect(setSessionTerminalTitleMock).not.toHaveBeenCalled();
		expect(ctx.statusLine.invalidate).not.toHaveBeenCalled();
		expect(ctx.statusLine.setSessionStartTime).not.toHaveBeenCalled();
		expect(ctx.updateEditorTopBorder).not.toHaveBeenCalled();
		expect(ctx.ui.requestRender).toHaveBeenCalledTimes(1);
		expect(ctx.chatContainer.clear).not.toHaveBeenCalled();
		expect(ctx.pendingMessagesContainer.clear).not.toHaveBeenCalled();
		expect(ctx.statusContainer.clear).not.toHaveBeenCalled();
		expect(ctx.pendingTools.clear).not.toHaveBeenCalled();
		expect(ctx.reloadTodos).not.toHaveBeenCalled();
		expect(loadingAnimation?.stop).not.toHaveBeenCalled();
		expect(ctx.loadingAnimation).toBe(loadingAnimation);
		expect(ctx.chatContainer.children).toHaveLength(3);
		const existingMessage = ctx.chatContainer.children[0];
		const spacer = ctx.chatContainer.children[1];
		const errorMessage = ctx.chatContainer.children[2];
		if (!(existingMessage instanceof Text)) {
			throw new Error("Expected stale chat to remain visible");
		}
		if (!(spacer instanceof Spacer)) {
			throw new Error("Expected spacer before cancellation message");
		}
		if (!(errorMessage instanceof Text)) {
			throw new Error("Expected cancellation error message");
		}
		expect(existingMessage.render(120).join("\n")).toContain("stale chat");
		expect(errorMessage.render(120).join("\n")).toContain("Error: New session cancelled");
		expect(ctx.pendingMessagesContainer.children).toHaveLength(1);
		expect(ctx.statusContainer.children).toHaveLength(1);
		const existingStatus = ctx.statusContainer.children[0];
		if (!(existingStatus instanceof Text)) {
			throw new Error("Expected current status to remain visible");
		}
		expect(existingStatus.render(120).join("\n")).toContain("streaming status");
		expect(ctx.compactionQueuedMessages as unknown).toEqual(["queued"]);
		expect(ctx.streamingComponent as unknown).toEqual({ active: true });
		expect(ctx.streamingMessage as unknown).toEqual({ active: true });
		expect(calls).toEqual([
			"session.canStartNewSession",
			"chatContainer.addChild",
			"chatContainer.addChild",
			"ui.requestRender",
		]);
	});

	it("clearCommand adds a new session started message after clearing chat", async () => {
		setSessionTerminalTitleMock.mockReset();
		const { ctx } = createContext();
		const controller = new CommandController(ctx);

		await controller.handleClearCommand();

		expect(ctx.chatContainer.children).toHaveLength(2);
		const spacer = ctx.chatContainer.children[0];
		const message = ctx.chatContainer.children[1];
		if (!(spacer instanceof Spacer)) {
			throw new Error("Expected spacer after clearing chat");
		}
		if (!(message instanceof Text)) {
			throw new Error("Expected new session message");
		}
		expect(message.render(120).join("\n")).toContain("New session started");
	});
});
