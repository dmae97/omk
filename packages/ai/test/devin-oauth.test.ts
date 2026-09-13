import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devinOAuthProvider, loginDevin } from "../src/utils/oauth/devin.ts";
import type { OAuthLoginCallbacks } from "../src/utils/oauth/types.ts";

const originalFetch = globalThis.fetch;
const fixtureToken = `header.${Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString("base64url")}.fixture`;
const callbacks = (onAuth: OAuthLoginCallbacks["onAuth"]): OAuthLoginCallbacks => ({
	onAuth,
	onPrompt: vi.fn(async () => ""),
	onSelect: vi.fn(async () => undefined),
	onDeviceCode: vi.fn(),
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function tokenEndpoint(status = 200, body: unknown = { token: fixtureToken }) {
	vi.stubEnv("HTTPS_PROXY", "");
	vi.stubEnv("HTTP_PROXY", "");
	vi.stubEnv("ALL_PROXY", "");
	vi.stubEnv("https_proxy", "");
	vi.stubEnv("http_proxy", "");
	vi.stubEnv("all_proxy", "");
	return vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			expect(request.url).toBe("https://api.devin.ai/auth/cli/token");
			expect(request.redirect).toBe("error");
			expect(await request.json()).toMatchObject({ code: "fixture-code", code_verifier: expect.any(String) });
			return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
		}),
	);
}

function redirect(authUrl: string, state?: string) {
	const auth = new URL(authUrl);
	expect(auth.origin).toBe("https://app.devin.ai");
	expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
	const target = new URL(auth.searchParams.get("redirect_uri") ?? "");
	target.searchParams.set("code", "fixture-code");
	target.searchParams.set("state", state ?? auth.searchParams.get("state") ?? "");
	return target;
}

describe("Devin CLI subscription login", () => {
	it("shows the browser URL before waiting and binds the token exchange to PKCE", async () => {
		tokenEndpoint();
		let response: Promise<Response> | undefined;
		let target: URL | undefined;
		const auth = await loginDevin(
			callbacks(({ url }) => {
				target = redirect(url);
				response = originalFetch(target);
			}),
			{ port: 0, timeoutMs: 1500 },
		);
		expect((await response)?.status).toBe(200);
		expect(auth.access).toBe(`devin-session-token$${fixtureToken}`);
		expect(auth.refresh).toBe(auth.access);
		expect(auth.expires).toBe(4_000_000_000_000 - 30_000);
		expect(devinOAuthProvider.getApiKey(auth)).toBe(auth.access);
		await expect(originalFetch(target!)).rejects.toThrow();
	});

	it("rejects a bad state without accepting its code or poisoning the real callback", async () => {
		tokenEndpoint();
		let callbackRequests: Promise<void> | undefined;
		const auth = await loginDevin(
			callbacks(({ url }) => {
				callbackRequests = (async () => {
					expect((await originalFetch(redirect(url, "wrong-state"))).status).toBe(400);
					expect((await originalFetch(redirect(url))).status).toBe(200);
				})();
			}),
			{ port: 0, timeoutMs: 1500 },
		);
		await callbackRequests;
		expect(auth.access).toContain("devin-session-token$");
	});

	it("cancels a browser wait and releases the listener", async () => {
		const controller = new AbortController();
		let target: URL | undefined;
		const options = callbacks(({ url }) => {
			target = redirect(url);
			controller.abort();
		});
		options.signal = controller.signal;
		await expect(loginDevin(options, { port: 0, timeoutMs: 1500 })).rejects.toThrow();
		await expect(originalFetch(target!)).rejects.toThrow();
	});

	it("rejects an already-aborted login before showing a URL", async () => {
		const onAuth = vi.fn();
		await expect(loginDevin({ ...callbacks(onAuth), signal: AbortSignal.abort() }, { port: 0 })).rejects.toThrow();
		expect(onAuth).not.toHaveBeenCalled();
	});

	it("times out the browser wait and closes the callback port", async () => {
		let target: URL | undefined;
		await expect(
			loginDevin(
				callbacks(({ url }) => {
					target = redirect(url);
				}),
				{ port: 0, timeoutMs: 50 },
			),
		).rejects.toThrow();
		await expect(originalFetch(target!)).rejects.toThrow();
	});

	it("uses a validated manual callback when the port is occupied", async () => {
		tokenEndpoint();
		const occupied = createServer();
		await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
		const address = occupied.address();
		if (!address || typeof address === "string") throw new Error("Expected TCP address");
		let url = "";
		try {
			const options = callbacks((info) => {
				url = info.url;
			});
			options.onPrompt = async () => redirect(url).toString();
			const auth = await loginDevin(options, { port: address.port, timeoutMs: 1500 });
			expect(auth.access).toBe(`devin-session-token$${fixtureToken}`);
			options.onPrompt = async () => redirect(url, "bad-state").toString();
			await expect(loginDevin(options, { port: address.port, timeoutMs: 1500 })).rejects.toThrow(/state mismatch/);
		} finally {
			await new Promise<void>((resolve) => occupied.close(() => resolve()));
		}
	});

	it("does not expose remote token-exchange error bodies", async () => {
		tokenEndpoint(401, { error: fixtureToken });
		let callbackRequest: Promise<Response> | undefined;
		await expect(
			loginDevin(
				callbacks(({ url }) => {
					callbackRequest = originalFetch(redirect(url));
				}),
				{ port: 0, timeoutMs: 1500 },
			),
		).rejects.toThrow("Devin token exchange failed (HTTP 401)");
		await callbackRequest;
	});

	it("does not pretend that an expired credential was refreshed", async () => {
		await expect(
			devinOAuthProvider.refreshToken({ access: fixtureToken, refresh: fixtureToken, expires: 1 }),
		).rejects.toThrow(/\/login devin/);
	});
});
