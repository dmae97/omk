import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GoogleOAuthFlowConfig, runGoogleOAuthLogin } from "../src/utils/oauth/google-oauth-shared.ts";
import type { OAuthLoginCallbacks } from "../src/utils/oauth/types.ts";

const localFetch = globalThis.fetch;
const config: GoogleOAuthFlowConfig = {
	clientId: "fixture-client",
	clientSecret: "fixture-secret",
	authUrl: "https://accounts.google.com/o/oauth2/auth",
	tokenUrl: "https://oauth2.googleapis.com/token",
	scopes: ["email"],
	callbackPort: 0,
	callbackPath: "/oauth/callback",
	discoverProject: async () => "fixture-project",
};

function callbacks(onAuth: OAuthLoginCallbacks["onAuth"], signal?: AbortSignal): OAuthLoginCallbacks {
	return { onAuth, signal, onPrompt: async () => "", onSelect: async () => undefined, onDeviceCode: () => {} };
}

function target(authUrl: string): URL {
	const auth = new URL(authUrl);
	const url = new URL(auth.searchParams.get("redirect_uri") ?? "");
	url.searchParams.set("state", auth.searchParams.get("state") ?? "");
	url.searchParams.set("code", "fixture-code");
	return url;
}

function stubNetwork() {
	for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
		vi.stubEnv(key, "");
	}
	const codes: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			if (request.url === config.tokenUrl) {
				codes.push(new URLSearchParams(await request.text()).get("code") ?? "");
				return Response.json({
					access_token: "fixture-access",
					refresh_token: "fixture-refresh",
					expires_in: 3600,
				});
			}
			if (request.url === "https://www.googleapis.com/oauth2/v1/userinfo?alt=json") {
				return Response.json({ email: "fixture@example.com" });
			}
			throw new Error("Unexpected remote endpoint");
		}),
	);
	return codes;
}

beforeEach(async () => {
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const address = probe.address();
	if (!address || typeof address === "string") throw new Error("Expected TCP listener");
	config.callbackPort = address.port;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe("Google OAuth callback ownership", () => {
	it.each(["wrong", "missing"])("rejects %s state and still accepts the legitimate callback", async (state) => {
		const codes = stubNetwork();
		let browser: Promise<number> | undefined;
		const credentials = await runGoogleOAuthLogin(
			callbacks(({ url }) => {
				browser = (async () => {
					const invalid = target(url);
					invalid.searchParams.set("code", "foreign-code");
					if (state === "missing") invalid.searchParams.delete("state");
					else invalid.searchParams.set("state", "wrong-state");
					const response = await localFetch(invalid);
					await response.text();
					if (response.status === 400) await (await localFetch(target(url))).text();
					return response.status;
				})();
			}),
			config,
		);
		expect(await browser).toBe(400);
		expect(codes).toEqual(["fixture-code"]);
		expect(credentials.projectId).toBe("fixture-project");
	});

	it("rejects an already-aborted login before opening a browser", async () => {
		stubNetwork();
		let browser: Promise<Response> | undefined;
		const onAuth = vi.fn(({ url }: { url: string }) => {
			browser = localFetch(target(url));
		});
		try {
			await expect(runGoogleOAuthLogin(callbacks(onAuth, AbortSignal.abort()), config)).rejects.toThrow();
			expect(onAuth).not.toHaveBeenCalled();
		} finally {
			await browser;
		}
	});

	it("cancels a browser wait, releases the listener and never exchanges a code", async () => {
		const codes = stubNetwork();
		const controller = new AbortController();
		let callbackUrl: URL | undefined;
		let shown: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			shown = resolve;
		});
		const login = runGoogleOAuthLogin(
			callbacks(({ url }) => {
				callbackUrl = target(url);
				shown();
			}, controller.signal),
			config,
		);
		const outcome = login.then(
			() => "completed",
			() => "cancelled",
		);
		await ready;
		controller.abort();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			expect(
				await Promise.race([
					outcome,
					new Promise<string>((resolve) => {
						timer = setTimeout(() => resolve("still-waiting"), 200);
					}),
				]),
			).toBe("cancelled");
			expect(codes).toEqual([]);
			if (!callbackUrl) throw new Error("Browser URL was not shown");
			await expect(localFetch(callbackUrl)).rejects.toThrow();
		} finally {
			clearTimeout(timer);
			// Release the old implementation's listener on an expected RED run.
			if (callbackUrl)
				await localFetch(callbackUrl).then(
					(response) => response.text(),
					() => undefined,
				);
			await outcome;
		}
	});

	it("shows a real ephemeral port when configured with port zero", async () => {
		stubNetwork();
		let browser: Promise<Response> | undefined;
		await runGoogleOAuthLogin(
			callbacks(({ url }) => {
				const callbackUrl = target(url);
				expect(Number(callbackUrl.port)).toBeGreaterThan(0);
				browser = localFetch(callbackUrl);
			}),
			{ ...config, callbackPort: 0 },
		);
		expect((await browser)?.status).toBe(200);
	});

	it("ends a denied login without exchanging a code", async () => {
		const codes = stubNetwork();
		let browser: Promise<Response> | undefined;
		const login = runGoogleOAuthLogin(
			callbacks(({ url }) => {
				const denied = target(url);
				denied.searchParams.set("error", "access_denied");
				browser = localFetch(denied);
			}),
			config,
		);
		await expect(login).rejects.toThrow("Login cancelled or timed out");
		expect((await browser)?.status).toBe(400);
		expect(codes).toEqual([]);
	});

	it("rejects other paths and POST requests without consuming the login", async () => {
		stubNetwork();
		let browser: Promise<void> | undefined;
		await runGoogleOAuthLogin(
			callbacks(({ url }) => {
				browser = (async () => {
					const wrongPath = target(url);
					wrongPath.pathname += "-foreign";
					expect((await localFetch(wrongPath)).status).toBe(404);
					expect((await localFetch(target(url), { method: "POST" })).status).toBe(404);
					await (await localFetch(target(url))).text();
				})();
			}),
			config,
		);
		await browser;
	});

	it("releases the callback server if the browser hook throws", async () => {
		let callbackUrl: URL | undefined;
		await expect(
			runGoogleOAuthLogin(
				callbacks(({ url }) => {
					callbackUrl = target(url);
					throw new Error("Browser unavailable");
				}),
				config,
			),
		).rejects.toThrow("Browser unavailable");
		if (!callbackUrl) throw new Error("Browser URL was not shown");
		await expect(localFetch(callbackUrl)).rejects.toThrow();
	});

	it("expires a browser wait after five minutes and closes the port", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let callbackUrl: URL | undefined;
		await expect(
			runGoogleOAuthLogin(
				callbacks(({ url }) => {
					callbackUrl = target(url);
					vi.advanceTimersByTime(5 * 60 * 1000);
				}),
				config,
			),
		).rejects.toThrow("Login cancelled or timed out");
		vi.useRealTimers();
		if (!callbackUrl) throw new Error("Browser URL was not shown");
		await expect(localFetch(callbackUrl)).rejects.toThrow();
	});

	it("rejects a non-Google token destination before opening the browser", async () => {
		const onAuth = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			runGoogleOAuthLogin(callbacks(onAuth), {
				...config,
				tokenUrl: "https://untrusted.invalid/token",
			}),
		).rejects.toThrow("Unsupported Google token endpoint");
		expect(onAuth).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reports an invalid listener configuration without opening the browser", async () => {
		const onAuth = vi.fn();
		await expect(runGoogleOAuthLogin(callbacks(onAuth), { ...config, callbackPort: -1 })).rejects.toThrow();
		expect(onAuth).not.toHaveBeenCalled();
	});

	it("uses the actual random callback port when the preferred port is occupied", async () => {
		stubNetwork();
		const occupied = createServer();
		await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
		const address = occupied.address();
		if (!address || typeof address === "string") throw new Error("Expected TCP listener");
		let browser: Promise<Response> | undefined;
		let actualPort = "";
		try {
			await runGoogleOAuthLogin(
				callbacks(({ url }) => {
					const callbackUrl = target(url);
					actualPort = callbackUrl.port;
					browser = localFetch(callbackUrl);
				}),
				{ ...config, callbackPort: address.port },
			);
			expect((await browser)?.status).toBe(200);
			expect(actualPort).not.toBe(String(address.port));
		} finally {
			await new Promise<void>((resolve) => occupied.close(() => resolve()));
		}
	});
});
