import { afterEach, describe, expect, it } from "bun:test";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { geminiImageTool } from "@oh-my-pi/pi-coding-agent/tools/gemini-image";

const originalFetch = global.fetch;
const originalOpenRouterKey = Bun.env.OPENROUTER_API_KEY;

afterEach(() => {
	global.fetch = originalFetch;
	if (originalOpenRouterKey === undefined) {
		delete Bun.env.OPENROUTER_API_KEY;
	} else {
		Bun.env.OPENROUTER_API_KEY = originalOpenRouterKey;
	}
});

function getHeaderValue(headers: RequestInit["headers"] | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) {
		return headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase());
	}
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			if (key.toLowerCase() === name.toLowerCase()) {
				return value;
			}
		}
		return undefined;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) {
			return value;
		}
	}
	return undefined;
}

describe("geminiImageTool", () => {
	it("sets X-Title when routing image generation through OpenRouter", async () => {
		let requestHeaders: RequestInit["headers"] | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestHeaders = init?.headers;
			return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const ctx = {
			sessionManager: {
				getCwd: () => "/tmp",
			},
			modelRegistry: {
				getApiKeyForProvider: async () => undefined,
			},
		} as unknown as ToolSession;

		const result = await geminiImageTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		expect(result.content[0].type).toBe("text");
		expect(getHeaderValue(requestHeaders, "X-Title")).toBe("Oh-My-Pi");
	});
});
