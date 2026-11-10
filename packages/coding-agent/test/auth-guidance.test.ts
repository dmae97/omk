import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocsPath } from "../src/config.ts";
import {
	formatNoApiKeyFoundMessage,
	formatNoModelSelectedMessage,
	formatNoModelsAvailableMessage,
	getProviderLoginHelp,
} from "../src/core/auth-guidance.ts";

describe("auth guidance formatters", () => {
	it.each([
		["unknown", "No API key found for the selected model."],
		["anthropic", "No API key found for anthropic."],
	])("formats the missing API key message for provider %s", (provider, expectedPrefix) => {
		expect(formatNoApiKeyFoundMessage(provider).startsWith(expectedPrefix)).toBe(true);
	});

	it("provides login help and documentation paths", () => {
		const help = getProviderLoginHelp();

		expect(help).toContain("Use /login to log into a provider via OAuth or API key.");
		expect(help).toContain(join(getDocsPath(), "providers.md"));
		expect(help).toContain(join(getDocsPath(), "models.md"));

		for (const message of [
			formatNoApiKeyFoundMessage("unknown"),
			formatNoApiKeyFoundMessage("anthropic"),
			formatNoModelsAvailableMessage(),
			formatNoModelSelectedMessage(),
		]) {
			expect(message).toContain(help);
		}
	});

	it("formats the no-models message with the expected opening", () => {
		expect(formatNoModelsAvailableMessage()).toMatch(/^No models available\./);
	});

	it("formats the no-model-selected message with the expected opening and ending", () => {
		const message = formatNoModelSelectedMessage();

		expect(message).toMatch(/^No model selected\./);
		expect(message).toMatch(/Then use \/model to select a model\.$/);
	});
});
