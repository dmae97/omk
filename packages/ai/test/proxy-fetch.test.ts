import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyAwareFetch } from "../src/utils/proxy-fetch.ts";

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

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	resetProxyEnv();
	for (const [key, value] of originalEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("proxyAwareFetch", () => {
	it("uses global fetch when no proxy applies", async () => {
		resetProxyEnv();
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);

		const response = await proxyAwareFetch("https://api.meta.ai/muse-code/key", { method: "POST" });

		expect(await response.text()).toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not use global fetch when HTTPS_PROXY is set", async () => {
		resetProxyEnv();
		process.env.HTTPS_PROXY = "http://127.0.0.1:1";
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(proxyAwareFetch("https://api.meta.ai/muse-code/key")).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
