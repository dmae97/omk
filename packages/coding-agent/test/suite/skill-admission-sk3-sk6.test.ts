/**
 * Spec 106 A1 follow-up (flag `OMK_SKILL_ADMISSION`): SK3 the model reading a SKILL.md with `read` and
 * SK6 skill bodies handed to worker lanes go through the same admission decision as explicit/steer/followUp.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKILL_ADMISSION_ENTRY_TYPE } from "../../src/core/skill-admission-ledger.ts";
import { admitWorkerSkills } from "../../src/core/skill-admission-session.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createReadTool } from "../../src/core/tools/read.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	vi.unstubAllEnvs();
});

function writeSkills(root: string, count: number): Skill[] {
	return Array.from({ length: count }, (_, i) => {
		const name = `skill-${i}`;
		const dir = join(root, "skills", name);
		mkdirSync(dir, { recursive: true });
		const filePath = join(dir, "SKILL.md");
		writeFileSync(filePath, `---\nname: ${name}\ndescription: helper ${i}\n---\nbody of ${name}\n`);
		return {
			name,
			description: `helper ${i}`,
			filePath,
			baseDir: dir,
			sourceInfo: { path: filePath, source: "test", scope: "user", origin: "top-level" },
			disableModelInvocation: false,
		};
	});
}

async function setup(count: number) {
	const probe = await createHarness();
	harnesses.push(probe);
	const skills = writeSkills(probe.tempDir, count);
	const harness = await createHarness({
		resourceLoader: { ...createTestResourceLoader(), getSkills: () => ({ skills, diagnostics: [] }) },
		tools: [createReadTool(probe.tempDir)],
	});
	harnesses.push(harness);
	return { harness, skills };
}

async function modelReads(harness: Harness, path: string): Promise<string> {
	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path })], { stopReason: "toolUse" }),
		fauxAssistantMessage("ok"),
	]);
	await harness.session.prompt("read it");
	const results = harness.session.messages.filter((m) => m.role === "toolResult");
	const last = results.at(-1);
	if (!last || last.role !== "toolResult") throw new Error("no tool result");
	return last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function ledger(harness: Harness) {
	return harness.sessionManager
		.getEntries()
		.filter((e) => e.type === "custom" && e.customType === SKILL_ADMISSION_ENTRY_TYPE)
		.map((e) => (e.type === "custom" ? (e.data as { skillId: string; source: string }) : undefined));
}

describe("spec 106 SK3: model read of SKILL.md", () => {
	it("flag off: SKILL.md reads return the file unchanged and write no ledger entries", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const { harness, skills } = await setup(12);
		for (const skill of skills) expect(await modelReads(harness, skill.filePath)).toContain(`body of ${skill.name}`);
		expect(ledger(harness)).toHaveLength(0);
	});

	it("SK3 cross-path: explicit, steer and read share one cap of 10; same body on another path takes no slot", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness, skills } = await setup(13);
		for (let i = 0; i < 5; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		// reading a body already admitted explicitly reuses its slot (same digest), relative path included
		expect(await modelReads(harness, "skills/skill-0/SKILL.md")).toContain("body of skill-0");
		expect(harness.session.admitSkillBody("steer-only", "steer body", "steer")).toBe(true);
		for (let i = 5; i < 9; i++) expect(await modelReads(harness, skills[i].filePath)).toContain(`body of skill-${i}`);
		expect(ledger(harness)).toHaveLength(10);

		const refused = await modelReads(harness, skills[9].filePath);
		expect(refused).toBe('[skill admission] "skill-9" was not loaded: session skill cap 10 reached.');
		// a refused read is not a slot; the explicit path for the same skill is refused too
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:skill-9 go");
		expect(getUserTexts(harness).at(-1)).toContain('"skill-9" was not loaded: session skill cap 10 reached');
		// re-reading an admitted body still works at the cap
		expect(await modelReads(harness, skills[6].filePath)).toContain("body of skill-6");
		const sources = ledger(harness).map((r) => r?.source);
		expect(sources.filter((s) => s === "read")).toHaveLength(4);
		expect(sources.filter((s) => s === "explicit")).toHaveLength(5);
		expect(ledger(harness)).toHaveLength(10);
	});

	it("non-SKILL.md reads are never gated, even at the cap", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness, skills } = await setup(1);
		for (let i = 0; i < 10; i++) harness.session.admitSkillBody(`s${i}`, `b${i}`, "explicit");
		const other = join(skills[0].baseDir, "notes.md");
		writeFileSync(other, "plain notes");
		expect(await modelReads(harness, other)).toContain("plain notes");
		expect(await modelReads(harness, skills[0].filePath)).toContain("session skill cap 10 reached");
	});

	it("unknown ledger version: a SKILL.md read fails closed", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness, skills } = await setup(1);
		harness.sessionManager.appendCustomEntry(SKILL_ADMISSION_ENTRY_TYPE, { schemaVersion: 2 });
		expect(await modelReads(harness, skills[0].filePath)).toContain("unknown version (fail closed)");
	});
});

describe("spec 106 SK6: worker skill hand-off", () => {
	it("flag off: no decision, no ledger write (caller keeps its legacy args)", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const { harness, skills } = await setup(3);
		expect(admitWorkerSkills(harness.sessionManager, skills)).toBeUndefined();
		expect(ledger(harness)).toHaveLength(0);
	});

	it("worker grants take parent slots; the worker gets only admitted skills and notices for the rest", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness, skills } = await setup(12);
		for (let i = 0; i < 8; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		// skill-0 already admitted (reuse), skill-8 and skill-9 fill the cap, skill-10/11 refused
		const grant = [skills[0], skills[8], skills[9], skills[10], skills[11]];
		const handoff = admitWorkerSkills(harness.sessionManager, grant);
		expect(handoff?.args).toEqual([
			"--no-skills",
			"--skill",
			skills[0].filePath,
			"--skill",
			skills[8].filePath,
			"--skill",
			skills[9].filePath,
		]);
		expect(handoff?.notices).toEqual([
			'[skill admission] "skill-10" was not loaded: session skill cap 10 reached.',
			'[skill admission] "skill-11" was not loaded: session skill cap 10 reached.',
		]);
		expect(ledger(harness).filter((r) => r?.source === "worker")).toHaveLength(2);
		// the parent's own paths now see the cap the workers consumed
		expect(await modelReads(harness, skills[10].filePath)).toContain("session skill cap 10 reached");
		// a second worker with the same grant re-uses slots: no growth past 10
		expect(admitWorkerSkills(harness.sessionManager, grant)?.notices).toHaveLength(2);
		expect(ledger(harness)).toHaveLength(10);
	});

	it("worker with no granted skills gets --no-skills only (cannot self-load unadmitted bodies)", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness } = await setup(0);
		expect(admitWorkerSkills(harness.sessionManager, [])).toEqual({ args: ["--no-skills"], notices: [] });
	});
});
