import { describe, expect, it } from "bun:test";
import { loginKagi } from "../src/utils/oauth/kagi";

describe("kagi login", () => {
	it("opens Kagi API settings and prompts for key", async () => {
		let authUrl: string | undefined;
		let authInstructions: string | undefined;
		let promptMessage: string | undefined;
		let promptPlaceholder: string | undefined;

		const apiKey = await loginKagi({
			onAuth: info => {
				authUrl = info.url;
				authInstructions = info.instructions;
			},
			onPrompt: async prompt => {
				promptMessage = prompt.message;
				promptPlaceholder = prompt.placeholder;
				return "kagi_test_key";
			},
		});

		expect(authUrl).toBe("https://kagi.com/settings/api");
		expect(authInstructions).toContain("Copy your API key");
		expect(promptMessage).toBe("Paste your Kagi API key");
		expect(promptPlaceholder).toBe("kagi_...");
		expect(apiKey).toBe("kagi_test_key");
	});

	it("rejects empty keys", async () => {
		await expect(
			loginKagi({
				onPrompt: async () => "   ",
			}),
		).rejects.toThrow("API key is required");
	});

	it("requires onPrompt callback", async () => {
		await expect(loginKagi({})).rejects.toThrow("Kagi login requires onPrompt callback");
	});
});
