import type { ThinkingLevel } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	classifyTask,
	type ReasoningLaneType,
	resolveThinkingLevel,
	TASK_CLASS_THINKING_LEVELS,
	type TaskClass,
	type TaskClassifierInput,
} from "../../../src/core/reasoning-router.ts";
import { createHarness, type Harness } from "../harness.ts";

/** Prompt that classifies as "plan" (keywords: plan/architecture/roadmap). */
const PLAN_PROMPT = "plan the architecture roadmap for the storage layer";
/** Prompt that classifies as "trivial" (short, no signals). */
const TRIVIAL_PROMPT = "hi there";

const FULL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const NO_XHIGH_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];
const MINIMAL_ONLY_SET: readonly ThinkingLevel[] = ["minimal", "low"];
/** Shape reported by session.getAvailableThinkingLevels() for a reasoning faux model (includes "off"). */
const SESSION_SHAPED_SET: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const ALL_TASK_CLASSES = Object.keys(TASK_CLASS_THINKING_LEVELS) as TaskClass[];
const LANE_VARIANTS: ReadonlyArray<ReasoningLaneType | undefined> = [
	undefined,
	"planner",
	"security",
	"explorer",
	"coder",
	"reviewer",
	"tester",
];

describe("goal 003: reasoning-effort router", () => {
	describe("classifyTask determinism (Req 3.1)", () => {
		const table: Array<{ name: string; input: TaskClassifierInput; expected: TaskClass }> = [
			{ name: "trivial short prompt", input: { prompt: TRIVIAL_PROMPT }, expected: "trivial" },
			{ name: "empty prompt", input: { prompt: "" }, expected: "trivial" },
			{
				name: "simple-edit keyword",
				input: { prompt: "there is a typo in the README heading" },
				expected: "simple-edit",
			},
			{
				name: "code-gen via fenced block (no keywords)",
				input: { prompt: "```\nconst total = price * quantity;\n```" },
				expected: "code-gen",
			},
			{ name: "debug keyword", input: { prompt: "debug the login timeout" }, expected: "debug" },
			{ name: "refactor keyword", input: { prompt: "refactor the session manager module" }, expected: "refactor" },
			{ name: "review keyword", input: { prompt: "review the open pull request thoroughly" }, expected: "review" },
			{ name: "plan keyword", input: { prompt: "plan the migration milestones for storage" }, expected: "plan" },
			{
				name: "diff hunk header",
				input: { prompt: "@@ -1,3 +1,3 @@\n-const a = 1\n+const a = 2" },
				expected: "code-gen",
			},
			{ name: "diff +/- line starts", input: { prompt: "-old value\n+new value" }, expected: "code-gen" },
			{
				name: "markdown bullets are not a diff",
				input: { prompt: "- alpha\n- beta\n- gamma" },
				expected: "trivial",
			},
			{
				name: "long prose brief (>=2400 chars)",
				input: { prompt: "lorem ipsum dolor sit amet ".repeat(100) },
				expected: "plan",
			},
		];

		it.each(table)("classifies $name as $expected, stable across 3 repeated calls", ({ input, expected }) => {
			for (let run = 0; run < 3; run++) {
				// Fresh input object per call: no hidden state may influence the result.
				expect(classifyTask({ ...input })).toBe(expected);
			}
		});

		it("resolves overlapping keyword families by fixed precedence", () => {
			// debug > refactor (the required both-keywords case)
			expect(classifyTask({ prompt: "debug the crash then refactor the parser" })).toBe("debug");
			// debug > simple-edit
			expect(classifyTask({ prompt: "fix a typo" })).toBe("debug");
			// refactor > review
			expect(classifyTask({ prompt: "refactor the module after the code review" })).toBe("refactor");
			// review > plan
			expect(classifyTask({ prompt: "review the migration plan" })).toBe("review");
			// plan > simple-edit
			expect(classifyTask({ prompt: "plan the typo sweep across docs" })).toBe("plan");
			// simple-edit > code-gen
			expect(classifyTask({ prompt: "tweak the indentation before we add the builder" })).toBe("simple-edit");
		});

		it("uses the lane fallback only when no other signal decides", () => {
			const noSignalPrompt = "the quarterly report numbers look better than the previous cycle overall";
			expect(classifyTask({ prompt: noSignalPrompt })).toBe("code-gen");
			expect(classifyTask({ prompt: noSignalPrompt, laneType: "planner" })).toBe("plan");
			expect(classifyTask({ prompt: noSignalPrompt, laneType: "explorer" })).toBe("review");
			// A keyword signal beats the lane fallback.
			expect(classifyTask({ prompt: "debug the login timeout", laneType: "planner" })).toBe("debug");
		});
	});

	describe("resolveThinkingLevel clamp-to-capability (Req 3.2)", () => {
		it("maps the static rule table exactly", () => {
			expect(TASK_CLASS_THINKING_LEVELS).toEqual({
				trivial: "minimal",
				"simple-edit": "low",
				"code-gen": "medium",
				debug: "high",
				refactor: "high",
				review: "high",
				plan: "xhigh",
			});
			for (const taskClass of ALL_TASK_CLASSES) {
				expect(resolveThinkingLevel(taskClass, FULL_SET)).toBe(TASK_CLASS_THINKING_LEVELS[taskClass]);
			}
		});

		it("clamps plan to high on a no-xhigh model and keeps xhigh on a full model", () => {
			expect(resolveThinkingLevel("plan", FULL_SET)).toBe("xhigh");
			expect(resolveThinkingLevel("plan", NO_XHIGH_SET)).toBe("high");
			expect(resolveThinkingLevel("trivial", MINIMAL_ONLY_SET)).toBe("minimal");
			// Highest class on the narrowest reasoning set clamps to the set ceiling.
			expect(resolveThinkingLevel("plan", MINIMAL_ONLY_SET)).toBe("low");
		});

		it("always returns a member of availableLevels (never invents levels, never returns off)", () => {
			const sets = [FULL_SET, NO_XHIGH_SET, MINIMAL_ONLY_SET, SESSION_SHAPED_SET];
			for (const set of sets) {
				for (const taskClass of ALL_TASK_CLASSES) {
					for (const lane of LANE_VARIANTS) {
						const result = resolveThinkingLevel(taskClass, set, lane);
						expect(set).toContain(result);
						expect(result).not.toBe("off");
					}
				}
			}
		});
	});

	describe("resolveThinkingLevel lane adjustment (Req 3.2/spec Req 1.4)", () => {
		it("planner and security escalate one step within the clamped range", () => {
			expect(resolveThinkingLevel("code-gen", FULL_SET, "planner")).toBe("high"); // medium -> high
			expect(resolveThinkingLevel("review", FULL_SET, "security")).toBe("xhigh"); // high -> xhigh
			expect(resolveThinkingLevel("plan", FULL_SET, "planner")).toBe("max"); // xhigh -> max
			// Escalation is clamped to capability: plan+planner targets max, clamps to high.
			expect(resolveThinkingLevel("plan", NO_XHIGH_SET, "planner")).toBe("high");
		});

		it("explorer de-escalates one step, saturating at the ladder floor", () => {
			expect(resolveThinkingLevel("code-gen", FULL_SET, "explorer")).toBe("low"); // medium -> low
			expect(resolveThinkingLevel("review", FULL_SET, "explorer")).toBe("medium"); // high -> medium
			expect(resolveThinkingLevel("trivial", FULL_SET, "explorer")).toBe("minimal"); // floor saturation
			expect(resolveThinkingLevel("trivial", MINIMAL_ONLY_SET, "explorer")).toBe("minimal");
		});

		it("non-adjusting lanes resolve like no lane", () => {
			for (const lane of ["coder", "reviewer", "tester"] as const) {
				expect(resolveThinkingLevel("code-gen", FULL_SET, lane)).toBe("medium");
			}
		});
	});

	describe("session-level override precedence (Req 3.3)", () => {
		const harnesses: Harness[] = [];

		afterEach(() => {
			while (harnesses.length > 0) {
				harnesses.pop()?.cleanup();
			}
		});

		async function createReasoningHarness(): Promise<Harness> {
			const harness = await createHarness({ models: [{ id: "faux-think", reasoning: true }] });
			harnesses.push(harness);
			return harness;
		}

		it("manual mode is the default and a manual level survives a router-worthy prompt", async () => {
			const harness = await createReasoningHarness();
			expect(harness.session.thinkingMode).toBe("manual");
			// Reasoning faux models expose off..high; xhigh/max need an explicit thinkingLevelMap.
			expect(harness.session.getAvailableThinkingLevels()).toEqual(["off", "minimal", "low", "medium", "high"]);

			// Mirrors /think low: applyThinkingLevel -> setThinkingMode("manual") + setThinkingLevel("low").
			harness.session.setThinkingMode("manual");
			harness.session.setThinkingLevel("low");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(PLAN_PROMPT);

			// Router never ran: a plan-class prompt would have routed to high in auto mode.
			expect(harness.session.thinkingLevel).toBe("low");
			expect(harness.session.thinkingMode).toBe("manual");
		});

		it("auto mode routes per turn, clamps to capability, and never overwrites the settings default", async () => {
			const harness = await createReasoningHarness();
			harness.session.setThinkingLevel("medium"); // manual pick persists default=medium
			expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("medium");

			// Mirrors /think auto: enableAutoThinkingMode -> setThinkingMode("auto").
			harness.session.setThinkingMode("auto");
			expect(harness.session.thinkingMode).toBe("auto");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(PLAN_PROMPT);
			// Spec Req 3.2 example end-to-end: plan targets xhigh, but the faux reasoning
			// model is a no-xhigh model, so the routed level clamps to high.
			expect(harness.session.thinkingLevel).toBe("high");
			expect(harness.eventsOfType("thinking_level_changed").some((event) => event.level === "high")).toBe(true);

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(TRIVIAL_PROMPT);
			expect(harness.session.thinkingLevel).toBe("minimal"); // trivial -> minimal

			// Auto-resolved turns must not touch the persisted default (Req 2.3).
			expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("medium");
		});

		it("a concrete manual level flips auto back to manual and beats the router", async () => {
			const harness = await createReasoningHarness();
			harness.session.setThinkingMode("auto");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(PLAN_PROMPT);
			expect(harness.session.thinkingLevel).toBe("high"); // routed (clamped from xhigh)

			// Mirrors /think low while in auto mode.
			harness.session.setThinkingMode("manual");
			harness.session.setThinkingLevel("low");
			expect(harness.session.thinkingMode).toBe("manual");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(PLAN_PROMPT);
			expect(harness.session.thinkingLevel).toBe("low"); // router no longer consulted
		});

		it("models without reasoning bypass the router entirely (level stays off)", async () => {
			const harness = await createHarness({ models: [{ id: "faux-plain", reasoning: false }] });
			harnesses.push(harness);

			harness.session.setThinkingMode("auto");
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("debug the crash in the parser");

			expect(harness.session.thinkingLevel).toBe("off");
		});
	});
});
