/**
 * Spec 051: with every A/B harness flag on, the cacheable request prefix stays
 * byte-stable for the whole session. Every outgoing provider request is
 * captured below spec 033's cap wrapper, and on each call (a) the system prompt
 * hash and (b) the tool list hash equal the first call's, and (c) the messages
 * of the previous call in the same lane are a byte-identical prefix of this
 * call's messages.
 *
 * Marked, not ignored: spec 032's verifier deliberately starts from a fresh
 * context (its own lane), a compaction summary is its own request, and a
 * compaction resets the message prefix of the calls after it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool, StreamFn } from "omk-agent-core";
import { type Context, fauxAssistantMessage, fauxThinking, fauxToolCall, type Message } from "omk-ai";
import { serializePromptMessage, systemHash, toolsHash } from "omk-ai/prompt-hash";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { buildWatchdogMessage } from "../../src/core/deliverable-guard.ts";
import deliverableGuard from "../../src/core/extensions/builtin/deliverable-guard.ts";
import finishCheck from "../../src/core/extensions/builtin/finish-check.ts";
import goalController from "../../src/core/extensions/builtin/goal-controller.ts";
import identicalLoop from "../../src/core/extensions/builtin/identical-loop.ts";
import promptPreset from "../../src/core/extensions/builtin/prompt-preset.ts";
import toolPairRepair from "../../src/core/extensions/builtin/tool-pair-repair.ts";
import { FINISH_CHECK_SAVE_NOW_MESSAGE } from "../../src/core/finish-check.ts";
import { FINISH_CHECK_REVERIFY_MARKER } from "../../src/core/finish-check-reverify.ts";
import { createResponseReasoningCapStreamFn } from "../../src/core/response-reasoning-cap.ts";
import { loadSkillsFromDir, type Skill } from "../../src/core/skills.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

interface CapturedCall {
	readonly index: number;
	readonly system: string;
	readonly tools: string;
	readonly messages: readonly string[];
	readonly lane: "main" | "verifier" | "compaction";
	readonly compactionsBefore: number;
	/** First call of a new `session.prompt` (not a tool loop step or an extension follow-up). */
	readonly userPromptStart: boolean;
	readonly reasoning: string | undefined;
	readonly userTexts: readonly string[];
}

/** The A/B flags of specs 031–035 (031's discipline prompt is finish-check itself), all on, with a budget. */
const FLAGS_ON = {
	OMK_FINISH_CHECK: "always",
	OMK_FINISH_CHECK_EXTRA_TURN: "on",
	OMK_FINISH_CHECK_REVERIFY: "on",
	OMK_DELIVERABLE_GUARD: "always",
	OMK_TIME_BUDGET_SEC: "900",
};
const FLAGS_OFF = { OMK_FINISH_CHECK: "off", OMK_DELIVERABLE_GUARD: "off" };

const TASK_A = "Fix the failing parser bug in parse.py and write the result to a.txt.";
const TASK_B = "Now write the summary to b.txt.";

function fileTools(cwd: () => string): AgentTool[] {
	return [
		{
			name: "read",
			label: "Read",
			description: "Read a file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const path = join(cwd(), (params as { path: string }).path);
				const text = existsSync(path) ? readFileSync(path, "utf8") : "missing";
				return { content: [{ type: "text", text }], details: {} };
			},
		},
		{
			name: "write",
			label: "Write",
			description: "Write a file",
			parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			execute: async (_id, params) => {
				const { path, content } = params as { path: string; content: string };
				writeFileSync(join(cwd(), path), content);
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		},
	];
}

/** Skills the native `xai` harness may auto-select per prompt (grok-harness allowlist). */
function harnessSkills(): Skill[] {
	const skill = (name: string, description: string): Skill => ({
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "user", origin: "top-level" },
		disableModelInvocation: false,
	});
	return [
		skill("programming", "Write, change and refactor code and files in any programming language."),
		skill("debugging", "Find and fix bugs: failing checks, wrong results, errors, verify each requirement."),
		skill("headroom", "Keep the context window small under context pressure."),
	];
}

/** The skills shipped in the package (`resources/neo/skills`), loaded as a run loads them. */
function bundledSkills(): Skill[] {
	const dir = fileURLToPath(new URL("../../resources/neo/skills", import.meta.url));
	return loadSkillsFromDir({ dir, source: "builtin" }).skills;
}

function userTexts(context: Context): string[] {
	return context.messages.flatMap((message) => {
		if (message.role !== "user") return [];
		const content = message.content;
		return [
			typeof content === "string" ? content : content.map((part) => ("text" in part ? part.text : "")).join(""),
		];
	});
}

/** Mismatches of the three prefix assertions, one line each; empty when the prefix is stable. */
function prefixBreaks(calls: readonly CapturedCall[]): string[] {
	const breaks: string[] = [];
	const first = calls[0];
	const previousInLane = new Map<CapturedCall["lane"], CapturedCall>();
	for (const call of calls) {
		if (call.lane === "compaction") continue;
		if (call.system !== first.system) breaks.push(`call ${call.index}: system prompt hash changed`);
		if (call.tools !== first.tools) breaks.push(`call ${call.index}: tools hash changed`);
		const previous = previousInLane.get(call.lane);
		previousInLane.set(call.lane, call);
		if (!previous || previous.compactionsBefore !== call.compactionsBefore) continue;
		const changed = previous.messages.findIndex((message, i) => call.messages[i] !== message);
		if (changed !== -1) breaks.push(`call ${call.index}: message ${changed} of call ${previous.index} changed`);
	}
	return breaks;
}

interface SessionOptions {
	readonly provider?: string;
	readonly skills?: Skill[];
	readonly compactBetweenTasks?: boolean;
	/** Settings for the session, e.g. `contextBudget: { enabled: true }`. */
	readonly settings?: HarnessOptions["settings"];
	/** Extra extensions, loaded after the built-in harness ones (for the detector self-test). */
	readonly extensions?: ExtensionFactory[];
}

async function runSession(
	env: Record<string, string>,
	harnesses: Harness[],
	options: SessionOptions = {},
): Promise<CapturedCall[]> {
	let fraction = 0.05;
	const budget = () => ({ budgetMs: 900_000, elapsedMs: fraction * 900_000, elapsedFraction: fraction });
	const factories: ExtensionFactory[] = [
		identicalLoop,
		toolPairRepair,
		promptPreset,
		goalController,
		(omk) =>
			deliverableGuard(omk, {
				env,
				budgetFraction: () => fraction,
				timers: { setInterval: () => undefined, clearInterval: () => undefined },
				runLog: () => undefined,
				onTerminate: () => () => undefined,
			}),
		(omk) => finishCheck(omk, { env, now: () => 0, readBudget: budget }),
		...(options.extensions ?? []),
	];
	let cwd = "";
	const resourceLoader = createTestResourceLoader({ extensionsResult: await createTestExtensionsResult(factories) });
	const skills = options.skills ?? [];
	resourceLoader.getSkills = () => ({ skills, diagnostics: [] });
	const harness = await createHarness({
		provider: options.provider,
		settings: options.settings,
		models: [{ id: "faux-reasoning", reasoning: true }],
		tools: fileTools(() => cwd),
		resourceLoader,
	});
	harnesses.push(harness);
	cwd = harness.tempDir;
	harness.session.setThinkingLevel("high");

	const calls: CapturedCall[] = [];
	let compacting = false;
	let promptStarted = false;
	harness.session.subscribe((event) => {
		if (event.type === "compaction_start") compacting = true;
		if (event.type === "compaction_end") compacting = false;
	});
	const inner = harness.session.agent.streamFn;
	const capture: StreamFn = (model, context, streamOptions) => {
		const first = userTexts(context)[0] ?? "";
		const lane = compacting ? "compaction" : first.startsWith(FINISH_CHECK_REVERIFY_MARKER) ? "verifier" : "main";
		calls.push({
			index: calls.length,
			system: systemHash(context),
			tools: toolsHash(context),
			messages: context.messages.map((message: Message) => serializePromptMessage(message)),
			lane,
			compactionsBefore: harness.eventsOfType("compaction_end").length,
			userPromptStart: lane === "main" && promptStarted,
			reasoning: streamOptions?.reasoning,
			userTexts: userTexts(context),
		});
		if (lane === "main") promptStarted = false;
		return inner(model, context, streamOptions);
	};
	// Spec 033 wraps the provider stream as `createSdkProviderStream` does; the tiny cap trips on long thinking.
	harness.session.agent.streamFn =
		env.OMK_FINISH_CHECK === "off"
			? capture
			: createResponseReasoningCapStreamFn(capture, { maxReasoningTokens: 200, maxWallMs: 60_000 });

	const at = (next: number, reply: () => ReturnType<typeof fauxAssistantMessage>) => () => {
		fraction = next;
		return reply();
	};
	const write = (path: string, content: string) =>
		fauxAssistantMessage([fauxToolCall("write", { path, content })], { stopReason: "toolUse" });
	const read = (path: string) => fauxAssistantMessage([fauxToolCall("read", { path })], { stopReason: "toolUse" });
	harness.setResponses([
		// Task A finishes early: finish-check's turn, the 032 verifier (fresh lane) and the 035 fix turn.
		at(0.1, () => write("a.txt", "1")),
		at(0.12, () => fauxAssistantMessage("done with a")),
		at(0.14, () => fauxAssistantMessage("check turn: a.txt holds 1")),
		at(0.16, () => read("a.txt")),
		at(0.18, () => fauxAssistantMessage("VERIFY 1: FAIL - a.txt; expected 2; got 1\nVERDICT: FAIL")),
		at(0.2, () => write("a.txt", "2")),
		at(0.22, () => fauxAssistantMessage("fixed a")),
	]);
	promptStarted = true;
	await harness.session.prompt(TASK_A);
	if (options.compactBetweenTasks) {
		harness.appendResponses([fauxAssistantMessage("## Summary\nTask A: a.txt holds 2.")]);
		await harness.session.compact();
	}
	harness.appendResponses([
		// Task B: 034's 40% steer, a 033 cap retry at one lower effort, 75% save-now steer, finish-check.
		at(0.45, () => read("a.txt")),
		at(0.8, () => fauxAssistantMessage([fauxThinking("x".repeat(4000)), fauxToolCall("read", { path: "a.txt" })])),
		at(0.8, () => write("b.txt", "b")),
		at(0.82, () => fauxAssistantMessage("done with b")),
		at(0.84, () => fauxAssistantMessage("check turn: b.txt ok")),
	]);
	promptStarted = true;
	await harness.session.prompt(TASK_B);
	return calls;
}

describe("prompt cache prefix stability (spec 051)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("keeps system, tools and earlier messages byte-identical with every A/B flag on", async () => {
		const calls = await runSession(FLAGS_ON, harnesses);
		expect(prefixBreaks(calls)).toEqual([]);
		// The run really exercised each feature that adds text mid-session.
		const seen = calls.at(-1)?.userTexts.join("\n") ?? "";
		expect(calls.some((call) => call.lane === "verifier")).toBe(true);
		expect(seen).toContain("Finish check");
		expect(seen).toContain("Fresh verification result");
		expect(seen).toContain(buildWatchdogMessage([join(harnesses[0].tempDir, "b.txt")]));
		expect(seen).toContain(FINISH_CHECK_SAVE_NOW_MESSAGE);
		expect(calls.map((call) => call.reasoning)).toContain("medium");
	});

	it("keeps the prefix with every flag off (baseline)", async () => {
		const calls = await runSession(FLAGS_OFF, harnesses);
		// No check turn without the flags: two calls for task A, then task B starts.
		expect(calls.filter((call) => call.userPromptStart).map((call) => call.index)).toEqual([0, 2]);
		expect(prefixBreaks(calls)).toEqual([]);
	});

	it("resets only the message prefix across a marked compaction", async () => {
		const calls = await runSession(FLAGS_ON, harnesses, { compactBetweenTasks: true });
		expect(calls.some((call) => call.lane === "compaction")).toBe(true);
		expect(harnesses[0].eventsOfType("compaction_end")).toHaveLength(1);
		expect(prefixBreaks(calls)).toEqual([]);
	});

	it("keeps the prefix with the bundled skills loaded and contextBudget off (default)", async () => {
		const skills = bundledSkills();
		expect(skills.length).toBeGreaterThanOrEqual(6);
		const calls = await runSession(FLAGS_ON, harnesses, { skills });
		expect(prefixBreaks(calls)).toEqual([]);
	});

	// Expected failure, owned by spec 050 (OMK): with `contextBudget.enabled` the skills section of the
	// system prompt is re-ranked against each user prompt (`_getContextBudgetOptions(expandedText)` in
	// agent-session.ts → `renderSystemPromptBudgetedResources` in system-prompt.ts), so task B's system
	// prompt lists the skills in a different order. Spec 050 moves per-task skills into an appended message;
	// the day that lands this test turns red — then replace `it.fails` with `it`.
	it.fails("keeps the prefix with contextBudget on (stable once spec 050 lands)", async () => {
		const calls = await runSession(FLAGS_ON, harnesses, {
			skills: bundledSkills(),
			settings: { contextBudget: { enabled: true } } as HarnessOptions["settings"],
		});
		expect(prefixBreaks(calls)).toEqual([]);
	});

	it("detects a per-turn system prompt and an edited earlier message (self-test)", async () => {
		let turn = 0;
		const clock: ExtensionFactory = (omk) => {
			omk.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\nturn ${++turn}` }));
			omk.on("context", (event) => ({
				messages: event.messages.map((message, i) =>
					i === 0 && message.role === "user" ? { ...message, content: `${turn}: ${TASK_A}` } : message,
				),
			}));
		};
		const calls = await runSession(FLAGS_OFF, harnesses, { extensions: [clock] });
		expect(prefixBreaks(calls)).toEqual([
			"call 2: system prompt hash changed",
			"call 2: message 0 of call 1 changed",
		]);
	});

	it.each([
		["flags on", FLAGS_ON],
		["flags off", FLAGS_OFF],
	])("native xai harness skills: stable within one user prompt, %s", async (_label, env) => {
		const calls = await runSession(env, harnesses, { provider: "xai", skills: harnessSkills() });
		const firstTask = calls.filter((call) => call.index < calls.findIndex((c, i) => i > 0 && c.userPromptStart));
		expect(prefixBreaks(firstTask)).toEqual([]);
		// Known break, reported in spec 051 (not fixed here): the grok-harness active-skill set is re-selected
		// for every user prompt and rendered into the system prompt, so a second prompt whose selection
		// differs changes the system prompt bytes. When that is fixed, this expectation becomes `[]`.
		const second = calls.find((call, i) => i > 0 && call.userPromptStart);
		expect(second).toBeDefined();
		expect(prefixBreaks(calls)).toContain(`call ${second?.index}: system prompt hash changed`);
		expect(prefixBreaks(calls).every((line) => line.endsWith("system prompt hash changed"))).toBe(true);
	});
});
