import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetOAuthProviders } from "omk-ai/oauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { ON_ENV } from "./omk-provider-flag-on-lib.ts";

/**
 * Where the order is decided (same for every provider):
 * - packages/coding-agent/src/core/auth-storage.ts:742-790, `AuthStorage.getApiKey`: runtime override (742) > stored
 *   api_key (757) > stored OAuth/`/login` credential (761) > built-in env var (784-785) > fallback resolver (790);
 * - packages/coding-agent/src/core/model-registry.ts:726-733, `getApiKeyAndHeaders`: the key from AuthStorage, else the
 *   provider's own `apiKey` config (`$ENV_VAR`, which is how OMK reads OMK_ACCOUNT_TOKEN).
 * So a stored login beats the env var for every provider, OMK included.
 */
interface Provider {
	id: string;
	envVar: string;
	registry: () => { registry: ModelRegistry; authStorage: AuthStorage };
}

const ENV_TOKEN = "env-token";
const OAUTH_TOKEN = "oauth-token";
const API_KEY_TOKEN = "stored-api-key";
const RUNTIME_TOKEN = "runtime-token";

function build(register: boolean): { registry: ModelRegistry; authStorage: AuthStorage } {
	const authStorage = AuthStorage.inMemory();
	const registry = ModelRegistry.create(authStorage, join(tmpdir(), `omk-order-${process.pid}`, "models.json"));
	if (register) registerOmkProviderIfEnabled(registry, ON_ENV);
	return { registry, authStorage };
}

const providers: Provider[] = [
	{ id: "opencode-go", envVar: "OPENCODE_API_KEY", registry: () => build(false) },
	{ id: "OMK", envVar: "OMK_ACCOUNT_TOKEN", registry: () => build(true) },
];

type Setup = (authStorage: AuthStorage, id: string) => void;
const oauth: Setup = (a, id) =>
	a.set(id, { type: "oauth", access: OAUTH_TOKEN, refresh: OAUTH_TOKEN, expires: Number.MAX_SAFE_INTEGER });
const apiKey: Setup = (a, id) => a.set(id, { type: "api_key", key: API_KEY_TOKEN });
const runtime: Setup = (a, id) => a.setRuntimeApiKey(id, RUNTIME_TOKEN);

const SOURCE_BY_TOKEN: Record<string, string> = {
	[ENV_TOKEN]: "env",
	[OAUTH_TOKEN]: "stored login",
	[API_KEY_TOKEN]: "stored api key",
	[RUNTIME_TOKEN]: "runtime override",
};

async function winner(provider: Provider, useEnv: boolean, setups: Setup[]): Promise<string> {
	vi.stubEnv(provider.envVar, useEnv ? ENV_TOKEN : "");
	const { registry, authStorage } = provider.registry();
	for (const setup of setups) setup(authStorage, provider.id);
	const model = registry.getAll().find((m) => m.provider === provider.id);
	if (!model) throw new Error(`no model for ${provider.id}`);
	// Nothing configured: opencode-go answers "no key", OMK's unresolved `$OMK_ACCOUNT_TOKEN` is an error; both are
	// "no credential", which is also what the prompt pre-check (hasConfiguredAuth) sees.
	if (!registry.hasConfiguredAuth(model)) return "none";
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	return auth.apiKey ? (SOURCE_BY_TOKEN[auth.apiKey] ?? "unknown") : "none";
}

afterEach(() => {
	vi.unstubAllEnvs();
	resetOAuthProviders();
});

describe("OMK credential order is the same as an existing provider's (opencode-go: stored login + env var)", () => {
	const cases: [string, boolean, Setup[], string][] = [
		["env var only", true, [], "env"],
		["stored login only", false, [oauth], "stored login"],
		["stored login and env var: the login wins", true, [oauth], "stored login"],
		["stored api key and env var: the stored key wins", true, [apiKey], "stored api key"],
		["stored login and stored api key: the api key wins", false, [oauth, apiKey], "stored api key"],
		["runtime override beats everything", true, [oauth, apiKey, runtime], "runtime override"],
		["nothing configured", false, [], "none"],
	];

	it.each(cases)("%s", async (_name, useEnv, setups, expected) => {
		const results = await Promise.all(providers.map((p) => winner(p, useEnv, setups)));
		expect(results).toEqual([expected, expected]);
	});

	it("after /logout the env var is used again, for both", async () => {
		for (const provider of providers) {
			vi.stubEnv(provider.envVar, ENV_TOKEN);
			const { registry, authStorage } = provider.registry();
			oauth(authStorage, provider.id);
			authStorage.logout(provider.id);
			const model = registry.getAll().find((m) => m.provider === provider.id);
			if (!model) throw new Error("model missing");
			expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({ ok: true, apiKey: ENV_TOKEN });
		}
	});
});
