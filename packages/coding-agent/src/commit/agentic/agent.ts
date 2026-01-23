import type { Api, Model } from "@oh-my-pi/pi-ai";
import chalk from "chalk";
import agentUserPrompt from "$c/commit/agentic/prompts/session-user.md" with { type: "text" };
import agentSystemPrompt from "$c/commit/agentic/prompts/system.md" with { type: "text" };
import type { CommitAgentState } from "$c/commit/agentic/state";
import { createCommitTools } from "$c/commit/agentic/tools";
import type { ControlledGit } from "$c/commit/git";
import typesDescriptionPrompt from "$c/commit/prompts/types-description.md" with { type: "text" };
import type { ModelRegistry } from "$c/config/model-registry";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { SettingsManager } from "$c/config/settings-manager";
import { createAgentSession } from "$c/sdk";
import type { AuthStorage } from "$c/session/auth-storage";
import type { AgentSessionEvent } from "$c/session/agent-session";

export interface CommitAgentInput {
	cwd: string;
	git: ControlledGit;
	model: Model<Api>;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	authStorage: AuthStorage;
	userContext?: string;
}

export async function runCommitAgentSession(input: CommitAgentInput): Promise<CommitAgentState> {
	const typesDescription = renderPromptTemplate(typesDescriptionPrompt);
	const systemPrompt = renderPromptTemplate(agentSystemPrompt, {
		types_description: typesDescription,
	});
	const state: CommitAgentState = {};
	const spawns = "quick_task";
	const tools = createCommitTools({
		cwd: input.cwd,
		git: input.git,
		authStorage: input.authStorage,
		modelRegistry: input.modelRegistry,
		settingsManager: input.settingsManager,
		spawns,
		state,
	});

	const { session } = await createAgentSession({
		cwd: input.cwd,
		authStorage: input.authStorage,
		modelRegistry: input.modelRegistry,
		settingsManager: input.settingsManager,
		model: input.model,
		systemPrompt,
		customTools: tools,
		enableLsp: false,
		enableMCP: false,
		hasUI: false,
		spawns,
		toolNames: ["read"],
	});
	let toolCalls = 0;
	let messageCount = 0;
	let isThinking = false;
	const toolArgsById = new Map<string, { name: string; args?: Record<string, unknown> }>();
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") {
					isThinking = true;
					writeStdout(chalk.dim("… thinking"));
				}
				break;
			case "tool_execution_start":
				toolCalls += 1;
				toolArgsById.set(event.toolCallId, { name: event.toolName, args: event.args });
				break;
			case "message_end": {
				const role = event.message?.role;
				if (role === "assistant") {
					messageCount += 1;
					isThinking = false;
					writeStdout(`● agent message ${messageCount}`);
				}
				break;
			}
			case "tool_execution_end": {
				const stored = toolArgsById.get(event.toolCallId) ?? { name: event.toolName };
				toolArgsById.delete(event.toolCallId);
				const toolLabel = formatToolLabel(stored.name, stored.args);
				const symbol = event.isError ? "" : "";
				writeStdout(`${symbol} ${toolLabel}`);
				break;
			}
			case "agent_end":
				if (isThinking) {
					isThinking = false;
				}
				writeStdout(`● agent finished (${messageCount} messages, ${toolCalls} tools)`);
				break;
			default:
				break;
		}
	});

	try {
		const prompt = renderPromptTemplate(agentUserPrompt, { user_context: input.userContext });
		await session.prompt(prompt, { expandPromptTemplates: false });
		return state;
	} finally {
		unsubscribe();
		await session.dispose();
	}
}

function writeStdout(message: string): void {
	process.stdout.write(`${message}\n`);
}

function formatToolLabel(toolName: string, args?: Record<string, unknown>): string {
	const displayName = toolName
		.split(/[_-]/)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join("");
	if (!args) return displayName;
	const argValue = extractToolArgument(args);
	if (!argValue) return displayName;
	return `${displayName}(${argValue})`;
}

function extractToolArgument(args: Record<string, unknown>): string | null {
	const candidates = ["path", "file", "pattern", "query", "url", "command"];
	for (const key of candidates) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			return truncateToolArg(value);
		}
	}
	const files = args.files;
	if (Array.isArray(files) && files.length > 0) {
		const first = typeof files[0] === "string" ? files[0] : String(files[0]);
		const suffix = files.length > 1 ? ` +${files.length - 1}` : "";
		return truncateToolArg(`${first}${suffix}`);
	}
	return null;
}

function truncateToolArg(value: string): string {
	if (value.length <= 40) return value;
	return `${value.slice(0, 37)}...`;
}
