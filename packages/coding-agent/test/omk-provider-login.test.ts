import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOAuthProvider, type OAuthLoginCallbacks, resetOAuthProviders } from "omk-ai/oauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { ON_ENV } from "./omk-provider-flag-on-lib.ts";

const STORED = "omk-stored-login-token";
const FROM_ENV = "omk-env-token";

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-login-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	resetOAuthProviders();
	vi.unstubAllEnvs();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function callbacks(answer: string): OAuthLoginCallbacks & { prompts: string[] } {
	const prompts: string[] = [];
	return {
		prompts,
		onAuth: () => {
			throw new Error("OMK login must not open a browser");
		},
		onDeviceCode: () => {},
		onSelect: async () => undefined,
		onPrompt: async ({ message }) => {
			prompts.push(message);
			return answer;
		},
	};
}

function registryOnDisk(env: NodeJS.ProcessEnv = ON_ENV) {
	const dir = tempDir();
	const authPath = join(dir, "auth.json");
	const authStorage = AuthStorage.create(authPath);
	const registry = ModelRegistry.create(authStorage, join(dir, "models.json"));
	expect(registerOmkProviderIfEnabled(registry, env)).toEqual([]);
	return { registry, authStorage, authPath };
}

describe("OMK /login (paste the account token)", () => {
	it("registers an OMK login with the other /login providers when the flag is on", () => {
		registryOnDisk();
		expect(getOAuthProvider("OMK")?.name).toBe("OMK account token");
	});

	it("stores the pasted token in auth.json and uses it as the bearer key", async () => {
		const { registry, authStorage, authPath } = registryOnDisk();
		const cb = callbacks(`  ${STORED}  `);
		await authStorage.login("OMK", cb);
		expect(cb.prompts).toEqual(["Paste your OMK account token (or set OMK_ACCOUNT_TOKEN)"]);
		expect(authStorage.get("OMK")?.type).toBe("oauth");
		expect(JSON.parse(readFileSync(authPath, "utf8")).OMK.access).toBe(STORED);

		const model = registry.find("OMK", "coder");
		if (!model) throw new Error("OMK/coder missing");
		expect(registry.hasConfiguredAuth(model)).toBe(true);
		expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: STORED });
	});

	it("rejects an empty token and a token with whitespace inside, storing nothing", async () => {
		const { authStorage } = registryOnDisk();
		await expect(authStorage.login("OMK", callbacks("   "))).rejects.toThrow("OMK account token is required");
		await expect(authStorage.login("OMK", callbacks("abc def"))).rejects.toThrow("must not contain whitespace");
		expect(authStorage.get("OMK")).toBeUndefined();
	});

	it("without a stored login the key comes from OMK_ACCOUNT_TOKEN; a stored login wins over it; /logout falls back", async () => {
		vi.stubEnv("OMK_ACCOUNT_TOKEN", FROM_ENV);
		const { registry, authStorage } = registryOnDisk();
		const model = registry.find("OMK", "reasoner");
		if (!model) throw new Error("OMK/reasoner missing");
		expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: FROM_ENV });
		await authStorage.login("OMK", callbacks(STORED));
		expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: STORED });
		authStorage.logout("OMK");
		expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: FROM_ENV });
	});

	it("with neither a login nor the env var there is no credential", () => {
		const { registry } = registryOnDisk();
		const model = registry.find("OMK", "coder");
		if (!model) throw new Error("OMK/coder missing");
		expect(registry.hasConfiguredAuth(model)).toBe(false);
	});

	it("flag off: no OMK login is registered and nothing about OMK appears", () => {
		const { registry } = registryOnDisk({});
		expect(getOAuthProvider("OMK")).toBeUndefined();
		expect(registry.find("OMK", "coder")).toBeUndefined();
	});
});
