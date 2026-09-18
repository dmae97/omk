import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Args } from "../../cli/args.ts";
import { getAgentDir } from "../../config.ts";
import { AuthStorage } from "../../core/auth-storage.ts";
import { createExtensionRuntime } from "../../core/extensions/loader.ts";
import { ModelRegistry } from "../../core/model-registry.ts";
import { resolveCliModel } from "../../core/model-resolver.ts";
import type { ResourceLoader } from "../../core/resource-loader.ts";
import { createAgentSession } from "../../core/sdk.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { AcpError, type AcpSession } from "./acp-agent.ts";

/** No discovery or client-requested executables in the restricted ACP profile. */
function emptyResources(): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () =>
			"You are OMK, a conversational coding assistant. No tools are available in this ACP profile.",
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

export async function createAcpSession(cwd: string, args: Args): Promise<AcpSession> {
	if (!(await stat(cwd)).isDirectory()) throw new AcpError(-32602, "cwd must be a directory");
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const selected = resolveCliModel({ cliModel: args.model, cliProvider: args.provider, modelRegistry });
	if (selected.error) throw new AcpError(-32602, "Model selection failed; check --model and --provider");
	const model =
		selected.model ?? modelRegistry.getAvailable().find((m) => !args.provider || m.provider === args.provider);
	if (!model) throw new AcpError(-32000, "No model available; configure credentials using omk /login first");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		model,
		modelPinned: true,
		thinkingLevel: args.thinking ?? selected.thinkingLevel,
		tools: [],
		noTools: "all",
		resourceLoader: emptyResources(),
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	return {
		async prompt(text, emit) {
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					emit(event.assistantMessageEvent.delta);
				}
			});
			try {
				await session.prompt(text, { source: "rpc", expandPromptTemplates: false });
				const kind = session.lastTermination?.kind;
				if (kind === "user_abort" || kind === "provider_abort") return "cancelled";
				if (kind !== "completed") throw new AcpError(-32603, "Prompt did not complete successfully");
				return "end_turn";
			} finally {
				unsubscribe();
			}
		},
		cancel: () => session.abort(),
		dispose: () => session.dispose(),
	};
}
