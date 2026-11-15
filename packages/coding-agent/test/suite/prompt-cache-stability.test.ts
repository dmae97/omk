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

function secondPromptCall(calls: readonly CapturedCall[]): CapturedCall {
	const second = calls.find((call, i) => i > 0 && call.userPromptStart);
	if (!second) throw new Error("no second user prompt captured");
	return second;
}

/** Spec 050 R6 `<prompt_skills>` messages sent with a call. */
function promptSkillMessages(call: CapturedCall): string[] {
	return call.userTexts.filter((text) => text.startsWith("<prompt_skills>"));
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
	/**
	 * #120 follow-up: drive finish-check from its own local clock (`now`, no `readBudget`), and move
	 * that fake clock forward with every reply, so wall time really passes between turns.
	 */
	readonly fakeClock?: boolean;
	/** Text of the second user prompt (default `TASK_B`). */
	readonly secondPrompt?: string;
}

async function runSession(
	env: Record<string, string>,
	harnesses: Harness[],
	options: SessionOptions = {},
): Promise<CapturedCall[]> {
	let fraction = 0.05;
	let clockMs = 0;
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
		(omk) =>
			finishCheck(omk, options.fakeClock ? { env, now: () => clockMs } : { env, now: () => 0, readBudget: budget }),
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
		clockMs = next * 900_000;
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
	await harness.session.prompt(options.secondPrompt ?? TASK_B);
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

	// Spec 050 R6 (AC 9): the contextBudget skill ranking of the first user prompt is frozen into the system
	// prompt; task B's ranking goes into a `<prompt_skills>` message after its user message.
	it("keeps the prefix with contextBudget on (spec 050 R6)", async () => {
		const calls = await runSession(FLAGS_ON, harnesses, {
			skills: bundledSkills(),
			settings: { contextBudget: { enabled: true } } as HarnessOptions["settings"],
			// TASK_B shares no word with any bundled skill; it used to rank only through suffix-only fuzzy
			// matches (write~site). One real name-token hit (0.60) ranks a skill without crossing the 0.7
			// auto-load band, so the contextBudget message stays the only `<prompt_skills>` message.
			secondPrompt: "Now write the review summary to b.txt.",
		});
		expect(prefixBreaks(calls)).toEqual([]);
		const second = secondPromptCall(calls);
		expect(promptSkillMessages(second)).toHaveLength(1);
		expect(promptSkillMessages(calls[0])).toEqual([]);
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

	// #120 follow-up: finish-check reads the clock only for its steers; the system prompt carries the
	// total budget (`budgetMs`) and is added once in before_agent_start, so a moving clock never reaches it.
	it("keeps the full system prompt hash identical on every call while a fake clock advances", async () => {
		const calls = await runSession(FLAGS_ON, harnesses, { fakeClock: true });
		expect(calls.filter((call) => call.userPromptStart).length).toBeGreaterThanOrEqual(1);
		expect(new Set(calls.map((call) => call.system)).size).toBe(1);
		const seen = calls.at(-1)?.userTexts.join("\n") ?? "";
		expect(seen).toContain(TASK_B);
		// The save-now steer at 75% fires only if finish-check really read the advancing clock.
		expect(seen).toContain(FINISH_CHECK_SAVE_NOW_MESSAGE);
	});

	// Spec 050 R6 (AC 10): the harness pick of the first user prompt stays in the system prompt for the whole
	// session; a second prompt that picks other skills gets them in a `<prompt_skills>` message instead.
	it.each([
		["xai, flags on", "xai", FLAGS_ON],
		["xai, flags off", "xai", FLAGS_OFF],
		["devin, flags on", "devin", FLAGS_ON],
	])("native harness skills: system stable across user prompts, %s", async (_label, provider, env) => {
		// Task A picks `debugging`, this second prompt picks `programming`.
		const secondPrompt = "Refactor the parser code and write it to b.txt.";
		const calls = await runSession(env, harnesses, { provider, skills: harnessSkills(), secondPrompt });
		expect(prefixBreaks(calls)).toEqual([]);
		expect(calls[0].system).toBe(calls.at(-1)?.system);
		const message = promptSkillMessages(secondPromptCall(calls));
		expect(message).toHaveLength(1);
		expect(message[0]).toContain(`<active_skills source="${provider === "xai" ? "grok-harness" : "devin-harness"}">`);
		expect(message[0]).toContain("<name>programming</name>");
		expect(message[0]).not.toContain("<name>debugging</name>");
		expect(promptSkillMessages(calls[0])).toEqual([]);
	});

	it("moves an explicit `!skill` of the second user prompt into the message (spec 050 R6, AC 10)", async () => {
		const calls = await runSession(FLAGS_OFF, harnesses, {
			skills: harnessSkills(),
			secondPrompt: `!skill:debugging ${TASK_B}`,
		});
		expect(prefixBreaks(calls)).toEqual([]);
		const message = promptSkillMessages(secondPromptCall(calls));
		expect(message).toHaveLength(1);
		expect(message[0]).toContain("<name>debugging</name>");
	});
});
