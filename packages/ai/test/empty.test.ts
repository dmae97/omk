import { describe, expect, it } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-ai/models";
import { complete } from "@oh-my-pi/pi-ai/stream";
import type { Api, AssistantMessage, Context, Model, OptionsForApi, UserMessage } from "@oh-my-pi/pi-ai/types";
import { e2eApiKey, resolveApiKey } from "./oauth";

// Resolve OAuth tokens at module level (async, runs before tests)
const oauthTokens = await Promise.all([
	resolveApiKey("anthropic"),
	resolveApiKey("github-copilot"),
	resolveApiKey("google-gemini-cli"),
	resolveApiKey("google-antigravity"),
	resolveApiKey("openai-codex"),
]);
const [anthropicOAuthToken, githubCopilotToken, geminiCliToken, antigravityToken, openaiCodexToken] = oauthTokens;

async function testEmptyMessage<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Test with completely empty content array
	const emptyMessage: UserMessage = {
		role: "user",
		content: [],
		timestamp: Date.now(),
	};

	const context: Context = {
		messages: [emptyMessage],
	};

	const response = await complete(llm, context, options);

	// Should either handle gracefully or return an error
	expect(response).toBeDefined();
	expect(response.role).toBe("assistant");
	// Should handle empty string gracefully
	if (response.stopReason === "error") {
		expect(response.errorMessage).toBeDefined();
	} else {
		expect(response.content).toBeDefined();
	}
}

async function testEmptyStringMessage<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Test with empty string content
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "",
				timestamp: Date.now(),
			},
		],
	};

	const response = await complete(llm, context, options);

	expect(response).toBeDefined();
	expect(response.role).toBe("assistant");

	// Should handle empty string gracefully
	if (response.stopReason === "error") {
		expect(response.errorMessage).toBeDefined();
	} else {
		expect(response.content).toBeDefined();
	}
}

async function testWhitespaceOnlyMessage<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Test with whitespace-only content
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "   \n\t  ",
				timestamp: Date.now(),
			},
		],
	};

	const response = await complete(llm, context, options);

	expect(response).toBeDefined();
	expect(response.role).toBe("assistant");

	// Should handle whitespace-only gracefully
	if (response.stopReason === "error") {
		expect(response.errorMessage).toBeDefined();
	} else {
		expect(response.content).toBeDefined();
	}
}

async function testEmptyAssistantMessage<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Test with empty assistant message in conversation flow
	// User -> Empty Assistant -> User
	const emptyAssistant: AssistantMessage = {
		role: "assistant",
		content: [],
		api: llm.api,
		provider: llm.provider,
		model: llm.id,
		usage: {
			input: 10,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};

	const context: Context = {
		messages: [
			{
				role: "user",
				content: "Hello, how are you?",
				timestamp: Date.now(),
			},
			emptyAssistant,
			{
				role: "user",
				content: "Please respond this time.",
				timestamp: Date.now(),
			},
		],
	};

	const response = await complete(llm, context, options);

	expect(response).toBeDefined();
	expect(response.role).toBe("assistant");

	// Should handle empty assistant message in context gracefully
	if (response.stopReason === "error") {
		expect(response.errorMessage).toBeDefined();
	} else {
		expect(response.content).toBeDefined();
		expect(response.content.length).toBeGreaterThan(0);
	}
}

describe("AI Providers Empty Message Tests", () => {
	describe.skipIf(!e2eApiKey("GEMINI_API_KEY"))("Google Provider Empty Messages", () => {
		const llm = getBundledModel("google", "gemini-2.5-flash");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("OPENAI_API_KEY"))("OpenAI Completions Provider Empty Messages", () => {
		const llm = getBundledModel("openai", "gpt-4o-mini");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("OPENAI_API_KEY"))("OpenAI Responses Provider Empty Messages", () => {
		const llm = getBundledModel("openai", "gpt-5-mini");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("ANTHROPIC_API_KEY"))("Anthropic Provider Empty Messages", () => {
		const llm = getBundledModel("anthropic", "claude-haiku-4-5-20251001");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("XAI_API_KEY"))("xAI Provider Empty Messages", () => {
		const llm = getBundledModel("xai", "grok-3");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("GROQ_API_KEY"))("Groq Provider Empty Messages", () => {
		const llm = getBundledModel("groq", "openai/gpt-oss-20b");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("CEREBRAS_API_KEY"))("Cerebras Provider Empty Messages", () => {
		const llm = getBundledModel("cerebras", "gpt-oss-120b");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("ZAI_API_KEY"))("zAI Provider Empty Messages", () => {
		const llm = getBundledModel("zai", "glm-4.5-air");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe.skipIf(!e2eApiKey("MISTRAL_API_KEY"))("Mistral Provider Empty Messages", () => {
		const llm = getBundledModel("mistral", "devstral-medium-latest");

		it(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);

		it(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm);
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe("Anthropic OAuth Provider Empty Messages", () => {
		const llm = getBundledModel("anthropic", "claude-haiku-4-5-20251001");

		it.skipIf(!anthropicOAuthToken)(
			"should handle empty content array",
			async () => {
				await testEmptyMessage(llm, { apiKey: anthropicOAuthToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!anthropicOAuthToken)(
			"should handle empty string content",
			async () => {
				await testEmptyStringMessage(llm, { apiKey: anthropicOAuthToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!anthropicOAuthToken)(
			"should handle whitespace-only content",
			async () => {
				await testWhitespaceOnlyMessage(llm, { apiKey: anthropicOAuthToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!anthropicOAuthToken)(
			"should handle empty assistant message in conversation",
			async () => {
				await testEmptyAssistantMessage(llm, { apiKey: anthropicOAuthToken });
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe("GitHub Copilot Provider Empty Messages", () => {
		it.skipIf(!githubCopilotToken)(
			"gpt-4o - should handle empty content array",
			async () => {
				const llm = getBundledModel("github-copilot", "gpt-4o");
				await testEmptyMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"gpt-4o - should handle empty string content",
			async () => {
				const llm = getBundledModel("github-copilot", "gpt-4o");
				await testEmptyStringMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"gpt-4o - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("github-copilot", "gpt-4o");
				await testWhitespaceOnlyMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"gpt-4o - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("github-copilot", "gpt-4o");
				await testEmptyAssistantMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"claude-sonnet-4 - should handle empty content array",
			async () => {
				const llm = getBundledModel("github-copilot", "claude-sonnet-4");
				await testEmptyMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"claude-sonnet-4 - should handle empty string content",
			async () => {
				const llm = getBundledModel("github-copilot", "claude-sonnet-4");
				await testEmptyStringMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"claude-sonnet-4 - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("github-copilot", "claude-sonnet-4");
				await testWhitespaceOnlyMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!githubCopilotToken)(
			"claude-sonnet-4 - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("github-copilot", "claude-sonnet-4");
				await testEmptyAssistantMessage(llm, { apiKey: githubCopilotToken });
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe("Google Gemini CLI Provider Empty Messages", () => {
		it.skipIf(!geminiCliToken)(
			"gemini-2.5-flash - should handle empty content array",
			async () => {
				const llm = getBundledModel("google-gemini-cli", "gemini-2.5-flash");
				await testEmptyMessage(llm, { apiKey: geminiCliToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!geminiCliToken)(
			"gemini-2.5-flash - should handle empty string content",
			async () => {
				const llm = getBundledModel("google-gemini-cli", "gemini-2.5-flash");
				await testEmptyStringMessage(llm, { apiKey: geminiCliToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!geminiCliToken)(
			"gemini-2.5-flash - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("google-gemini-cli", "gemini-2.5-flash");
				await testWhitespaceOnlyMessage(llm, { apiKey: geminiCliToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!geminiCliToken)(
			"gemini-2.5-flash - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("google-gemini-cli", "gemini-2.5-flash");
				await testEmptyAssistantMessage(llm, { apiKey: geminiCliToken });
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe("Google Antigravity Provider Empty Messages", () => {
		it.skipIf(!antigravityToken)(
			"gemini-3-flash - should handle empty content array",
			async () => {
				const llm = getBundledModel("google-antigravity", "gemini-3-flash");
				await testEmptyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gemini-3-flash - should handle empty string content",
			async () => {
				const llm = getBundledModel("google-antigravity", "gemini-3-flash");
				await testEmptyStringMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gemini-3-flash - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("google-antigravity", "gemini-3-flash");
				await testWhitespaceOnlyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gemini-3-flash - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("google-antigravity", "gemini-3-flash");
				await testEmptyAssistantMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"claude-sonnet-4-5 - should handle empty content array",
			async () => {
				const llm = getBundledModel("google-antigravity", "claude-sonnet-4-5");
				await testEmptyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"claude-sonnet-4-5 - should handle empty string content",
			async () => {
				const llm = getBundledModel("google-antigravity", "claude-sonnet-4-5");
				await testEmptyStringMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"claude-sonnet-4-5 - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("google-antigravity", "claude-sonnet-4-5");
				await testWhitespaceOnlyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"claude-sonnet-4-5 - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("google-antigravity", "claude-sonnet-4-5");
				await testEmptyAssistantMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gpt-oss-120b-medium - should handle empty content array",
			async () => {
				const llm = getBundledModel("google-antigravity", "gpt-oss-120b-medium");
				await testEmptyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gpt-oss-120b-medium - should handle empty string content",
			async () => {
				const llm = getBundledModel("google-antigravity", "gpt-oss-120b-medium");
				await testEmptyStringMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gpt-oss-120b-medium - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("google-antigravity", "gpt-oss-120b-medium");
				await testWhitespaceOnlyMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!antigravityToken)(
			"gpt-oss-120b-medium - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("google-antigravity", "gpt-oss-120b-medium");
				await testEmptyAssistantMessage(llm, { apiKey: antigravityToken });
			},
			{ retry: 3, timeout: 30000 },
		);
	});

	describe("OpenAI Codex Provider Empty Messages", () => {
		it.skipIf(!openaiCodexToken)(
			"gpt-5.2-codex - should handle empty content array",
			async () => {
				const llm = getBundledModel("openai-codex", "gpt-5.2-codex");
				await testEmptyMessage(llm, { apiKey: openaiCodexToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!openaiCodexToken)(
			"gpt-5.2-codex - should handle empty string content",
			async () => {
				const llm = getBundledModel("openai-codex", "gpt-5.2-codex");
				await testEmptyStringMessage(llm, { apiKey: openaiCodexToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!openaiCodexToken)(
			"gpt-5.2-codex - should handle whitespace-only content",
			async () => {
				const llm = getBundledModel("openai-codex", "gpt-5.2-codex");
				await testWhitespaceOnlyMessage(llm, { apiKey: openaiCodexToken });
			},
			{ retry: 3, timeout: 30000 },
		);

		it.skipIf(!openaiCodexToken)(
			"gpt-5.2-codex - should handle empty assistant message in conversation",
			async () => {
				const llm = getBundledModel("openai-codex", "gpt-5.2-codex");
				await testEmptyAssistantMessage(llm, { apiKey: openaiCodexToken });
			},
			{ retry: 3, timeout: 30000 },
		);
	});
});
