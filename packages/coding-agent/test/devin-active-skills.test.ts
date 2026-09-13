import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { createSyntheticSourceInfo, type ResourceLoader, type Skill } from "../src/index.ts";
import { createHarness } from "./suite/harness.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createSkill(name: string, description: string): Skill {
	const filePath = `/virtual/${name}/SKILL.md`;
	return {
		name,
		description,
		filePath,
		baseDir: `/virtual/${name}`,
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "sdk", scope: "user" }),
		disableModelInvocation: false,
	};
}

function createSkillLoader(skills: readonly Skill[]): ResourceLoader {
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills: [...skills], diagnostics: [] }),
	};
}

function activeSection(prompt: string): string {
	return prompt.split("<active_skills", 2)[1]?.split("</active_skills>", 1)[0] ?? "";
}

describe("Devin SWE-2 turn-scoped active skills", () => {
	it("activates matching devin-harness skills only for the current turn", async () => {
		vi.stubEnv("OMK_DEVIN_HARNESS", "1");
		const harness = await createHarness({
			provider: "devin",
			models: [{ id: "swe-2" }],
			resourceLoader: createSkillLoader([
				createSkill("programming", "TypeScript Python Rust Go implementation"),
				createSkill("debugging", "Runtime failures, hanging, crash, empty response"),
				createSkill("headroom", "Compress oversized context window"),
			]),
		});
		let matchedPrompt = "";
		let nextPrompt = "";
		harness.setResponses([
			(context) => {
				matchedPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("first");
			},
			(context) => {
				nextPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("second");
			},
		]);

		try {
			await harness.session.prompt("the agent is hanging and the response is empty");
			await harness.session.prompt("hello there");
			expect(matchedPrompt).toContain('<active_skills source="devin-harness">');
			expect(activeSection(matchedPrompt)).toContain("<name>debugging</name>");
			expect(activeSection(matchedPrompt)).not.toContain("<name>headroom</name>");
			expect(activeSection(nextPrompt)).toBe("");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("stays inactive when OMK_DEVIN_HARNESS is off", async () => {
		vi.stubEnv("OMK_DEVIN_HARNESS", "0");
		const harness = await createHarness({
			provider: "devin",
			models: [{ id: "swe-2" }],
			resourceLoader: createSkillLoader([
				createSkill("debugging", "Runtime failures, hanging, crash, empty response"),
			]),
		});
		let providerPrompt = "";
		harness.setResponses([
			(context) => {
				providerPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);

		try {
			await harness.session.prompt("the agent is hanging and the response is empty");
			expect(activeSection(providerPrompt)).toBe("");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});
});
