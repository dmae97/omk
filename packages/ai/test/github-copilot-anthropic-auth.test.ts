import { afterEach, describe, expect, it, vi } from "bun:test";
import { buildAnthropicClientOptions, streamAnthropic } from "../src/providers/anthropic";
import type { Model } from "../src/types";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
};

function makeCopilotClaudeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		headers: { ...COPILOT_HEADERS },
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

const testContext = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
} as const;

function getRequestHeader(input: string | URL | Request, init: RequestInit | undefined, headerName: string): string | null {
	if (input instanceof Request) {
		return input.headers.get(headerName);
	}
	return new Headers(init?.headers).get(headerName);
}

describe("Anthropic Copilot auth config", () => {
	it("uses apiKey: null and Authorization Bearer for Copilot models", () => {
		const model = makeCopilotClaudeModel();
		const token = "ghu_test_token_12345";
		const options = buildAnthropicClientOptions({
			model,
			apiKey: token,
			extraBetas: ["interleaved-thinking-2025-05-14"],
			stream: true,
			dynamicHeaders: {
				"X-Initiator": "user",
				"Openai-Intent": "conversation-edits",
			},
		});

		expect(options.apiKey).toBeNull();
		expect(options.defaultHeaders.Authorization).toBe(`Bearer ${token}`);
	});

	it("derives baseURL from proxy endpoint token", () => {
		const model = makeCopilotClaudeModel();
		const token = "tid=2;proxy-ep=proxy.enterprise.githubcopilot.com;exp=9999999999";
		const options = buildAnthropicClientOptions({
			model,
			apiKey: token,
			extraBetas: [],
			stream: true,
			dynamicHeaders: {},
		});

		expect(options.baseURL).toBe("https://api.enterprise.githubcopilot.com");
	});
	it("includes Copilot static headers from model.headers", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			extraBetas: [],
			stream: true,
			dynamicHeaders: {},
		});

		expect(options.defaultHeaders["User-Agent"]).toContain("GitHubCopilotChat");
		expect(options.defaultHeaders["Copilot-Integration-Id"]).toBe("vscode-chat");
	});

	it("includes interleaved-thinking beta header when enabled", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			extraBetas: ["interleaved-thinking-2025-05-14"],
			stream: true,
			dynamicHeaders: {},
		});

		const beta = options.defaultHeaders["anthropic-beta"];
		expect(beta).toBeDefined();
		expect(beta).toContain("interleaved-thinking-2025-05-14");
	});

	it("does not include fine-grained-tool-streaming beta for Copilot", () => {
		const model = makeCopilotClaudeModel();
		const options = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			extraBetas: ["interleaved-thinking-2025-05-14"],
			stream: true,
			dynamicHeaders: {},
		});

		const beta = options.defaultHeaders["anthropic-beta"];
		if (beta) {
			expect(beta).not.toContain("fine-grained-tool-streaming");
		}
	});

	it("does not set isOAuthToken for Copilot models", () => {
		const model = makeCopilotClaudeModel();
		const result = buildAnthropicClientOptions({
			model,
			apiKey: "ghu_test",
			extraBetas: [],
			stream: true,
			dynamicHeaders: {},
		});

		expect(result.isOAuthToken).toBe(false);
	});

	it("forwards initiatorOverride to Copilot message requests", async () => {
		const requestedInitiators: Array<string | null> = [];
		global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			requestedInitiators.push(getRequestHeader(input, init, "X-Initiator"));
			return new Response(
				JSON.stringify({ error: { type: "authentication_error", message: "Unauthorized" } }),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const model = makeCopilotClaudeModel();
		const result = await streamAnthropic(model, testContext, {
			apiKey: "tid=2;proxy-ep=proxy.enterprise.githubcopilot.com;exp=9999999999",
			initiatorOverride: "agent",
		}).result();

		expect(result.stopReason).toBe("error");
		expect(requestedInitiators[0]).toBe("agent");
	});
});
