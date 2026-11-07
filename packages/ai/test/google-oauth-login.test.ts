import { afterEach, describe, expect, it, vi } from "vitest";
import { loginAntigravity } from "../src/utils/oauth/google-antigravity.ts";
import { loginGeminiCli } from "../src/utils/oauth/google-gemini-cli.ts";
import type { OAuthLoginCallbacks } from "../src/utils/oauth/types.ts";

const originalFetch = globalThis.fetch;

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

/** Stub every remote endpoint; the local callback server is hit with the real fetch. */
function stubGoogleNetwork() {
	for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
		vi.stubEnv(key, "");
	}
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			calls.push(request.url);
			if (url.hostname === "oauth2.googleapis.com") {
				expect(await request.text()).toContain("grant_type=authorization_code");
				return new Response(
					JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.pathname.endsWith(":loadCodeAssist")) {
				return new Response(
					JSON.stringify({
						cloudaicompanionProject: "fixture-project",
						allowedTiers: [{ id: "free-tier", isDefault: true }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.pathname.endsWith(":onboardUser")) {
				return new Response(
					JSON.stringify({ done: true, response: { cloudaicompanionProject: { id: "fixture-project" } } }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(JSON.stringify({ email: "fixture@example.com" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
	return calls;
}

function completeCallbackInBrowser(authUrl: string): Promise<Response> {
	const auth = new URL(authUrl);
	expect(auth.origin).toBe("https://accounts.google.com");
	const target = new URL(auth.searchParams.get("redirect_uri") ?? "");
	target.searchParams.set("code", "fixture-code");
	target.searchParams.set("state", auth.searchParams.get("state") ?? "");
	// The redirect_uri points at the local callback server; the stub must not see it.
	return originalFetch(target);
}

describe("Google OAuth login flows", () => {
	it("Antigravity: emits the browser URL before waiting, then completes the full pipeline", async () => {
		const calls = stubGoogleNetwork();
		let callbackResponse: Promise<Response> | undefined;
		const credentials = await loginAntigravity(
			callbacks(({ url }) => {
				callbackResponse = completeCallbackInBrowser(url);
			}),
		);
		const response = await callbackResponse;
		expect(response?.status).toBe(200);
		expect(await response?.text()).toContain("close this window");
		expect(credentials).toMatchObject({
			access: "fixture-access",
			refresh: "fixture-refresh",
			projectId: "fixture-project",
			email: "fixture@example.com",
		});
		expect(calls.filter((url) => url.includes(":loadCodeAssist"))).toHaveLength(1);
	});

	it("Gemini CLI: provisions a free-tier project when none exists", async () => {
		const calls = stubGoogleNetwork();
		let callbackResponse: Promise<Response> | undefined;
		const credentials = await loginGeminiCli(
			callbacks(({ url }) => {
				callbackResponse = completeCallbackInBrowser(url);
			}),
		);
		const response = await callbackResponse;
		expect(response?.status).toBe(200);
		expect(credentials).toMatchObject({
			access: "fixture-access",
			refresh: "fixture-refresh",
			projectId: "fixture-project",
			email: "fixture@example.com",
		});
		expect(calls.filter((url) => url.includes(":onboardUser"))).toHaveLength(1);
	});
});
