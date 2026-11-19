import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginKimiCode, refreshKimiToken } from "../src/utils/oauth/kimi.ts";
import type { OAuthLoginCallbacks } from "../src/utils/oauth/types.ts";

const DEVICE_ENDPOINT = "https://auth.kimi.com/api/oauth/device_authorization";
const TOKEN_ENDPOINT = "https://auth.kimi.com/api/oauth/token";
const VERIFICATION_URI = "https://www.kimi.com/code/authorize_device";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function devicePayload(): Record<string, unknown> {
	return {
		device_code: "device-code",
		user_code: "K4BG-V0WB",
		verification_uri: VERIFICATION_URI,
		verification_uri_complete: `${VERIFICATION_URI}?user_code=K4BG-V0WB`,
		expires_in: 1800,
		interval: 5,
	};
}

/** Keep the device-id file out of the real agent directory. */
let agentDir: string;

function callbacks(overrides: Partial<OAuthLoginCallbacks> = {}): OAuthLoginCallbacks {
	return {
		onAuth: vi.fn(),
		onDeviceCode: vi.fn(),
		onPrompt: vi.fn(async () => ""),
		onSelect: vi.fn(async () => undefined),
		signal: new AbortController().signal,
		...overrides,
	};
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-kimi-oauth-"));
	vi.stubEnv("OMK_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("Kimi Code device authorization", () => {
	it("posts to the live /api/oauth endpoints without a scope", async () => {
		// Given: the device authorization and token endpoints accept the request.
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse(devicePayload()))
			.mockResolvedValueOnce(
				jsonResponse({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const onAuth = vi.fn();

		// When: the login runs.
		const credentials = await loginKimiCode(callbacks({ onAuth }));

		// Then: the old `/oauth2/device/code` path, which answers 404 from nginx, is gone.
		const deviceRequest = fetchMock.mock.calls[0];
		expect(String(deviceRequest?.[0])).toBe(DEVICE_ENDPOINT);
		const form = new URLSearchParams(String((deviceRequest?.[1] as RequestInit | undefined)?.body));
		expect(form.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
		expect(form.get("device_id")).toEqual(expect.any(String));
		// The endpoint answers `invalid_scope` for every value, including `openid`.
		expect(form.has("scope")).toBe(false);

		expect(String(fetchMock.mock.calls[1]?.[0])).toBe(TOKEN_ENDPOINT);
		expect(onAuth).toHaveBeenCalledWith(expect.objectContaining({ url: `${VERIFICATION_URI}?user_code=K4BG-V0WB` }));
		expect(credentials).toMatchObject({ access: "access-token", refresh: "refresh-token" });
	});

	it("surfaces a 404 error page instead of a JSON parse failure", async () => {
		// Given: the endpoint moved and nginx answers with HTML.
		vi.stubGlobal(
			"fetch",
			vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					new Response("<html>\n<head><title>404 Not Found</title></head>\n</html>", { status: 404 }),
				),
		);

		// When/Then: the failure names the status and keeps the body readable.
		await expect(loginKimiCode(callbacks())).rejects.toThrow(/Kimi device authorization failed: 404/u);
	});

	it("surfaces a non-JSON token response instead of a parse error", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(jsonResponse(devicePayload()))
				.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
		);

		await expect(loginKimiCode(callbacks())).rejects.toThrow(/Kimi token polling failed: 502/u);
	});

	it("refreshes against the same /api/oauth token endpoint", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ access_token: "next-access", refresh_token: "next-refresh" }));
		vi.stubGlobal("fetch", fetchMock);

		const credentials = await refreshKimiToken("refresh-token");

		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(TOKEN_ENDPOINT);
		expect(credentials).toMatchObject({ access: "next-access", refresh: "next-refresh" });
	});
});
