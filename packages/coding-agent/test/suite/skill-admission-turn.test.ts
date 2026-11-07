import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { continuationPromptOptions } from "../../src/core/prompt-continuation.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SKILL_ADMISSION_ENTRY_TYPE } from "../../src/core/skill-admission-ledger.ts";
import { restoreSkillAdmissionLedger } from "../../src/core/skill-admission-session.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getUserTexts, type Harness, type HarnessOptions } from "./harness.ts";

const harnesses: Harness[] = [];
beforeEach(() => {
	vi.stubEnv("OMK_SKILL_ADMISSION", "1");
	vi.stubEnv("OMK_SKILL_AUTO_LOAD", "0");
});
afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	vi.unstubAllEnvs();
});

async function setup(count: number, options: HarnessOptions = {}) {
	const skills: Skill[] = [];
	const resourceLoader = { ...createTestResourceLoader(), getSkills: () => ({ skills, diagnostics: [] }) };
	const harness = await createHarness({ ...options, resourceLoader });
	harnesses.push(harness);
	for (let i = 0; i < count; i++) {
		const name = `skill-${i}`;
		const baseDir = join(harness.tempDir, "skills", name);
		mkdirSync(baseDir, { recursive: true });
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(filePath, `---\nname: ${name}\ndescription: helper ${i}\n---\nbody of ${name}\n`);
		skills.push({
			name,
			description: `helper ${i}`,
			baseDir,
			filePath,
			sourceInfo: { path: filePath, source: "test", scope: "user", origin: "top-level" },
			disableModelInvocation: false,
		});
	}
	return { harness, skills, resourceLoader };
}

async function readSkills(
	harness: Harness,
	skills: readonly Skill[],
	prompt = "Read the requested skill files",
	options?: Parameters<Harness["session"]["prompt"]>[1],
) {
	const before = harness.session.messages.length;
	harness.setResponses([
		fauxAssistantMessage(
			skills.map((skill) => fauxToolCall("read", { path: skill.filePath })),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("done"),
	]);
	await harness.session.prompt(prompt, options);
	return harness.session.messages
		.slice(before)
		.filter((message) => message.role === "toolResult")
		.map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
}

describe("skill admission limit is per top-level prompt, not session lifetime", () => {
	it("admits ten bodies per prompt and another ten in the next prompt of the same session", async () => {
		const { harness, skills } = await setup(22);
		for (const selected of [skills.slice(0, 11), skills.slice(11)]) {
			const results = await readSkills(harness, selected);
			expect(results.filter((text) => text.includes("body of skill-"))).toHaveLength(10);
			expect(results.filter((text) => text.includes("prompt skill cap 10 reached"))).toHaveLength(1);
			expect(restoreSkillAdmissionLedger(harness.sessionManager.getEntries()).used).toBe(10);
		}
		expect(
			harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === SKILL_ADMISSION_ENTRY_TYPE),
		).toHaveLength(20);
	});

	it("shares ten slots between explicit skill expansion and reads, then resets before the next expansion", async () => {
		const { harness, skills } = await setup(12);
		const results = await readSkills(harness, skills.slice(1), "/skill:skill-0 use these skills");
		expect(results.filter((text) => text.includes("body of skill-"))).toHaveLength(9);
		expect(results.filter((text) => text.includes("prompt skill cap 10 reached"))).toHaveLength(2);
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("/skill:skill-11 next task");
		expect(getUserTexts(harness).at(-1)).toContain('<skill name="skill-11"');
		expect(restoreSkillAdmissionLedger(harness.sessionManager.getEntries()).used).toBe(1);
	});

	it("deduplicates repeated reads within a prompt without letting continuations reset its cap", async () => {
		const { harness, skills } = await setup(11);
		const results = await readSkills(harness, [skills[0], ...skills.slice(0, 10)]);
		expect(results).toHaveLength(11);
		expect(results.every((text) => text.includes("body of skill-"))).toBe(true);
		const continued = await readSkills(harness, [skills[10]], "continue", continuationPromptOptions());
		expect(continued[0]).toContain("prompt skill cap 10 reached");
		expect((await readSkills(harness, [skills[10]]))[0]).toContain("body of skill-10");
	});

	it.each(["steer", "followUp"] as const)(
		"queued %s does not reset a running prompt's cap",
		async (streamingBehavior) => {
			const { harness, skills } = await setup(11);
			harness.setResponses([
				fauxAssistantMessage(
					skills.slice(0, 10).map((skill) => fauxToolCall("read", { path: skill.filePath })),
					{ stopReason: "toolUse" },
				),
				async () => {
					await harness.session.prompt("/skill:skill-10 queued", { streamingBehavior });
					return fauxAssistantMessage("queued");
				},
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("Read ten skill files");
			expect(getUserTexts(harness).at(-1)).toContain("prompt skill cap 10 reached");
			expect(restoreSkillAdmissionLedger(harness.sessionManager.getEntries()).used).toBe(10);
			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("/skill:skill-10 next task");
			expect(getUserTexts(harness).at(-1)).toContain('<skill name="skill-10"');
		},
	);

	it("unknown turn-marker versions stay fail closed even when a new prompt begins", async () => {
		const { harness } = await setup(1);
		harness.sessionManager.appendCustomEntry("skill_admission_turn", { schemaVersion: 999 });
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("/skill:skill-0 next task");
		expect(getUserTexts(harness).at(-1)).toContain("unknown version (fail closed)");
	});

	it("resume preserves the current prompt cap but permits a new prompt without starting a new session", async () => {
		const { harness, skills, resourceLoader } = await setup(11, { persistSession: true });
		await readSkills(harness, skills.slice(0, 10));
		const file = harness.sessionManager.getSessionFile();
		if (!file) throw new Error("missing session file");
		const sessionManager = SessionManager.open(file, undefined, undefined, harness.sessionManager.getOwnerLease());
		const resumed = await createHarness({ sessionManager, resourceLoader });
		harnesses.push(resumed);
		expect(restoreSkillAdmissionLedger(sessionManager.getEntries()).used).toBe(10);
		sessionManager.appendCompaction("summary", sessionManager.getEntries().at(-1)?.id ?? "", 1000);
		await resumed.session.setModel(resumed.models[1] ?? resumed.getModel());
		expect(restoreSkillAdmissionLedger(sessionManager.getEntries()).used).toBe(10);
		expect(resumed.session.admitSkillBody("skill-10", "body of skill-10", "read")).toContain(
			"prompt skill cap 10 reached",
		);
		expect((await readSkills(resumed, [skills[10]]))[0]).toContain("body of skill-10");
	});
});
