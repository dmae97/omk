import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createHarness } from "./suite/harness.ts";

const fullText = `HEADER\n${"middle\n".repeat(2000)}TAIL\n`;
const probe: AgentTool = {
	name: "probe",
	label: "Probe",
	description: "Return deterministic text",
	parameters: Type.Object({}),
	execute: async () => ({ content: [{ type: "text", text: fullText }], details: undefined }),
};

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function loader() {
	const agentDir = mkdtempSync(join(tmpdir(), "omk-deepseek-loader-"));
	directories.push(agentDir);
	const resources = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		systemPrompt: "Fixture system prompt",
	});
	await resources.reload();
	return resources;
}

describe("DeepSeek harness built-in integration", () => {
	it("loads with --no-extensions and supports independent opt-out", async () => {
		vi.stubEnv("OMK_DEEPSEEK_HARNESS", undefined);
		expect((await loader()).getExtensions().extensions.map((entry) => entry.path)).toContain(
			"<builtin:deepseek-harness>",
		);
		for (const value of ["0", "false", "off", "disabled", " DISABLE "]) {
			vi.stubEnv("OMK_DEEPSEEK_HARNESS", value);
			expect((await loader()).getExtensions().extensions.map((entry) => entry.path)).not.toContain(
				"<builtin:deepseek-harness>",
			);
		}
	});

	it("projects the real tool loop without rewriting session history or leaking after a model switch", async () => {
		vi.stubEnv("OMK_DEEPSEEK_HARNESS", "1");
		vi.stubEnv("OMK_FINISH_CHECK", "0");
		const harness = await createHarness({
			provider: "openrouter",
			models: [{ id: "deepseek/deepseek-v4.1-flash" }, { id: "openai/gpt-5.5" }],
			resourceLoader: await loader(),
			tools: [probe],
			settings: { compaction: { enabled: false } },
		});
		const prompts: string[] = [];
		const toolTexts: string[] = [];
		harness.setResponses([
			(context) => {
				prompts.push(context.systemPrompt ?? "");
				return fauxAssistantMessage([{ type: "toolCall", id: "probe-1", name: "probe", arguments: {} }], {
					stopReason: "toolUse",
				});
			},
			(context) => {
				prompts.push(context.systemPrompt ?? "");
				toolTexts.push(JSON.stringify(context.messages.filter((message) => message.role === "toolResult")));
				return fauxAssistantMessage("first finished");
			},
			(context) => {
				prompts.push(context.systemPrompt ?? "");
				toolTexts.push(JSON.stringify(context.messages.filter((message) => message.role === "toolResult")));
				return fauxAssistantMessage("second finished");
			},
		]);
		vi.spyOn(harness.session, "getContextUsage").mockReturnValue({
			tokens: 90000,
			contextWindow: 100000,
			percent: 90,
		});
		try {
			await harness.session.bindExtensions({});
			await harness.session.prompt("run probe once");
			expect(prompts[0]).toContain('<model_harness id="deepseek_harness">');
			expect(prompts[1]).toBe(prompts[0]);
			expect(toolTexts[0]).toContain("deepseek_harness:");
			expect(toolTexts[0].length).toBeLessThan(fullText.length);
			const stored = harness.session.messages.find((message) => message.role === "toolResult");
			expect(stored).toMatchObject({ content: [{ type: "text", text: fullText }] });
			const next = harness.getModel("openai/gpt-5.5");
			if (!next) throw new Error("Missing fixture model");
			await harness.session.setModel(next);
			await harness.session.prompt("continue with the other model");
			expect(prompts[2]).not.toContain("deepseek_harness");
			expect(toolTexts[1]).toContain(JSON.stringify(fullText).slice(1, -1));
		} finally {
			harness.cleanup();
		}
	});
});
