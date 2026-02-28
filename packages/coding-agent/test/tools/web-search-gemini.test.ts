import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { AgentStorage } from "../../src/session/agent-storage";
import { searchGemini } from "../../src/web/search/providers/gemini";

type CapturedRequest = {
	body: Record<string, unknown> | null;
};

const SSE_RESPONSE =
	'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Gemini answer"}]}}],"modelVersion":"gemini-2.5-flash"}}\n\n';

describe("searchGemini tools serialization", () => {
	const originalFetch = globalThis.fetch;
	let capturedRequest: CapturedRequest | null = null;

	beforeEach(() => {
		capturedRequest = null;
		vi.spyOn(AgentStorage, "open").mockResolvedValue({
			listAuthCredentials: () => [
				{
					id: 1,
					credential: {
						type: "oauth",
						access: "test-access-token",
						expires: Date.now() + 600_000,
						projectId: "test-project",
					},
				},
			],
			updateAuthCredential: () => undefined,
		} as unknown as AgentStorage);

		globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
			capturedRequest = {
				body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
			};
			return new Response(SSE_RESPONSE, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}) as unknown as typeof fetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
		capturedRequest = null;
	});

	it("sends default googleSearch tool when no passthrough payloads are provided", async () => {
		await searchGemini({ query: "default tools" });

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.body?.request).toMatchObject({
			tools: [{ googleSearch: {} }],
		});
	});

	it("passes through google_search payload into googleSearch tool", async () => {
		await searchGemini({
			query: "google payload",
			google_search: { dynamicRetrievalConfig: { mode: "MODE_DYNAMIC" } },
		});

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.body?.request).toMatchObject({
			tools: [{ googleSearch: { dynamicRetrievalConfig: { mode: "MODE_DYNAMIC" } } }],
		});
	});

	it("includes codeExecution and urlContext tools when provided", async () => {
		await searchGemini({
			query: "extended tools",
			code_execution: {},
			url_context: { allowedDomains: ["example.com"] },
		});

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.body?.request).toMatchObject({
			tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: { allowedDomains: ["example.com"] } }],
		});
	});
});
