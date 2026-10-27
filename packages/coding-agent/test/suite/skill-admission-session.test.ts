/**
 * Spec 106 A1 in-process: AgentSession's single skill admission decision (flag `OMK_SKILL_ADMISSION`).
 * SK1 cap with refusal notices, SK5 resume + compaction + model switch keep the count, flag off writes nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SKILL_ADMISSION_ENTRY_TYPE } from "../../src/core/skill-admission-ledger.ts";
import type { Skill } from "../../src/core/skills.ts";
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

function loaderWith(skills: Skill[]) {
	return { ...createTestResourceLoader(), getSkills: () => ({ skills, diagnostics: [] }) };
}

async function harnessWithSkills(count: number, extra: Parameters<typeof createHarness>[0] = {}) {
	const probe = await createHarness();
	const skills = writeSkills(probe.tempDir, count);
	const harness = await createHarness({
		...extra,
		resourceLoader: loaderWith(skills),
	});
	harnesses.push(probe, harness);
	return { harness, skills };
}

function admissionEntries(sm: SessionManager) {
	return sm.getEntries().filter((e) => e.type === "custom" && e.customType === SKILL_ADMISSION_ENTRY_TYPE);
}

describe("spec 106 A1 session skill admission", () => {
	it("flag off: explicit skills expand as before and no admission entries are written", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const { harness } = await harnessWithSkills(12);
		for (let i = 0; i < 12; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		expect(admissionEntries(harness.sessionManager)).toHaveLength(0);
		expect(getUserTexts(harness).filter((t) => t.startsWith("<skill name="))).toHaveLength(12);
	});

	it("SK1: across explicit, steer and followUp paths at most 10 unique bodies are delivered, refusals are explicit", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness } = await harnessWithSkills(14);
		for (let i = 0; i < 6; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		// re-invoking an admitted body takes no new slot
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:skill-0 again");
		for (let i = 6; i < 14; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		expect(harness.session.admitSkillBody("other", "body", "followUp")).toMatch(/cap 10/);
		const entries = admissionEntries(harness.sessionManager);
		expect(entries).toHaveLength(10);
		const texts = getUserTexts(harness);
		expect(texts.filter((t) => t.startsWith("<skill name="))).toHaveLength(11);
		const notices = texts.filter((t) => t.startsWith("[skill admission]"));
		expect(notices).toHaveLength(4);
		expect(notices[0]).toContain('"skill-10" was not loaded: session skill cap 10 reached');
	});

	it("SK5: resume, compaction and model switch keep the admitted count (no reset to 0)", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		const { harness, skills } = await harnessWithSkills(11, { persistSession: true });
		for (let i = 0; i < 10; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		const sm = harness.sessionManager;
		const kept = sm.getEntries().at(-1);
		sm.appendCompaction("summary", kept?.id ?? "", 1000);
		const second = harness.models[1] ?? harness.getModel();
		await harness.session.setModel(second);
		expect(harness.session.admitSkillBody("skill-10", "new body", "explicit")).toMatch(/cap 10/);

		const file = sm.getSessionFile();
		expect(file).toBeTruthy();
		const resumed = await createHarness({
			sessionManager: SessionManager.open(file as string, undefined, undefined, sm.getOwnerLease()),
			resourceLoader: loaderWith(skills),
		});
		harnesses.push(resumed);
		expect(admissionEntries(resumed.sessionManager)).toHaveLength(10);
		expect(resumed.session.admitSkillBody("skill-10", "new body", "steer")).toMatch(/cap 10/);
		resumed.setResponses([fauxAssistantMessage("ok")]);
		await resumed.session.prompt("/skill:skill-10 go");
		expect(getUserTexts(resumed).at(-1)).toContain('"skill-10" was not loaded');
	});

	it("SK7: a session without ledger records but more than 10 delivered bodies refuses new admissions", async () => {
		vi.stubEnv("OMK_SKILL_ADMISSION", "0");
		const { harness } = await harnessWithSkills(12);
		for (let i = 0; i < 11; i++) {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt(`/skill:skill-${i} go`);
		}
		vi.stubEnv("OMK_SKILL_ADMISSION", "1");
		expect(harness.session.admitSkillBody("skill-11", "x", "explicit")).toMatch(/legacy/);
	});

	it("fail closed: an unknown schemaVersion or policyRevision record refuses every new skill (no restart from 0)", async () => {
		for (const bad of [{ schemaVersion: 2 }, { policyRevision: "106-a1-r999" }]) {
			const { harness } = await harnessWithSkills(2);
			vi.stubEnv("OMK_SKILL_ADMISSION", "1");
			harness.sessionManager.appendCustomEntry("skill_admission", {
				schemaVersion: 1,
				policyRevision: "106-a1-r1",
				skillId: "old",
				digest: "x",
				source: "explicit",
				status: "admitted",
				requestId: "sa-1-x",
				...bad,
			});
			expect(harness.session.admitSkillBody("skill-0", "fresh body", "explicit")).toMatch(/fail closed/);
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("/skill:skill-1 go");
			expect(getUserTexts(harness).at(-1)).toContain('"skill-1" was not loaded');
		}
	});
});
