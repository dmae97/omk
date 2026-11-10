import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { FIXTURE_TOKEN } from "./omk-provider-flag-on-lib.ts";

const BASE_URL_MISSING =
	"OMK gateway base URL missing. Set OMK_GATEWAY_BASE_URL (for example https://host/v1); OMK requests are refused until it is set.";

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A session built like main.ts builds one, with `--model <cliModel>` resolved; flag/URL come from the env stubs. */
async function sessionFor(cliModel: string, token?: string) {
	const root = join(tmpdir(), `omk-nourl-${process.pid}-${Math.random().toString(36).slice(2)}`);
	roots.push(root);
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	const services = await createAgentSessionServices({ cwd: root, agentDir });
	if (token) services.authStorage.setRuntimeApiKey("OMK", token);
	const resolved = resolveCliModel({ cliModel, modelRegistry: services.modelRegistry });
	return { services, resolved, root };
}

describe("OMK_PROVIDER_OMK=1 without OMK_GATEWAY_BASE_URL", () => {
	it.each(["OMK/coder", "OMK/reasoner"])("--model %s resolves (it is not 'model not found')", async (cliModel) => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const { resolved } = await sessionFor(cliModel);
		expect(resolved.error).toBeUndefined();
		expect(resolved.model).toMatchObject({ provider: "OMK", id: cliModel.slice(4) });
	});

	it("a request with a token refuses with the OMK base-URL text and sends nothing", async () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const fetchSpy = vi.fn(() => {
			throw new Error("no request may be sent");
		});
		vi.stubGlobal("fetch", fetchSpy);
		const { services, resolved } = await sessionFor("OMK/coder", FIXTURE_TOKEN);
		if (!resolved.model) throw new Error("model not resolved");
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(),
			model: resolved.model,
		});
		const errors: (string | undefined)[] = [];
		session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				errors.push(event.message.errorMessage);
		});
		await session.prompt("hi");
		session.dispose();
		expect(errors).toContain(BASE_URL_MISSING);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("a prompt without a token reports the base URL first (the URL is the first thing to fix)", async () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const { services, resolved } = await sessionFor("OMK/reasoner");
		if (!resolved.model) throw new Error("model not resolved");
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(),
			model: resolved.model,
		});
		await expect(session.prompt("hi")).rejects.toThrow(BASE_URL_MISSING);
		session.dispose();
	});

	it("the startup warning is the same text", async () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const { services } = await sessionFor("OMK/coder");
		expect(JSON.stringify(services.diagnostics)).toContain(JSON.stringify(BASE_URL_MISSING).slice(1, -1));
	});

	it("flag off: OMK/coder is 'not found' exactly as before, with no OMK text anywhere", async () => {
		const { services, resolved } = await sessionFor("OMK/coder");
		expect(resolved.model).toBeUndefined();
		expect(resolved.error).not.toMatch(/OMK gateway|OMK_GATEWAY_BASE_URL/);
		expect(resolved.error).toMatch(/not found/i);
		expect(services.modelRegistry.find("OMK", "coder")).toBeUndefined();
		expect(JSON.stringify(services.diagnostics)).not.toContain("OMK");
	});
});
