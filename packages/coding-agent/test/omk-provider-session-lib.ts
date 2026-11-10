import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
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

/**
 * The subagent path: the subagent extension (examples/extensions/subagent/index.ts:367-368) runs a child
 * `omk --mode json -p --no-session [--no-extensions] --model <agent.model> Task: ...` with the parent's environment
 * (worker-env.ts, `{ ...parent }` plus worker overrides), and no `--thinking`. This runs that child against a local
 * fake gateway and returns the first request body it sends.
 */
export async function firstWorkerRequest(agentModel: string): Promise<Record<string, unknown>> {
	const root = mkdtempSync(join(tmpdir(), "omk-worker-"));
	let resolveBody: (body: Record<string, unknown>) => void = () => undefined;
	const first = new Promise<Record<string, unknown>>((resolve) => {
		resolveBody = resolve;
	});
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			resolveBody(JSON.parse(raw || "{}"));
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "fixture" } }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	const parentEnv: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: root,
		OMK_CODING_AGENT_DIR: join(root, "agent"),
		OMK_OFFLINE: "1",
		OMK_PROVIDER_OMK: "1",
		OMK_GATEWAY_BASE_URL: `http://127.0.0.1:${port}/v1`,
		OMK_ACCOUNT_TOKEN: FIXTURE_TOKEN,
	};
	const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--model", agentModel, "Task: say hi"];
	const child = spawn(process.execPath, [entry, ...args], {
		cwd: root,
		env: subagentWorkerEnv(parentEnv),
		stdio: "ignore",
	});
	try {
		return await Promise.race([
			first,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("worker sent no request")), 25_000)),
		]);
	} finally {
		child.kill("SIGKILL");
		server.close();
		rmSync(root, { recursive: true, force: true });
	}
}
