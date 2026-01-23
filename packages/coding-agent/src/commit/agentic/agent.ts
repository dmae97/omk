import type { Api, Model } from "@oh-my-pi/pi-ai";
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

	try {
		const prompt = renderPromptTemplate(agentUserPrompt, { user_context: input.userContext });
		await session.prompt(prompt, { expandPromptTemplates: false });
		return state;
	} finally {
		await session.dispose();
	}
}
