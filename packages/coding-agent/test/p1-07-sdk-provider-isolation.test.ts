import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, getApiProvider } from "omk-ai";
import { getOAuthProvider } from "omk-ai/oauth";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

const tempDirs: string[] = [];

function makeRegistry(): ModelRegistry {
	const dir = mkdtempSync(join(tmpdir(), "omk-p107-iso-"));
	tempDirs.push(dir);
	const auth = AuthStorage.create(join(dir, "auth.json"));
	return ModelRegistry.create(auth, join(dir, "models.json"));
}

const dummyStreamSimple = () => createAssistantMessageEventStream();

afterEach(() => {
	while (tempDirs.length > 0) {
		const d = tempDirs.pop();
		if (d) rmSync(d, { recursive: true, force: true });
	}
});

describe("P1-7: SDK per-session provider isolation", () => {
	it("preserves session A's custom API and OAuth providers when session B refreshes, registers, or unregisters", () => {
		const regA = makeRegistry();
		const regB = makeRegistry();
		const apiA = "p107-session-a-api";
		const apiB = "p107-session-b-api";
		const oauthA = "p107-session-a-oauth";

		try {
			regA.registerProvider("provider-a", {
				api: apiA,
				baseUrl: "http://127.0.0.1:1",
				apiKey: "key-a",
				streamSimple: dummyStreamSimple,
				models: [
					{
						id: "model-a",
						name: "Model A",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 32000,
						maxTokens: 4096,
					},
				],
			});
			regA.registerProvider(oauthA, {
				oauth: {
					name: "OAuth A",
					login: async () => ({ refresh: "r", access: "a", expires: Date.now() + 60_000 }),
					refreshToken: async (c) => c,
					getApiKey: (c) => c.access,
				},
			});

			expect(getApiProvider(apiA)).toBeDefined();
			expect(getOAuthProvider(oauthA)).toBeDefined();

			// Session B refresh MUST NOT wipe Session A's custom API or OAuth provider
			regB.refresh();
			expect(getApiProvider(apiA)).toBeDefined();
			expect(getOAuthProvider(oauthA)).toBeDefined();

			// Session B registering & unregistering its own provider MUST NOT wipe Session A's provider
			regB.registerProvider("provider-b", {
				api: apiB,
				baseUrl: "http://127.0.0.1:2",
				apiKey: "key-b",
				streamSimple: dummyStreamSimple,
			});
			expect(getApiProvider(apiA)).toBeDefined();
			expect(getApiProvider(apiB)).toBeDefined();

			regB.unregisterProvider("provider-b");
			expect(getApiProvider(apiB)).toBeUndefined();
			expect(getApiProvider(apiA)).toBeDefined();
			expect(getOAuthProvider(oauthA)).toBeDefined();
		} finally {
			regA.unregisterProvider("provider-a");
			regA.unregisterProvider(oauthA);
			regB.unregisterProvider("provider-b");
		}
	});

	it("restores a built-in API when session A unregisters its override without wiping session B's custom API", () => {
		const regA = makeRegistry();
		const regB = makeRegistry();
		const apiB = "p107-session-b-keep";
		try {
			regB.registerProvider("provider-b-keep", {
				api: apiB,
				baseUrl: "http://127.0.0.1:3",
				apiKey: "key-b",
				streamSimple: dummyStreamSimple,
			});
			const builtinBefore = getApiProvider("openai-completions");
			expect(builtinBefore).toBeDefined();

			regA.registerProvider("override-openai", {
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:4",
				apiKey: "key-override",
				streamSimple: dummyStreamSimple,
			});
			regA.unregisterProvider("override-openai");

			// Built-in openai-completions is restored AND Session B's custom API survives
			expect(getApiProvider("openai-completions")).toBeDefined();
			expect(getApiProvider(apiB)).toBeDefined();
		} finally {
			regA.unregisterProvider("override-openai");
			regB.unregisterProvider("provider-b-keep");
		}
	});
});
