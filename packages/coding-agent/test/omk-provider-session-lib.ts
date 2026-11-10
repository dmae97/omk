import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { FIXTURE_TOKEN, GATEWAY_URL } from "./omk-provider-flag-on-lib.ts";

export interface Wire {
	url: string;
	body: Record<string, unknown>;
}

/** Fetch stub that records every request body and answers 400, so nothing retries and nothing leaves the box. */
export function stubGateway(): Wire[] {
	const wire: Wire[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown, init?: RequestInit) => {
			wire.push({
				url: String(input instanceof Request ? input.url : input),
				body: JSON.parse(String(init?.body ?? "{}")),
			});
			return new Response(JSON.stringify({ error: { message: "fixture" } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}),
	);
	return wire;
}

/**
 * A real AgentSession built the way main.ts builds one: createAgentSessionServices (which runs the OMK registration
 * hook with the flag on), `--model` resolved by resolveCliModel, thinking level from the `:suffix` or the defaults.
 */
export async function openOmkSession(cliModel: string, thinkingLevel?: "off" | "low" | "medium" | "high") {
	const root = join(tmpdir(), `omk-route-${process.pid}-${Math.random().toString(36).slice(2)}`);
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	process.env.OMK_PROVIDER_OMK = "1";
	process.env.OMK_GATEWAY_BASE_URL = GATEWAY_URL;
	const services = await createAgentSessionServices({ cwd: root, agentDir });
	services.authStorage.setRuntimeApiKey("OMK", FIXTURE_TOKEN);
	const resolved = resolveCliModel({ cliModel, modelRegistry: services.modelRegistry });
	if (!resolved.model) throw new Error(resolved.error ?? "model not resolved");
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(),
		model: resolved.model,
		thinkingLevel: thinkingLevel ?? resolved.thinkingLevel,
	});
	return {
		session,
		services,
		close() {
			session.dispose();
			delete process.env.OMK_PROVIDER_OMK;
			delete process.env.OMK_GATEWAY_BASE_URL;
			rmSync(root, { recursive: true, force: true });
		},
	};
}
