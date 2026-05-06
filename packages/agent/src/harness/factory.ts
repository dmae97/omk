import { AgentHarness } from "./agent-harness.js";
import { Session } from "./session/session.js";
import type { AgentHarnessOptions, SessionMetadata, SessionStorage } from "./types.js";

export function createSession<TMetadata extends SessionMetadata>(
	storage: SessionStorage<TMetadata>,
): Session<TMetadata> {
	return new Session(storage);
}

export function createAgentHarness(options: AgentHarnessOptions): AgentHarness {
	return new AgentHarness(options);
}
