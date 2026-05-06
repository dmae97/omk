import { getModel } from "@mariozechner/pi-ai";
import { InMemorySessionStorage } from "../../src/harness/session/storage/memory.js";
import { createAgentHarness, NodeExecutionEnv, Session } from "../../src/index.js";

const session = new Session(new InMemorySessionStorage());
const agent = createAgentHarness({
	env: new NodeExecutionEnv({ cwd: process.cwd() }),
	session,
	initialModel: getModel("openai-codex", "gpt-5.5"),
});

const response = await agent.prompt("What is 2 + 2?");
console.log(response);
