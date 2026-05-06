import { homedir } from "node:os";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { InMemorySessionStorage } from "../../src/harness/session/storage/memory.js";
import {
	createAgentHarness,
	formatSkillsForSystemPrompt,
	loadSourcedPromptTemplates,
	loadSourcedSkills,
	NodeExecutionEnv,
	Session,
} from "../../src/index.js";

type Source = { type: "project" | "user" | "path"; dir: string };

const env = new NodeExecutionEnv({ cwd: process.cwd() });
const source = (type: Source["type"], dir: string) => ({ path: dir, source: { type, dir } });
const { skills: sourcedSkills } = await loadSourcedSkills<Source>(env, [
	source("project", join(env.cwd, ".pi/skills")),
	source("user", join(homedir(), ".pi/agent/skills")),
	source("path", join(env.cwd, "../../../pi-skills")),
]);
const { promptTemplates: sourcedPromptTemplates } = await loadSourcedPromptTemplates<Source>(env, [
	source("project", join(env.cwd, ".pi/prompts")),
	source("user", join(homedir(), ".pi/agent/prompts")),
]);

const session = new Session(new InMemorySessionStorage());
const agent = createAgentHarness({
	env,
	session,
	model: getModel("openai", "gpt-5.5"),
	thinkingLevel: "low",
	systemPrompt: ({ env, resources }) => {
		console.log("Building system prompt");
		return [
			`You are a helpful assistant.`,
			formatSkillsForSystemPrompt(resources.skills ?? []),
			`Current working directory: ${env.cwd}`,
		]
			.filter((part) => part.length > 0)
			.join("\n\n");
	},
	resources: {
		promptTemplates: sourcedPromptTemplates.map((entry) => entry.promptTemplate),
		skills: sourcedSkills.map((entry) => entry.skill),
	},
});

const response = await agent.prompt("What skills do you have? Any duplicates?");
console.log(response);
