import type { ThinkingLevel } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness } from "../harness.ts";

const TYPO_FIX_PROMPT = "fix a typo";
const PLAN_PROMPT = "plan the architecture roadmap for the storage layer";

type SubmitEditor = {
	onSubmit?: (text: string) => Promise<void> | void;
};

type ThinkingRouterVersionForTest = "v1" | "v2";

type ThinkSubmitContext = {
	readonly defaultEditor: SubmitEditor;
	readonly editor: {
		readonly setText: (text: string) => void;
	};
	readonly session: Harness["session"];
	readonly footer: { readonly invalidate: () => void };
	readonly handleThinkCommand: (level?: string) => void;
	readonly enableAutoThinkingMode: (version: ThinkingRouterVersionForTest) => void;
	readonly applyThinkingLevel: (level: ThinkingLevel) => void;
	readonly showThinkingSelector: () => void;
	readonly showError: (message: string) => void;
	readonly showStatus: (message: string) => void;
	readonly updateEditorBorderColor: () => void;
};

type InteractiveModeThinkPrivate = {
	setupEditorSubmitHandler(this: ThinkSubmitContext): void;
	handleThinkCommand(this: ThinkSubmitContext, level?: string): void;
	enableAutoThinkingMode(this: ThinkSubmitContext, version: ThinkingRouterVersionForTest): void;
	applyThinkingLevel(this: ThinkSubmitContext, level: ThinkingLevel): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModeThinkPrivate;

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

async function createThinkSubmitContext(): Promise<{
	readonly harness: Harness;
	readonly context: ThinkSubmitContext;
}> {
	const harness = await createHarness({ models: [{ id: "faux-think", reasoning: true }] });
	harnesses.push(harness);

	const context: ThinkSubmitContext = {
		defaultEditor: {},
		editor: { setText: vi.fn() },
		session: harness.session,
		footer: { invalidate: vi.fn() },
		handleThinkCommand(level?: string) {
			interactiveModePrototype.handleThinkCommand.call(context, level);
		},
		enableAutoThinkingMode(version: ThinkingRouterVersionForTest) {
			interactiveModePrototype.enableAutoThinkingMode.call(context, version);
		},
		applyThinkingLevel(level: ThinkingLevel) {
			interactiveModePrototype.applyThinkingLevel.call(context, level);
		},
		showThinkingSelector: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		updateEditorBorderColor: vi.fn(),
	};

	interactiveModePrototype.setupEditorSubmitHandler.call(context);
	return { harness, context };
}

async function submit(context: ThinkSubmitContext, command: string): Promise<void> {
	const handler = context.defaultEditor.onSubmit;
	expect(handler).toBeDefined();
	await handler?.(command);
}

async function promptAndReadLevel(harness: Harness, prompt: string): Promise<ThinkingLevel | undefined> {
	harness.setResponses([fauxAssistantMessage("ok")]);
	await harness.session.prompt(prompt);
	return harness.session.thinkingLevel;
}

describe("goal 005: /think reasoning router version activation", () => {
	it("/think auto returns to v1 auto routing after v2 was selected", async () => {
		const { harness, context } = await createThinkSubmitContext();
		harness.session.setThinkingMode("auto");
		harness.session.setThinkingRouterVersion("v2");

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("low");

		await submit(context, "/think auto");

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("high");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it.each(["/think auto-v2", "/think auto v2", "/think auto:v2"])("%s enables v2 auto routing", async (command) => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, command);

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("a concrete /think level exits auto-v2 and restores manual override precedence", async () => {
		const { harness, context } = await createThinkSubmitContext();
		harness.session.setThinkingMode("auto");
		harness.session.setThinkingRouterVersion("v2");
		harness.session.setThinkingLevel("high");

		await submit(context, "/think low");

		expect(harness.session.thinkingMode).toBe("manual");
		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});
});
