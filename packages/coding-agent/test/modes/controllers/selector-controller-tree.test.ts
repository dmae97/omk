import { beforeAll, describe, expect, it, vi } from "bun:test";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TreeSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tree-selector";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { SessionMessageEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { type Component, Spacer, Text } from "@oh-my-pi/pi-tui";

interface TestEditorContainer {
	children: unknown[];
	clear(): void;
	addChild(child: unknown): void;
}

interface TestEditor {
	readonly kind: "editor";
	invalidate(): void;
	render(width: number): string[];
}

type TestContext = InteractiveModeContext & {
	chatContainer: {
		children: Component[];
		addChild(child: Component): void;
	};
	lastStatusSpacer: Spacer | undefined;
	lastStatusText: Text | undefined;
	editor: TestEditor;
	editorContainer: TestEditorContainer;
};

function createTreeNode(
	id: string,
	parentId: string | null,
	text: string,
	children: SessionTreeNode[] = [],
): SessionTreeNode {
	const entry: SessionMessageEntry = {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "user",
			content: text,
			timestamp: 1,
		},
	};

	return { entry, children };
}

function createContext(tree: SessionTreeNode[], leafId: string | null) {
	const calls: string[] = [];
	const editor: TestEditor = {
		kind: "editor",
		invalidate() {},
		render() {
			return [];
		},
	};
	const chatContainer = {
		children: [] as Component[],
		addChild(child: Component) {
			this.children.push(child);
			calls.push("chatContainer.addChild");
		},
	};
	const editorContainer: TestEditorContainer = {
		children: [],
		clear() {
			this.children = [];
			calls.push("editorContainer.clear");
		},
		addChild(child: unknown) {
			this.children.push(child);
			calls.push("editorContainer.addChild");
		},
	};
	const setFocus = vi.fn((component: unknown) => {
		calls.push(component === editor ? "ui.setFocus.editor" : "ui.setFocus.selector");
	});
	const requestRender = vi.fn(() => {
		calls.push("ui.requestRender");
	});
	const showStatus = vi.fn((message: string) => {
		calls.push(`showStatus:${message}`);
		const spacer = new Spacer(1);
		const text = new Text(message, 1, 0);
		chatContainer.addChild(spacer);
		chatContainer.addChild(text);
		ctx.lastStatusSpacer = spacer;
		ctx.lastStatusText = text;
		requestRender();
	});

	const ctx = {
		chatContainer,
		lastStatusSpacer: undefined,
		lastStatusText: undefined,
		editor,
		editorContainer,
		ui: {
			setFocus,
			requestRender,
			terminal: { rows: 40 },
		},
		sessionManager: {
			getTree: vi.fn(() => tree),
			getLeafId: vi.fn(() => leafId),
			appendLabelChange: vi.fn(),
		},
		showStatus,
	} as unknown as TestContext;

	return { ctx, calls, editor, setFocus, requestRender, showStatus };
}

beforeAll(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true });
	initTheme();
});

describe("SelectorController tree selector", () => {
	it("showTreeSelector opens the tree selector in the editor container", () => {
		const tree = [createTreeNode("entry-1", null, "hello")];
		const { ctx, calls, setFocus, requestRender } = createContext(tree, "entry-1");
		const controller = new SelectorController(ctx);

		controller.showTreeSelector();

		expect(ctx.editorContainer.children).toHaveLength(1);
		const selector = ctx.editorContainer.children[0];
		expect(selector).toBeInstanceOf(TreeSelectorComponent);
		expect(setFocus).toHaveBeenCalledWith(selector);
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(calls).toEqual([
			"editorContainer.clear",
			"editorContainer.addChild",
			"ui.setFocus.selector",
			"ui.requestRender",
		]);
	});

	it("showTreeSelector with an empty tree shows a status message", () => {
		const { ctx, calls, showStatus, setFocus, requestRender } = createContext([], null);
		const controller = new SelectorController(ctx);

		controller.showTreeSelector();

		expect(showStatus).toHaveBeenCalledWith("No entries in session");
		expect(ctx.editorContainer.children).toEqual([]);
		expect(ctx.chatContainer.children).toHaveLength(2);
		const statusMessage = ctx.chatContainer.children[1];
		if (!(statusMessage instanceof Text)) {
			throw new Error("Expected empty-tree status message");
		}
		expect(statusMessage.render(120).join("\n")).toContain("No entries in session");
		expect(setFocus).not.toHaveBeenCalled();
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(calls).toEqual([
			"showStatus:No entries in session",
			"chatContainer.addChild",
			"chatContainer.addChild",
			"ui.requestRender",
		]);
	});

	it("selecting the current leaf runs done() and restores the editor before the status render", () => {
		const tree = [createTreeNode("entry-1", null, "hello")];
		const { ctx, calls, editor, setFocus, requestRender, showStatus } = createContext(tree, "entry-1");
		const controller = new SelectorController(ctx);

		controller.showTreeSelector();
		const selector = ctx.editorContainer.children[0];
		if (!(selector instanceof TreeSelectorComponent)) {
			throw new Error("Expected tree selector component");
		}

		selector.handleInput("\n");

		expect(ctx.editorContainer.children).toEqual([editor]);
		expect(setFocus).toHaveBeenLastCalledWith(editor);
		expect(showStatus).toHaveBeenCalledWith("Already at this point");
		expect(ctx.chatContainer.children).toHaveLength(2);
		const statusMessage = ctx.chatContainer.children[1];
		if (!(statusMessage instanceof Text)) {
			throw new Error("Expected current-leaf status message");
		}
		expect(statusMessage.render(120).join("\n")).toContain("Already at this point");
		expect(requestRender).toHaveBeenCalledTimes(2);
		expect(calls).toEqual([
			"editorContainer.clear",
			"editorContainer.addChild",
			"ui.setFocus.selector",
			"ui.requestRender",
			"editorContainer.clear",
			"editorContainer.addChild",
			"ui.setFocus.editor",
			"showStatus:Already at this point",
			"chatContainer.addChild",
			"chatContainer.addChild",
			"ui.requestRender",
		]);
	});
});
