import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthProviders } from "../src/utils/oauth/index.ts";
import {
	loginMeta,
	META_CLIENT_ID,
	META_OAUTH_PROVIDER_ID,
	metaOAuthProvider,
	refreshMetaToken,
} from "../src/utils/oauth/meta.ts";
import type { OAuthLoginCallbacks } from "../src/utils/oauth/types.ts";

const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of PROXY_ENV_KEYS) {
	originalEnv.set(key, process.env[key]);
}

function resetProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) {
		delete process.env[key];
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function urlOf(input: unknown): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (input instanceof Request) return input.url;
	throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function callbacks(overrides: Partial<OAuthLoginCallbacks> = {}): OAuthLoginCallbacks {
	return {
		onAuth: vi.fn(),
		onDeviceCode: vi.fn(),
		onPrompt: vi.fn(),
		onSelect: vi.fn(),
		...overrides,
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	resetProxyEnv();
	for (const [key, value] of originalEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("Muse Code OAuth registry", () => {
	it("registers Meta as a built-in subscription provider", () => {
		const provider = getOAuthProviders().find((entry) => entry.id === META_OAUTH_PROVIDER_ID);
		expect(provider?.id).toBe("meta");
		expect(provider?.name).toBe("Muse Code (subscription)");
	});
});

describe("Muse Code device login", () => {
	it("mints a Model API key after device authorization", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://auth.meta.com/device",
					verification_uri_complete: "https://auth.meta.com/device?user_code=ABCD-EFGH",
					expires_in: 900,
					interval: 5,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "dca:identity",
					refresh_token: "rt-1",
					expires_in: 3600,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					api_key: "muse-sub-key",
					user_email: "dev@example.com",
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		const onDeviceCode = vi.fn();
		const credentials = await loginMeta(callbacks({ onDeviceCode }));

		expect(onDeviceCode).toHaveBeenCalledWith({
			userCode: "ABCD-EFGH",
			verificationUri: "https://auth.meta.com/device?user_code=ABCD-EFGH",
			intervalSeconds: 5,
			expiresInSeconds: 900,
		});
		expect(credentials.access).toBe("muse-sub-key");
		expect(credentials.refresh).toBe("dca:identity");
		expect(credentials.metaRefreshToken).toBe("rt-1");
		expect(credentials.userEmail).toBe("dev@example.com");
		expect(credentials.expires).toBeGreaterThan(Date.now());

		const authorize = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
		expect(urlOf(fetchMock.mock.calls[0]?.[0])).toBe("https://auth.meta.com/oidc/device/authorization/");
		expect(authorize.headers.get("User-Agent")).toBe("muse-code/launcher-2");
		expect(await authorize.text()).toBe(`client_id=${META_CLIENT_ID}`);

		const mint = new Request(fetchMock.mock.calls[2]?.[0] ?? "", fetchMock.mock.calls[2]?.[1]);
		expect(urlOf(fetchMock.mock.calls[2]?.[0])).toBe("https://api.meta.ai/muse-code/key");
		expect(mint.headers.get("Authorization")).toBe("Bearer dca:identity");
		expect(mint.headers.get("User-Agent")).toBe("muse-code/1.0.2");
		expect(mint.headers.get("x-api-version")).toBe("1.0.0");
		expect(mint.headers.get("x-client-id")).toBe("tbh:tui");
		expect(JSON.parse(await mint.text())).toEqual({ dca_token: "dca:identity" });
	});

	it("honors HTTPS_PROXY instead of the global fetch stub", async () => {
		process.env.HTTPS_PROXY = "http://127.0.0.1:1";
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
		vi.stubGlobal("fetch", fetchMock);

		await expect(loginMeta(callbacks())).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects an untrusted verification URI", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValueOnce(
				jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-EFGH",
					verification_uri: "https://evil.example/device",
					expires_in: 900,
					interval: 5,
				}),
			),
		);

		await expect(loginMeta(callbacks())).rejects.toThrow("untrusted verification URI");
	});

	it("names the billing setup URL when Meta withholds the key", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValueOnce(
				jsonResponse({
					require_payment: true,
					action_url: "https://ai.developer.meta.com/billing",
				}),
			),
		);

		await expect(
			refreshMetaToken({
				access: "stale-key",
				refresh: "dca:identity",
				expires: 1,
			}),
		).rejects.toThrow("https://ai.developer.meta.com/billing");
	});
});

describe("Muse Code token refresh", () => {
	it("re-mints the Model API key from the stored identity token", async () => {
		vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ api_key: "muse-sub-key-2" })));

		const refreshed = await refreshMetaToken({
			access: "old-key",
			refresh: "dca:identity",
			expires: 1,
			metaRefreshToken: "rt-1",
		});

		expect(refreshed.access).toBe("muse-sub-key-2");
		expect(refreshed.refresh).toBe("dca:identity");
		expect(refreshed.metaRefreshToken).toBe("rt-1");
	});

	it("renews an expired identity with the OAuth refresh token", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ title: "Unauthorized" }, 401))
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "dca:new-identity",
					refresh_token: "rt-2",
					expires_in: 3600,
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ api_key: "muse-sub-key-3" }));
		vi.stubGlobal("fetch", fetchMock);

		const refreshed = await refreshMetaToken({
			access: "old-key",
			refresh: "dca:stale-identity",
			expires: 1,
			metaRefreshToken: "rt-1",
		});

		expect(refreshed.access).toBe("muse-sub-key-3");
		expect(refreshed.refresh).toBe("dca:new-identity");
		expect(refreshed.metaRefreshToken).toBe("rt-2");
		expect(urlOf(fetchMock.mock.calls[1]?.[0])).toBe("https://auth.meta.com/oidc/device/token/");
	});
});

describe("Muse Code model headers", () => {
	it("stamps Muse CLI headers on meta models without changing other providers", () => {
		const models = [
			{
				id: "muse-spark-1.3",
				name: "Muse Spark 1.3",
				api: "openai-responses" as const,
				provider: "meta",
				baseUrl: "https://api.meta.ai/v1",
				reasoning: true,
				input: ["text" as const],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
			{
				id: "gpt-x",
				name: "gpt-x",
				api: "openai-completions" as const,
				provider: "openai",
				baseUrl: "https://example.com/v1",
				reasoning: false,
				input: ["text" as const],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
		];
		const stamped = metaOAuthProvider.modifyModels?.(models, {
			access: "k",
			refresh: "r",
			expires: 1,
		});
		expect(stamped?.[0]?.headers).toEqual({
			"User-Agent": "muse-code/1.0.2",
			"x-api-version": "1.0.0",
			"x-client-id": "tbh:tui",
		});
		expect(stamped?.[1]?.headers).toBeUndefined();
	});
});
