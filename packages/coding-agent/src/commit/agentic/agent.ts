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
	let thinkingLineActive = false;
	const toolArgsById = new Map<string, { name: string; args?: Record<string, unknown> }>();
	const writeThinkingLine = (text: string) => {
		const line = chalk.dim(`… ${text}`);
		process.stdout.write(`\r\x1b[2K${line}`);
		thinkingLineActive = true;
	};
	const clearThinkingLine = () => {
		if (!thinkingLineActive) return;
		process.stdout.write("\r\x1b[2K");
		thinkingLineActive = false;
	};
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") {
					isThinking = true;
					thinkingLineActive = false;
				}
				break;
			case "message_update": {
				if (event.message?.role !== "assistant") break;
				const preview = extractMessagePreview(event.message?.content ?? []);
				if (!preview) break;
				writeThinkingLine(preview);
				break;
			}
			case "tool_execution_start":
				toolCalls += 1;
				toolArgsById.set(event.toolCallId, { name: event.toolName, args: event.args });
				break;
			case "message_end": {
				const role = event.message?.role;
				if (role === "assistant") {
					messageCount += 1;
					isThinking = false;
					clearThinkingLine();
					const preview = extractMessagePreview(event.message?.content ?? []);
					const label = preview ? `● ${preview}` : `● agent message ${messageCount}`;
					writeStdout(label);
				}
				break;
			}
			case "tool_execution_end": {
				const stored = toolArgsById.get(event.toolCallId) ?? { name: event.toolName };
				toolArgsById.delete(event.toolCallId);
				clearThinkingLine();
				const toolLabel = formatToolLabel(stored.name);
				const symbol = event.isError ? "" : "";
				writeStdout(`${symbol} ${toolLabel}`);
				const argsText = formatToolArgs(stored.args);
				if (argsText) {
					writeStdout(formatToolArgsBlock(argsText));
				}
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

function extractMessagePreview(content: Array<{ type: string; text?: string }>): string | null {
	const textBlocks = content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text?.trim())
		.filter((value): value is string => Boolean(value));
	if (textBlocks.length === 0) return null;
	const combined = textBlocks.join(" ").replace(/\s+/g, " ").trim();
	return truncateToolArg(combined);
}

function formatToolLabel(toolName: string): string {
	const displayName = toolName
		.split(/[_-]/)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join("");
	return displayName;
}

function formatToolArgs(args?: Record<string, unknown>): string | null {
	if (!args || Object.keys(args).length === 0) return null;
	const textParts: string[] = [];
	const pushIf = (key: string, label = key) => {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			textParts.push(`${label}: ${value.trim()}`);
		}
	};
	pushIf("summary");
	pushIf("type");
	pushIf("scope");
	pushIf("file");
	pushIf("path");
	pushIf("pattern");
	pushIf("query");
	pushIf("url");
	pushIf("command");
	const files = args.files;
	if (Array.isArray(files) && files.length > 0) {
		const list = files.map((file) => String(file));
		textParts.push(`files: ${list.join(", ")}`);
	}
	const hunks = args.hunks;
	if (Array.isArray(hunks) && hunks.length > 0) {
		textParts.push(`hunks: ${hunks.join(", ")}`);
	}
	if (textParts.length > 0) {
		return textParts.join("\n");
	}
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

function formatToolArgsBlock(text: string): string {
	const lines = text.split("\n");
	return lines
		.map((line, index) => (index === 0 ? `  ⎿ ${line}` : `    ${line}`))
		.join("\n");
}

function truncateToolArg(value: string): string {
	if (value.length <= 40) return value;
	return `${value.slice(0, 37)}...`;
}
