import { afterEach, describe, expect, it, vi } from "bun:test";
import { hookFetch } from "@oh-my-pi/pi-utils";
import { AgentStorage } from "../../src/session/agent-storage";
import { searchCodex } from "../../src/web/search/providers/codex";

type CapturedRequest = {
	url: string;
	headers: RequestInit["headers"];
	body: Record<string, unknown> | null;
};

const originalCodexSearchModel = process.env.PI_CODEX_WEB_SEARCH_MODEL;

function makeSseResponse(model: string): string {
	return [
		`data: ${JSON.stringify({
			type: "response.output_item.done",
			item: {
				type: "message",
				content: [
					{
						type: "output_text",
						text: "Codex answer",
						annotations: [{ type: "url_citation", url: "https://example.com/article", title: "Example Article" }],
					},
				],
			},
		})}`,
		"",
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				id: "resp_codex_test",
				model,
				usage: {
					input_tokens: 12,
					output_tokens: 7,
					total_tokens: 19,
				},
			},
		})}`,
		"",
	].join("\n");
}

describe("searchCodex model selection", () => {
	let capturedRequest: CapturedRequest | null = null;

	function mockCodexFetch(responseModel: string): Disposable {
		capturedRequest = null;
		vi.spyOn(AgentStorage, "open").mockResolvedValue({
			listAuthCredentials: () => [
				{
					id: 1,
					credential: {
						type: "oauth",
						access: "test-access-token",
						expires: Date.now() + 600_000,
						accountId: "acct-test",
					},
				},
			],
		} as unknown as AgentStorage);
		return hookFetch((url, init) => {
			capturedRequest = {
				url: typeof url === "string" ? url : url.toString(),
				headers: init?.headers,
				body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
			};
			return new Response(makeSseResponse(responseModel), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});
	}

	afterEach(() => {
		vi.restoreAllMocks();
		capturedRequest = null;
		if (originalCodexSearchModel === undefined) {
			delete process.env.PI_CODEX_WEB_SEARCH_MODEL;
		} else {
			process.env.PI_CODEX_WEB_SEARCH_MODEL = originalCodexSearchModel;
		}
	});

	it("uses the built-in default model when PI_CODEX_WEB_SEARCH_MODEL is unset", async () => {
		delete process.env.PI_CODEX_WEB_SEARCH_MODEL;
		using _hook = mockCodexFetch("gpt-5-codex-mini");

		const result = await searchCodex({ query: "default codex model" });

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.url).toBe("https://chatgpt.com/backend-api/codex/responses");
		expect(capturedRequest?.body?.model).toBe("gpt-5-codex-mini");
		expect(result.model).toBe("gpt-5-codex-mini");
		expect(result.sources).toEqual([{ title: "Example Article", url: "https://example.com/article" }]);
	});

	it("falls back to the default model when PI_CODEX_WEB_SEARCH_MODEL is blank", async () => {
		process.env.PI_CODEX_WEB_SEARCH_MODEL = "   ";
		using _hook = mockCodexFetch("gpt-5-codex-mini");

		const result = await searchCodex({ query: "blank codex model" });

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.body?.model).toBe("gpt-5-codex-mini");
		expect(result.model).toBe("gpt-5-codex-mini");
	});

	it("uses PI_CODEX_WEB_SEARCH_MODEL when provided", async () => {
		process.env.PI_CODEX_WEB_SEARCH_MODEL = "gpt-5.4-mini";
		using _hook = mockCodexFetch("gpt-5.4-mini");

		const result = await searchCodex({ query: "overridden codex model" });

		expect(capturedRequest).not.toBeNull();
		expect(capturedRequest?.body?.model).toBe("gpt-5.4-mini");
		expect(result.model).toBe("gpt-5.4-mini");
	});
});
