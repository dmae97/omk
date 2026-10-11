import { AgentSession } from "./agent-session.ts";
import { AuthStorage } from "./auth-storage.ts";
import { ModelRegistry } from "./model-registry.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";
import { RunCoordinator } from "./verified-run/coordinator.ts";
import type { VerifiedRunSessionInput } from "./verified-run/session-port.ts";
import { VerifiedRunError } from "./verified-run/storage.ts";

// Kept out of agent-session-services.ts so the session runtime that every `-p`
// worker loads does not pull the verified-run coordinator graph (spec 043).

/** Closed, in-memory session composition for the offline verified-run reference adapter. */
export function createVerifiedRunAgentSession(input: VerifiedRunSessionInput): AgentSession {
	const { agent, tool, workspace } = input;
	const model = agent.state.model;
	if (!model) throw new VerifiedRunError("writer_backend_missing");
	const auth = AuthStorage.inMemory();
	auth.setRuntimeApiKey(model.provider, "synthetic-local-only");
	const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: workspace,
		settingsManager: settings,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	// No reload/discovery: arbitrary project or user code must not enter this host runtime.
	return new AgentSession({
		agent,
		cwd: workspace,
		sessionManager: SessionManager.inMemory(workspace),
		settingsManager: settings,
		resourceLoader: loader,
		modelRegistry: ModelRegistry.inMemory(auth),
		modelPinned: true,
		baseToolsOverride: { [tool.name]: tool },
		initialActiveToolNames: [tool.name],
		allowedToolNames: [tool.name],
	});
}

/** The high-level SDK assembly; the core Coordinator depends only on its host session port. */
export function createRunCoordinator(stateRoot: string): RunCoordinator {
	return new RunCoordinator(stateRoot, { createSession: createVerifiedRunAgentSession });
}
