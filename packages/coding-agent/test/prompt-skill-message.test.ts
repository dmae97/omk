import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActiveSkillState } from "../src/core/active-skill-state.ts";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import {
	explicitSkillNames,
	PROMPT_SKILLS_CUSTOM_TYPE,
	PROMPT_SKILLS_RELEVANT_LIMIT,
	PromptSkillFreeze,
	type PromptSkillTurnInput,
	shortHash,
} from "../src/core/prompt-skill-message.ts";
import type { Skill } from "../src/core/skills.ts";
import type { BuildSystemPromptOptions } from "../src/core/system-prompt.ts";

function skill(name: string, description: string, disableModelInvocation = false): Skill {
	return {
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "user", origin: "top-level" },
		disableModelInvocation,
	};
}

const SKILLS = [
	skill("programming", "Write, change and refactor code and files in any programming language."),
	skill("debugging", "Find and fix bugs: failing checks, wrong results, errors, verify each requirement."),
	skill("headroom", "Keep the context window small under context pressure."),
];

const BUDGET = { tokenizerMode: "fallback" } as unknown as NonNullable<BuildSystemPromptOptions["contextBudget"]>;

const BASE: BuildSystemPromptOptions = { cwd: "/w", skills: SKILLS };

function input(overrides: Partial<PromptSkillTurnInput> & { query?: string } = {}): PromptSkillTurnInput {
	const query = overrides.query ?? "Fix the failing parser bug in parse.py";
	return {
		base: BASE,
		provider: "faux",
		selection: createActiveSkillState([], [], undefined),
		defaults: [],
		skills: SKILLS,
		harnessQuery: query,
		budgetQuery: query,
		contextPressure: () => false,
		contextBudget: () => undefined,
		env: {},
		now: () => 1,
		...overrides,
	};
}

describe("PromptSkillFreeze (spec 050 R6)", () => {
	const dirs: string[] = [];
	afterEach(() => {
		while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	});

	it("puts the first prompt's choice into the system options exactly as before and sends no message", async () => {
		const queries: string[] = [];
		const turn = await new PromptSkillFreeze().turn(
			input({
				provider: "xai",
				selection: createActiveSkillState(["programming"], [], undefined),
				defaults: ["programming"],
				contextBudget: (query) => {
					queries.push(query);
					return BUDGET;
				},
			}),
		);
		expect(turn.messages).toEqual([]);
		expect(turn.options.activeSkillNames).toEqual(["programming", "debugging"]);
		expect(turn.options.activeSkillSource).toBe("settings+grok-harness");
		expect(turn.options.contextBudget).toBe(BUDGET);
		expect(queries).toEqual(["Fix the failing parser bug in parse.py"]);
	});

	it("freezes the system options and moves a different later choice into one message", async () => {
		const freeze = new PromptSkillFreeze();
		const first = await freeze.turn(input({ provider: "xai" }));
		const queries: string[] = [];
		const second = await freeze.turn(
			input({
				provider: "xai",
				query: "Write the summary file in python code",
				contextBudget: (query) => {
					queries.push(query);
					return undefined;
				},
			}),
		);
		expect(second.options).toEqual(first.options);
		expect(queries).toEqual(["Fix the failing parser bug in parse.py"]);
		expect(second.messages[0]?.customType).toBe(PROMPT_SKILLS_CUSTOM_TYPE);
		expect(second.messages[0]?.display).toBe(false);
		expect(second.messages[0]?.content).toBe(
			[
				"<prompt_skills>",
				"Skills for this prompt. Only the most recent <prompt_skills> applies; earlier ones are superseded. They take precedence over the <active_skills> and <available_skills> choices in the system prompt, which were made for the first prompt of this session. Apply only when relevant and read full instructions before use.",
				'<active_skills source="grok-harness">',
				"  <name>programming</name>",
				"</active_skills>",
				"</prompt_skills>",
			].join("\n"),
		);
	});

	it("freezes again, without a message, after the session rebuilt its base options", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input({ provider: "xai" }));
		const rebuilt = { ...BASE };
		const turn = await freeze.turn(
			input({ provider: "xai", base: rebuilt, query: "Write the summary file in python code" }),
		);
		expect(turn.messages).toEqual([]);
		expect(turn.options.activeSkillNames).toEqual(["programming"]);
		const next = await freeze.turn(input({ provider: "xai", base: rebuilt }));
		expect(next.options.activeSkillNames).toEqual(["programming"]);
		expect(String(next.messages[0]?.content)).toContain("<name>debugging</name>");
	});

	it("freezes again when the operator's default active skills change", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(
			input({ selection: createActiveSkillState(["programming"], [], undefined), defaults: ["programming"] }),
		);
		const turn = await freeze.turn(input());
		expect(turn.messages).toEqual([]);
		expect(turn.options.activeSkillNames).toEqual([]);
	});

	it("sends no message when a later prompt makes the same choice", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input({ provider: "xai" }));
		expect((await freeze.turn(input({ provider: "xai", query: "Fix another failing bug" }))).messages).toEqual([]);
	});

	it("says so when a later prompt has no active skills", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input({ selection: createActiveSkillState([], ["debugging"], "bang") }));
		const content = String((await freeze.turn(input())).messages[0]?.content);
		expect(content).toContain(
			'<active_skills source="prompt">\nNo skills are active for this prompt.\n</active_skills>',
		);
		const harness = new PromptSkillFreeze();
		await harness.turn(input({ provider: "xai" }));
		const none = String(
			(await harness.turn(input({ provider: "xai", query: "Now write the summary to b.txt." }))).messages[0]
				?.content,
		);
		expect(none).toContain('<active_skills source="grok-harness">\nNo skills are active for this prompt.');
	});

	it("moves an explicit `!skill` of a later prompt into the message", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input());
		const turn = await freeze.turn(input({ selection: createActiveSkillState([], ["headroom"], "bang") }));
		expect(turn.options.activeSkillNames).toEqual([]);
		expect(String(turn.messages[0]?.content)).toContain('<active_skills source="bang">\n  <name>headroom</name>');
	});

	it("lists the most relevant model-invocable skills when contextBudget renders skills", async () => {
		const many = [
			...Array.from({ length: 8 }, (_, i) => skill(`parser-${i}`, "parser tools for parse.py bugs")),
			skill("parser-hidden", "parser parse.py bugs", true),
		];
		const freeze = new PromptSkillFreeze();
		const budgeted = { base: { cwd: "/w", skills: many, contextBudget: BUDGET }, skills: many };
		await freeze.turn(input({ ...budgeted, contextBudget: () => BUDGET }));
		const content = String(
			(await freeze.turn(input({ ...budgeted, contextBudget: () => BUDGET }))).messages[0]?.content,
		);
		expect(content.match(/<skill>/g)).toHaveLength(PROMPT_SKILLS_RELEVANT_LIMIT);
		expect(content).toContain("<location>/skills/parser-0/SKILL.md</location>");
		expect(content).not.toContain("parser-hidden");
		expect(content).not.toContain("<active_skills source");
		const noRead = { ...budgeted, base: { ...budgeted.base, selectedTools: ["bash"] } };
		const other = new PromptSkillFreeze();
		await other.turn(input(noRead));
		expect((await other.turn(input(noRead))).messages).toEqual([]);
	});

	it("reuses the current selection for automatic follow-ups without adding skill messages", async () => {
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input({ provider: "xai" }));
		const second = await freeze.turn(input({ provider: "xai", query: "Write the summary file in python code" }));
		expect(second.messages).toHaveLength(1);
		const automatic = await freeze.turn(input({ provider: "xai", query: "Finish check" }), true);
		expect(automatic.options).toBe(second.options);
		expect(automatic.messages).toEqual([]);
	});

	it("logs harness-move records with hashes and counts only", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-prompt-skills-"));
		dirs.push(dir);
		const env = { OMK_RUN_LOG_DIR: dir };
		const freeze = new PromptSkillFreeze();
		await freeze.turn(input({ provider: "xai", env }));
		await freeze.turn(input({ provider: "xai", env, query: "Write the summary file in python code" }));
		const text = readFileSync(join(dir, "skill-select.jsonl"), "utf8");
		const records = text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			type: "harness-move",
			source: "grok-harness",
			k: 1,
			skillHashes: [shortHash("programming")],
		});
		expect(text).not.toContain("programming");
		expect(text).not.toContain("/skills/");
	});
});

describe("PromptSkillFreeze skill-search setup (spec 050 R1/R2, #122 review)", () => {
	const ON = { OMK_SKILL_SEARCH: "1" };
	const many = Array.from({ length: 30 }, (_, i) => skill(`s${i}`, `Skill number ${i}.`));
	const sdkTool = (name: string) => ({ name }) as ToolDefinition;
	const dirs: string[] = [];
	afterEach(() => {
		while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	});

	it("does not read the skill list when the flag is off", () => {
		let reads = 0;
		const freeze = new PromptSkillFreeze();
		const skills = () => {
			reads++;
			return many;
		};
		freeze.skillSearch.setup({ skills, hasReadTool: true, env: {} });
		expect(reads).toBe(0);
		expect(freeze.skillSearch.active).toBe(false);
		expect(freeze.skillSearch.withTool([sdkTool("other")], []).map((tool) => tool.name)).toEqual(["other"]);
	});

	it("adds the fixed tool once per build in an active session", () => {
		const freeze = new PromptSkillFreeze();
		freeze.skillSearch.setup({ skills: () => many, hasReadTool: true, env: ON });
		const first = freeze.skillSearch.withTool([sdkTool("other")], ["ext-tool"]);
		const second = freeze.skillSearch.withTool([sdkTool("other")], ["ext-tool"]);
		expect(first.map((tool) => tool.name)).toEqual(["other", "skill_search"]);
		expect(second[1]).toBe(first[1]);
		expect(freeze.skillSearch.active).toBe(true);
	});

	it("skips its tool, warns once and stays off when another tool is named skill_search", () => {
		for (const [sdk, ext] of [
			[[sdkTool("skill_search")], []],
			[[], ["skill_search"]],
		] as const) {
			const warnings: string[] = [];
			const warn = (message: string) => warnings.push(message);
			const freeze = new PromptSkillFreeze();
			freeze.skillSearch.setup({ skills: () => many, hasReadTool: true, env: ON });
			expect(freeze.skillSearch.withTool([...sdk], [...ext], warn).map((tool) => tool.name)).toEqual(
				sdk.map((tool) => tool.name),
			);
			expect(freeze.skillSearch.withTool([...sdk], [...ext], warn)).toHaveLength(sdk.length);
			// The conflict is final for the session, even if the other tool goes away.
			expect(freeze.skillSearch.withTool([], [], warn)).toEqual([]);
			expect(freeze.skillSearch.active).toBe(false);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("skill_search");
		}
	});

	it("still answers the prompt when computing candidates fails", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "omk-prompt-skills-"));
		dirs.push(agentDir);
		let reads = 0;
		const skills = () => {
			reads++;
			if (reads > 1) throw new Error("skill list unavailable");
			return many;
		};
		const freeze = new PromptSkillFreeze();
		freeze.skillSearch.setup({ skills, hasReadTool: true, env: ON, agentDir });
		expect(freeze.skillSearch.active).toBe(true);
		const turn = await freeze.turn(input({ env: ON }));
		expect(turn.messages).toEqual([]);
		expect(reads).toBeGreaterThan(1);
	});

	it("turns off with tool_inactive when the active tools leave skill_search out (058 follow-up)", async () => {
		const freeze = new PromptSkillFreeze();
		freeze.skillSearch.setup({ skills: () => many, hasReadTool: true, env: ON });
		freeze.skillSearch.syncActiveTools(["read", "skill_search"]);
		expect(freeze.skillSearch.active).toBe(true);
		freeze.skillSearch.syncActiveTools(["read", "bash"]);
		expect(freeze.skillSearch.active).toBe(false);
		// Final for the session: no candidate message, and the next registry build no longer adds the tool.
		freeze.skillSearch.syncActiveTools(["read", "skill_search"]);
		expect(freeze.skillSearch.active).toBe(false);
		expect((await freeze.turn(input({ env: ON }))).messages).toEqual([]);
		expect(freeze.skillSearch.withTool([], []).map((tool) => tool.name)).toEqual([]);
		const logDir = mkdtempSync(join(tmpdir(), "omk-prompt-skills-"));
		dirs.push(logDir);
		const logged = new PromptSkillFreeze();
		logged.skillSearch.setup({ skills: () => many, hasReadTool: true, env: { ...ON, OMK_RUN_LOG_DIR: logDir } });
		logged.skillSearch.syncActiveTools(["read"]);
		await logged.skillSearch.logSession({ systemPrompt: "s", tools: [] });
		expect(readFileSync(join(logDir, "skill-select.jsonl"), "utf8")).toContain('"inactiveReason":"tool_inactive"');
	});

	it("never fails on a run-log error: hashing or the prompt-hash import throws, flag on and off", async () => {
		for (const env of [{}, ON]) {
			const logDir = mkdtempSync(join(tmpdir(), "omk-prompt-skills-"));
			dirs.push(logDir);
			const throwing = {
				systemPrompt: "s",
				get tools(): never {
					throw new Error("hash failed");
				},
			};
			const hashFails = new PromptSkillFreeze();
			hashFails.skillSearch.setup({
				skills: () => many,
				hasReadTool: true,
				env: { ...env, OMK_RUN_LOG_DIR: logDir },
			});
			await expect(hashFails.skillSearch.logSession(throwing)).resolves.toBeUndefined();
			vi.doMock("omk-ai/prompt-hash", () => {
				throw new Error("import failed");
			});
			try {
				const importFails = new PromptSkillFreeze();
				importFails.skillSearch.setup({
					skills: () => many,
					hasReadTool: true,
					env: { ...env, OMK_RUN_LOG_DIR: logDir },
				});
				await expect(importFails.skillSearch.logSession({ systemPrompt: "s", tools: [] })).resolves.toBeUndefined();
			} finally {
				vi.doUnmock("omk-ai/prompt-hash");
			}
		}
	});
});

describe("explicit skills for metacon (spec 058 R4)", () => {
	it("passes only !skill and /skill: names, not defaultActiveSkills", () => {
		const selection = createActiveSkillState(["house-style", "programming"], ["pdf-forms", "programming"], "bang");
		expect(explicitSkillNames({ selection, defaults: ["house-style", "programming"] })).toEqual(["pdf-forms"]);
		const defaultsOnly = createActiveSkillState(["house-style"], [], undefined);
		expect(explicitSkillNames({ selection: defaultsOnly, defaults: ["house-style"] })).toEqual([]);
		const bangOnly = createActiveSkillState([], ["pdf-forms"], "bang");
		expect(explicitSkillNames({ selection: bangOnly, defaults: [] })).toEqual(["pdf-forms"]);
	});
});
