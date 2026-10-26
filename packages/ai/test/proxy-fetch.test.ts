import { createServer } from "node:http";
import { HttpsProxyAgent } from "https-proxy-agent";
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
		const connect = vi.spyOn(HttpsProxyAgent.prototype, "connect").mockRejectedValue(new Error("proxy unavailable"));
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(proxyAwareFetch("https://api.meta.ai/muse-code/key")).rejects.toThrow("proxy unavailable");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(connect).toHaveBeenCalledOnce();
	});

	it("rejects when a proxied response is interrupted after headers", async () => {
		resetProxyEnv();
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-length": "100" });
			response.write("partial");
			setTimeout(() => response.destroy(), 10);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Expected TCP listener");
			process.env.HTTP_PROXY = `http://127.0.0.1:${address.port}`;
			await expect(proxyAwareFetch("http://example.test/token")).rejects.toThrow();
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});
});
