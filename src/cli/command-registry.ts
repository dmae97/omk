import type { Command } from "commander";
import { registerBasicCommands } from "./register-basic-commands.js";
import { registerWorkflowCommands } from "./register-workflow-commands.js";
import { registerProviderCommands } from "./register-provider-commands.js";
import { registerOpenAiCodexCommands } from "./register-openai-codex-commands.js";
import { registerToolCommands } from "./register-tool-commands.js";
import { registerSpecAgentGoalCommands } from "./register-spec-agent-goal-commands.js";
import { registerMcpDagCronScreenshotCommands } from "./register-mcp-dag-cron-screenshot-commands.js";
import { registerIntegrationCommands } from "./register-integration-commands.js";

export function registerCliCommands(program: Command): void {
  registerBasicCommands(program);
  registerWorkflowCommands(program);
  registerProviderCommands(program);
  registerOpenAiCodexCommands(program);
  registerToolCommands(program);
  registerSpecAgentGoalCommands(program);
  registerIntegrationCommands(program);
  registerMcpDagCronScreenshotCommands(program);
}
