import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshKimiToken } from "../src/utils/oauth/kimi.ts";

describe("Kimi OAuth token refresh", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("bounds the request, because callers hold a refresh lock across it", async () => {
		const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
			Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const refreshed = await refreshKimiToken("old-refresh");

		expect(refreshed).toMatchObject({ access: "new-access", refresh: "new-refresh" });
		expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});
});
