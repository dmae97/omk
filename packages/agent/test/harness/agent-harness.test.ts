import { getModel } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.js";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.js";
import { Session } from "../../src/harness/session/session.js";
import { InMemorySessionStorage } from "../../src/harness/session/storage/memory.js";
import type { PromptTemplate, Skill } from "../../src/harness/types.js";
import type { AgentTool } from "../../src/types.js";

interface AppSkill extends Skill {
	source: "project" | "user";
}

interface AppPromptTemplate extends PromptTemplate {
	source: "project" | "user";
}

interface AppTool extends AgentTool {
	source: "builtin" | "extension";
}

describe("AgentHarness", () => {
	it("constructs directly and exposes queue modes", () => {
		const session = new Session(new InMemorySessionStorage());
		const env = new NodeExecutionEnv({ cwd: process.cwd() });
		const initialModel = getModel("anthropic", "claude-sonnet-4-5");
		const harness = new AgentHarness({
			env,
			session,
			model: initialModel,
			systemPrompt: "You are helpful.",
			steeringMode: "all",
			followUpMode: "all",
		});
		expect(harness.env).toBe(env);
		expect(harness.agent.state.model).toBe(initialModel);
		expect(harness.steeringMode).toBe("all");
		expect(harness.followUpMode).toBe("all");
		harness.steeringMode = "one-at-a-time";
		harness.followUpMode = "one-at-a-time";
		expect(harness.agent.steeringMode).toBe("one-at-a-time");
		expect(harness.agent.followUpMode).toBe("one-at-a-time");
	});

	it("preserves app resource types for getters and update events", async () => {
		const session = new Session(new InMemorySessionStorage());
		const env = new NodeExecutionEnv({ cwd: process.cwd() });
		const model = getModel("anthropic", "claude-sonnet-4-5");
		const harness = new AgentHarness<AppSkill, AppPromptTemplate, AppTool>({ env, session, model });
		const skill: AppSkill = {
			name: "inspect",
			description: "Inspect things",
			content: "Use inspection tools.",
			filePath: "/skills/inspect/SKILL.md",
			source: "project",
		};
		const promptTemplate: AppPromptTemplate = { name: "review", content: "Review $1", source: "user" };
		const resources = { skills: [skill], promptTemplates: [promptTemplate] };
		const updates: Array<{ resourcesSource?: string; previousSource?: string }> = [];
		harness.subscribe((event) => {
			if (event.type === "resources_update") {
				updates.push({
					resourcesSource: event.resources.skills?.[0]?.source,
					previousSource: event.previousResources.skills?.[0]?.source,
				});
			}
		});

		await harness.setResources(resources);
		await harness.setResources(resources);
		const resolved = harness.getResources();

		expect(updates).toEqual([
			{ resourcesSource: "project", previousSource: undefined },
			{ resourcesSource: "project", previousSource: "project" },
		]);
		expect(resolved.skills?.[0]?.source).toBe("project");
		expect(resolved.promptTemplates?.[0]?.source).toBe("user");
		expect(resolved.skills).not.toBe(resources.skills);
		expect(resolved.promptTemplates).not.toBe(resources.promptTemplates);
	});
});
