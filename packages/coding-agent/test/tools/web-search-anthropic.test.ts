import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { searchAnthropic } from "../../src/web/search/providers/anthropic";

type CapturedRequest = {
	url: string;
	headers: RequestInit["headers"];
	body: Record<string, unknown> | null;
};

const WEB_SEARCH_BETA = "web-search-2025-03-05";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

function makeAnthropicResponse() {
	return {
		id: "msg_test_123",
		model: "claude-haiku-4-5",
		content: [{ type: "text", text: "Test answer" }],
		usage: {
			input_tokens: 12,
			output_tokens: 7,
			server_tool_use: { web_search_requests: 1 },
		},
	};
}

function getHeaderCaseInsensitive(headers: RequestInit["headers"], name: string): string | undefined {
	if (!headers) return undefined;

	if (headers instanceof Headers) {
		return headers.get(name) ?? undefined;
	}

	if (Array.isArray(headers)) {
		const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
		return match?.[1];
	}

	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) {
			return value as string;
		}
	}

	return undefined;
}

describe("searchAnthropic headers", () => {
	const originalFetch = globalThis.fetch;
	const originalSearchApiKey = process.env.ANTHROPIC_SEARCH_API_KEY;
	const originalSearchBaseUrl = process.env.ANTHROPIC_SEARCH_BASE_URL;
	const originalApiKey = process.env.ANTHROPIC_API_KEY;
	const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

	let capturedRequest: CapturedRequest | null = null;

	beforeEach(() => {
		capturedRequest = null;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_BASE_URL;
		process.env.ANTHROPIC_SEARCH_BASE_URL = ANTHROPIC_BASE_URL;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		capturedRequest = null;

		if (originalSearchApiKey === undefined) {
			delete process.env.ANTHROPIC_SEARCH_API_KEY;
		} else {
			process.env.ANTHROPIC_SEARCH_API_KEY = originalSearchApiKey;
		}

		if (originalSearchBaseUrl === undefined) {
			delete process.env.ANTHROPIC_SEARCH_BASE_URL;
		} else {
			process.env.ANTHROPIC_SEARCH_BASE_URL = originalSearchBaseUrl;
		}

		if (originalApiKey === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = originalApiKey;
		}

		if (originalBaseUrl === undefined) {
			delete process.env.ANTHROPIC_BASE_URL;
		} else {
			process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
		}
	});

	function mockFetch(responseBody: unknown) {
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			capturedRequest = {
				url: typeof url === "string" ? url : url.toString(),
				headers: init?.headers,
				body: init?.body ? JSON.parse(init.body as string) : null,
			};

			return new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;
	}

	it("includes web-search beta header and sends API key in X-Api-Key mode", async () => {
		process.env.ANTHROPIC_SEARCH_API_KEY = "sk-ant-api-test";
		mockFetch(makeAnthropicResponse());

		await searchAnthropic({ query: "test api key mode" });

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.url).toBe(`${ANTHROPIC_BASE_URL}/v1/messages?beta=true`);
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "anthropic-beta")).toContain(WEB_SEARCH_BETA);
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "x-api-key")).toBe("sk-ant-api-test");
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "authorization")).toBeUndefined();
		expect(capturedRequest?.body?.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
	});

	it("includes web-search beta header and sends OAuth token in Authorization mode", async () => {
		process.env.ANTHROPIC_SEARCH_API_KEY = "sk-ant-oat-test";
		mockFetch(makeAnthropicResponse());

		await searchAnthropic({ query: "test oauth mode" });

		expect(capturedRequest).not.toBeNull();
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "anthropic-beta")).toContain(WEB_SEARCH_BETA);
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "authorization")).toBe("Bearer sk-ant-oat-test");
		expect(getHeaderCaseInsensitive(capturedRequest?.headers, "x-api-key")).toBeUndefined();
	});
});
