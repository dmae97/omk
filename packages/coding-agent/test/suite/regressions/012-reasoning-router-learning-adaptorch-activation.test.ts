/**
 * Goal 009 Wave 3 Lane V2 — /think auto-v4 activation + precedence tests
 * (specs/008-reasoning-router-advanced-accuracy tasks.md T011 slice: this
 * lane covers ONLY the auto-v4 slash-command activation/precedence surface;
 * see "Scope note" below for what this file deliberately does NOT cover).
 *
 * Mirrors the existing 005 (v2 activation) and 007 (v3 activation)
 * interactive-mode test pattern, extended to the v4 confidence-bearing
 * router (Wave 1 Lane A: reasoning-router-v4.ts / reasoning-router-v4-weights.ts,
 * evidence: .omk/goals/009-reasoning-router-advanced-accuracy-implementation/laneA-v4-core.md).
 *
 * Timeline note (why this file has no deferred/`.fails()` scaffolding):
 * At the start of this lane, `ThinkingRouterVersion` (agent-session.ts) was
 * still "v1"|"v2"|"v3" and interactive-mode.ts's handleThinkCommand switch had
 * no "auto-v4"/"auto v4"/"auto:v4" case (confirmed by direct grep and by Lane
 * A's own evidence file, which explicitly flags v4 as "Not activated ...
 * Wave 3, single-writer integration, explicitly out of this lane's scope").
 * The task that produced this file allowed writing tests against not-yet-wired
 * production code and noting that fact as deferred. While this lane was
 * reading 005/007/013/harness.ts/reasoning-router-v4.ts/agent-session.ts for
 * context, a concurrent Wave 3 lane (per this repo's documented multi-session
 * model) landed the actual wiring in this shared worktree: `git status
 * --porcelain` shows `agent-session.ts`, `interactive-mode.ts`, and
 * `slash-commands.ts` as modified, `ThinkingRouterVersion` now reads
 * "v1"|"v2"|"v3"|"v4", and `_applyAutoThinkingLevelV4` / the three
 * "auto-v4"/"auto v4"/"auto:v4" switch cases / `AUTO_V4_THINKING_ENTRY` /
 * `applyThinkingSelection`'s v4 branch / `getThinkingSelectorValue`'s v4
 * branch all now exist. Every test below was therefore written AND verified
 * against the real, current implementation (see this lane's evidence file for
 * the exact verification commands and output) — none of it is aspirational.
 *
 * Scope note (why this file's name mentions "learning" and "adaptorch" but
 * the tests below do not): `_applyAutoThinkingLevelV4`'s own doc comment
 * states bias/hint are passed as 0/null "because the privacy learning ledger
 * and the Adaptorch advisory bridge are separate, default-off modules not yet
 * wired into the session (pending a later settings-UX decision)". Wave 1
 * Lane L's `router-feedback-collector.ts`/`reasoning-router-bias.ts` and Lane
 * B's `adaptorch-bridge.ts` remain unwired (still untracked `??` files per
 * `git status`, unchanged). This lane's delegated scope is narrowly
 * "auto-v4 activation/precedence tests" — the learning-ledger/Adaptorch
 * precedence half of tasks.md T011 is a separate, not-yet-delegated follow-up
 * and is intentionally NOT covered here (see this lane's evidence file).
 *
 * Every prompt below is synthetic test data (no real session text, user
 * names, paths, tokens, or URLs). SPELLING_PROMPT/TYPO_FIX_PROMPT/PLAN_PROMPT
 * are copied verbatim from 007's own constants for direct behavioral parity;
 * the two negation prompts are copied verbatim from 013's already-verified
 * "bounded negation" test cases (013-reasoning-router-v4-accuracy.test.ts) so
 * this file's expectations cannot silently drift from that lane's ground
 * truth. 013 is read-only grounding for this file and was not modified.
 */

import type { ThinkingLevel } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyTaskV3, TASK_CLASS_THINKING_LEVELS_V3 } from "../../../src/core/reasoning-router-v3.ts";
import { classifyTaskV4, TASK_CLASS_THINKING_LEVELS_V4 } from "../../../src/core/reasoning-router-v4.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness } from "../harness.ts";

const SPELLING_PROMPT = "correct the spelling of 'recieve' to 'receive'";
const TYPO_FIX_PROMPT = "fix a typo";
const PLAN_PROMPT = "plan the architecture roadmap for the storage layer";
/** From 013: v3 misclassifies this as "refactor" (high); v4 correctly classifies it as "debug" (also high). */
const NEGATION_DEBUG_PROMPT = "don't refactor this, just fix the crash";
/** From 013: v3 misclassifies this as "review" (high); v4 correctly classifies it as "code-gen" (medium) -- an OBSERVABLE resolved-level divergence at the session level, unlike the prompt above. */
const NEGATION_CODEGEN_PROMPT = "skip the review, just build the feature";

type SubmitEditor = {
	onSubmit?: (text: string) => Promise<void> | void;
};

type ThinkingRouterVersionForTest = "v1" | "v2" | "v3" | "v4";

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

describe("goal 009 wave 3 lane V2: /think auto-v4 activation and precedence", () => {
	it.each(["/think auto-v4", "/think auto v4", "/think auto:v4"])("%s enables v4 auto routing", async (command) => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, command);

		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("/think auto returns to v1 auto routing after v4 was selected", async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");

		await submit(context, "/think auto");

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("high");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("a concrete /think level exits auto-v4 and restores manual override precedence", async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");

		await submit(context, "/think low");

		expect(harness.session.thinkingMode).toBe("manual");
		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});
});

describe("goal 009 wave 3 lane V2: /think auto-v2 and auto-v3 still work after v4 exists (regression guard)", () => {
	it('/think auto-v2 still resolves the known simple-edit case to "low"', async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v2");

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it('/think auto-v3 still resolves the known v2-miss spelling case to "low"', async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v3");

		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("/think auto-v2 remains v2 after v4 was selected (precedence is not sticky to v4)", async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, NEGATION_CODEGEN_PROMPT)).toBe("medium");

		await submit(context, "/think auto-v2");

		expect(await promptAndReadLevel(harness, TYPO_FIX_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
	});
});

describe("goal 009 wave 3 lane V2: v3 vs v4 diverge on negated prompts (the required negation case)", () => {
	it('algorithm-level: classifyTaskV3 vs classifyTaskV4 diverge on "don\'t refactor this, just fix the crash" (v3="refactor" misclassified, v4="debug" correct; both happen to resolve "high")', () => {
		expect(classifyTaskV3({ prompt: NEGATION_DEBUG_PROMPT })).toBe("refactor");
		expect(TASK_CLASS_THINKING_LEVELS_V3.refactor).toBe("high");

		const v4Verdict = classifyTaskV4({ prompt: NEGATION_DEBUG_PROMPT });
		expect(v4Verdict.taskClass).toBe("debug");
		expect(TASK_CLASS_THINKING_LEVELS_V4.debug).toBe("high");
		expect(v4Verdict.suppressedFeatureIds).toContain("negation:refactor-cue");
	});

	it('algorithm-level: classifyTaskV3 vs classifyTaskV4 diverge on "skip the review, just build the feature" (v3="review"/high, v4="code-gen"/medium -- an actual level divergence)', () => {
		expect(classifyTaskV3({ prompt: NEGATION_CODEGEN_PROMPT })).toBe("review");
		expect(TASK_CLASS_THINKING_LEVELS_V3.review).toBe("high");

		const v4Verdict = classifyTaskV4({ prompt: NEGATION_CODEGEN_PROMPT });
		expect(v4Verdict.taskClass).toBe("code-gen");
		expect(TASK_CLASS_THINKING_LEVELS_V4["code-gen"]).toBe("medium");
		expect(v4Verdict.suppressedFeatureIds).toContain("negation:keyword-review");
	});

	it('session-level: /think auto-v4 routes "don\'t refactor this, just fix the crash" to "high" (debug\'s rule-table level)', async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v4");

		expect(await promptAndReadLevel(harness, NEGATION_DEBUG_PROMPT)).toBe("high");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it('session-level: /think auto-v4 resolves "skip the review, just build the feature" to "medium", diverging from auto-v3\'s "high"', async () => {
		const { harness, context } = await createThinkSubmitContext();

		await submit(context, "/think auto-v3");
		expect(await promptAndReadLevel(harness, NEGATION_CODEGEN_PROMPT)).toBe("high");

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, NEGATION_CODEGEN_PROMPT)).toBe("medium");

		expect(context.showError).not.toHaveBeenCalled();
	});
});
