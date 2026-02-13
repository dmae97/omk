import { describe, expect, it } from "bun:test";
import { getProviderDetails, type Model } from "@oh-my-pi/pi-ai";
import { renderProviderSection } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
describe("session provider section", () => {
	it("renders codex provider details with transport fields", () => {
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};

		const details = getProviderDetails({
			model,
			sessionId: "session-1",
			authMode: "oauth",
		});
		const output = renderProviderSection(details, { fg: (_color: string, text: string) => text });

		expect(output).toContain("Name:");
		expect(output).toContain("openai-codex");
		expect(output).toContain("Transport:");
		expect(output).toContain("WebSocket:");
		expect(output).toContain("Reuse:");
		expect(output).toContain("Auth:");
	});
});
