import type { ThinkingLevel } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyTaskV4, resolveThinkingLevelV4WithUncertainty } from "../../../src/core/reasoning-router-v4.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness } from "../harness.ts";

const SPELLING_PROMPT = "correct the spelling of 'recieve' to 'receive'";
const PLAN_PROMPT = "plan the architecture roadmap for the storage layer";
const NEGATION_DEBUG_PROMPT = "don't refactor this, just fix the crash";
const NEGATION_CODEGEN_PROMPT = "skip the review, just build the feature";

type SubmitEditor = { onSubmit?: (text: string) => Promise<void> | void };

type ThinkSubmitContext = {
	readonly defaultEditor: SubmitEditor;
	readonly editor: { readonly setText: (text: string) => void };
	readonly session: Harness["session"];
	readonly footer: { readonly invalidate: () => void };
	readonly handleThinkCommand: (level?: string) => void;
	readonly enableAutoThinkingMode: () => void;
	readonly applyThinkingLevel: (level: ThinkingLevel) => void;
	readonly showThinkingSelector: () => void;
	readonly showError: (message: string) => void;
	readonly showStatus: (message: string) => void;
	readonly updateEditorBorderColor: () => void;
};

type InteractiveModeThinkPrivate = {
	setupEditorSubmitHandler(this: ThinkSubmitContext): void;
	handleThinkCommand(this: ThinkSubmitContext, level?: string): void;
	enableAutoThinkingMode(this: ThinkSubmitContext): void;
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
		enableAutoThinkingMode() {
			interactiveModePrototype.enableAutoThinkingMode.call(context);
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

describe("/think auto routing", () => {
	it('/think auto enables v4 auto routing and resolves a simple edit to "low"', async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto");

		expect(harness.session.thinkingMode).toBe("auto");
		expect(context.showStatus).toHaveBeenCalledWith("Thinking: auto (v4 router, level routed per task)");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("routes plan prompts exactly as classifyTaskV4 + resolveThinkingLevelV4WithUncertainty predict", async () => {
		const { harness, context } = await createThinkSubmitContext();
		await submit(context, "/think auto");

		const verdict = classifyTaskV4({ prompt: PLAN_PROMPT });
		const expectedLevel = resolveThinkingLevelV4WithUncertainty(
			verdict,
			harness.session.getAvailableThinkingLevels(),
			undefined,
			0,
			null,
		);

		expect(verdict.taskClass).toBe("plan");
		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe(expectedLevel);
	});

	it("manual /think levels exit auto routing and keep override precedence", async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto");
		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).not.toBe("low");

		await submit(context, "/think low");
		expect(harness.session.thinkingMode).toBe("manual");
		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it.each([
		"/think auto-v1",
		"/think auto-v2",
		"/think auto-v3",
		"/think auto-v4",
		"/think auto v4",
		"/think auto:v4",
	])("%s is rejected because /think auto is the only auto entry point", async (command) => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, command);

		expect(harness.session.thinkingMode).toBe("manual");
		expect(context.showError).toHaveBeenCalledWith(expect.stringContaining("Available: auto,"));
	});
});

describe("v4 negation routing remains active through /think auto", () => {
	it('session-level: /think auto routes "don\'t refactor this, just fix the crash" to debug effort', async () => {
		const { harness, context } = await createThinkSubmitContext();
		await submit(context, "/think auto");

		const verdict = classifyTaskV4({ prompt: NEGATION_DEBUG_PROMPT });
		expect(verdict.taskClass).toBe("debug");
		expect(verdict.suppressedFeatureIds).toContain("negation:refactor-cue");
		expect(await promptAndReadLevel(harness, NEGATION_DEBUG_PROMPT)).toBe("high");
	});

	it('session-level: /think auto routes "skip the review, just build the feature" to code generation effort', async () => {
		const { harness, context } = await createThinkSubmitContext();
		await submit(context, "/think auto");

		const verdict = classifyTaskV4({ prompt: NEGATION_CODEGEN_PROMPT });
		expect(verdict.taskClass).toBe("code-gen");
		expect(verdict.suppressedFeatureIds).toContain("negation:keyword-review");
		expect(await promptAndReadLevel(harness, NEGATION_CODEGEN_PROMPT)).toBe("medium");
	});
});
