/**
 * Spec 117 (Tech Lead follow-up): with auto-load not active, the observe-only path (selector, body reads, run log)
 * swallows every error, so a selector failure never changes or breaks a flag-off prompt.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptSkillFreeze } from "../../src/core/prompt-skill-message.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { autoLoadSkills } from "../../src/core/skill-auto-load.ts";
import type { Skill } from "../../src/core/skills.ts";
import type { BuildSystemPromptOptions } from "../../src/core/system-prompt.ts";

const selector = vi.hoisted(() => ({ throws: false }));
vi.mock("../../src/core/skill-selector.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/core/skill-selector.ts")>();
	return {
		...actual,
		selectSkills: (...args: Parameters<typeof actual.selectSkills>) => {
			if (selector.throws) throw new Error("selector boom");
			return actual.selectSkills(...args);
		},
	};
});

const dirs: string[] = [];
afterEach(() => {
	selector.throws = false;
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function fixture(): { skills: Skill[]; log: string } {
	const root = mkdtempSync(join(tmpdir(), "omk-117g-"));
	dirs.push(root);
	const dir = join(root, "skills", "pdf-extract");
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, "SKILL.md");
	writeFileSync(filePath, "---\nname: pdf-extract\ndescription: extract text from pdf invoice files\n---\nPDF-BODY\n");
	const skill: Skill = {
		name: "pdf-extract",
		description: "extract text from pdf invoice files",
		filePath,
		baseDir: dir,
		sourceInfo: { path: filePath, source: "test", scope: "user", origin: "top-level" },
		disableModelInvocation: false,
	};
	const log = join(root, "log");
	mkdirSync(log);
	return { skills: [skill], log };
}

const store = () => ({
	entries: [] as SessionEntry[],
	getEntries(): readonly SessionEntry[] {
		return this.entries;
	},
	appendCustomEntry(): unknown {
		throw new Error("flag off must never admit");
	},
});

describe("spec 117 observe-only guard", () => {
	it("selector throws with the flag off: no error, undefined, prompt unchanged", async () => {
		const { skills, log } = fixture();
		const env = { OMK_RUN_LOG_DIR: log, OMK_SKILL_AUTO_LOAD: "0" };
		selector.throws = true;
		expect(() =>
			autoLoadSkills({ store: store(), skills, query: "extract text from the pdf invoice files", env }),
		).not.toThrow();
		expect(autoLoadSkills({ store: store(), skills, query: "extract text from the pdf invoice files", env })).toBe(
			undefined,
		);
		const input = {
			base: {} as BuildSystemPromptOptions,
			provider: undefined,
			selection: { names: [], source: undefined },
			defaults: [],
			skills,
			harnessQuery: "extract text from the pdf invoice files",
			budgetQuery: "extract text from the pdf invoice files",
			contextPressure: () => false,
			contextBudget: () => undefined,
			env,
			now: () => 1,
		};
		const absent = await new PromptSkillFreeze().turn(input);
		const guarded = await new PromptSkillFreeze(store).turn(input);
		expect(guarded).toEqual(absent);
	});

	it("unreadable skill body with the flag off: no error", () => {
		const { skills, log } = fixture();
		rmSync(skills[0]?.filePath as string);
		expect(
			autoLoadSkills({
				store: store(),
				skills,
				query: "extract text from the pdf invoice files",
				env: { OMK_RUN_LOG_DIR: log },
			}),
		).toBe(undefined);
	});
});
