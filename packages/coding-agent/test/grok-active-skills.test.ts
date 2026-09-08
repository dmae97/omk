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

describe("Grok turn-scoped active skills", () => {
	it("activates matching skills only for the current turn", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const harness = await createHarness({
			provider: "xai",
			models: [{ id: "grok-4.5" }],
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
			expect(matchedPrompt).toContain('<active_skills source="grok-harness">');
			expect(activeSection(matchedPrompt)).toContain("<name>debugging</name>");
			expect(activeSection(matchedPrompt)).not.toContain("<name>headroom</name>");
			expect(activeSection(nextPrompt)).toBe("");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("adds headroom when the pending turn reports context pressure", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const harness = await createHarness({
			provider: "xai",
			models: [{ id: "grok-4.5" }],
			resourceLoader: createSkillLoader([
				createSkill("programming", "Python module edit"),
				createSkill("headroom", "Compress oversized context"),
			]),
		});
		let providerPrompt = "";
		harness.setResponses([
			(context) => {
				providerPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);
		const internals = harness.session as unknown as {
			_computePressureBucket: (pendingMessages?: readonly unknown[]) => number;
		};
		vi.spyOn(internals, "_computePressureBucket").mockImplementation((pendingMessages = []) =>
			pendingMessages.length > 0 ? 1 : 0,
		);

		try {
			await harness.session.prompt("edit the python module");
			const section = activeSection(providerPrompt);
			expect(section).toContain("<name>programming</name>");
			expect(section).toContain("<name>headroom</name>");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("does not auto-activate skills for another provider", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const harness = await createHarness({
			resourceLoader: createSkillLoader([createSkill("programming", "Quantum frobnicator calibration")]),
		});
		let providerPrompt = "";
		harness.setResponses([
			(context) => {
				providerPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);

		try {
			await harness.session.prompt("calibrate the quantum frobnicator");
			expect(activeSection(providerPrompt)).toBe("");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("selects from expanded prompt-template content", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const templatePath = "/virtual/debug-task.md";
		const resourceLoader: ResourceLoader = {
			...createSkillLoader([createSkill("debugging", "Runtime failures, hanging, empty response")]),
			getPrompts: () => ({
				prompts: [
					{
						name: "debug-task",
						description: "Debug task",
						content: "the process is hanging and the response is empty",
						filePath: templatePath,
						sourceInfo: createSyntheticSourceInfo(templatePath, { source: "sdk" }),
					},
				],
				diagnostics: [],
			}),
		};
		const harness = await createHarness({
			provider: "xai",
			models: [{ id: "grok-4.5" }],
			resourceLoader,
		});
		let providerPrompt = "";
		harness.setResponses([
			(context) => {
				providerPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);

		try {
			await harness.session.prompt("/debug-task");
			expect(activeSection(providerPrompt)).toContain("<name>debugging</name>");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("merges explicit SDK selections with automatic Grok selections", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const harness = await createHarness({
			provider: "xai",
			models: [{ id: "grok-4.5" }],
			resourceLoader: createSkillLoader([
				createSkill("review-work", "Post-implementation review"),
				createSkill("debugging", "Runtime failures, hanging, empty response"),
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
			await harness.session.prompt("the process is hanging and the response is empty", {
				activeSkillNames: ["review-work"],
				activeSkillSource: "sdk",
			});
			const section = activeSection(providerPrompt);
			expect(providerPrompt).toContain('<active_skills source="sdk+grok-harness">');
			expect(section).toContain("<name>review-work</name>");
			expect(section).toContain("<name>debugging</name>");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});

	it("uses the live skill description instead of a copied catalog", async () => {
		vi.stubEnv("OMK_GROK_HARNESS", "1");
		const harness = await createHarness({
			provider: "xai",
			models: [{ id: "grok-4.5" }],
			resourceLoader: createSkillLoader([createSkill("programming", "Quantum frobnicator calibration")]),
		});
		let providerPrompt = "";
		harness.setResponses([
			(context) => {
				providerPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);

		try {
			await harness.session.prompt("calibrate the quantum frobnicator");
			expect(activeSection(providerPrompt)).toContain("<name>programming</name>");
		} finally {
			vi.unstubAllEnvs();
			harness.cleanup();
		}
	});
});
