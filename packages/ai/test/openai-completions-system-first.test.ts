import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/openai-completions.ts";
import { getCompat } from "../src/providers/openai-completions-compat.ts";
import type { Model, OpenAICompletionsCompat } from "../src/types.ts";

/**
 * `requiresSystemMessageFirst` compat behaviour, provider-independent.
 *
 * WorkBuddy is the endpoint that needs it — it answers `400 11128 "first message
 * is not system prompt"` for a leading user message and accepts an empty system
 * message — but the flag belongs to the shared OpenAI-completions adapter, so it
 * is tested here against a synthetic model rather than only through that
 * provider's catalog.
 */

function model(compat: OpenAICompletionsCompat, id = "synthetic"): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://example.invalid/v1",
		compat,
		reasoning: false,
		input: ["text"],
		contextWindow: 8192,
		maxTokens: 2048,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

const user = { role: "user", content: "hi", timestamp: 0 } as const;

describe("requiresSystemMessageFirst", () => {
	it("prepends an empty system message when the caller has no system prompt", () => {
		const target = model({ requiresSystemMessageFirst: true });
		const messages = convertMessages(target, { messages: [user] }, getCompat(target));
		expect(messages[0]).toMatchObject({ role: "system", content: "" });
		expect(messages).toHaveLength(2);
	});

	it("keeps the caller's system prompt in first position and does not duplicate it", () => {
		const target = model({ requiresSystemMessageFirst: true });
		const messages = convertMessages(target, { systemPrompt: "prompt", messages: [user] }, getCompat(target));
		expect(messages[0]).toMatchObject({ role: "system", content: "prompt" });
		expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
	});

	it("leaves the channel untouched for providers that do not require it", () => {
		const target = model({});
		const messages = convertMessages(target, { messages: [user] }, getCompat(target));
		expect(messages[0]?.role).toBe("user");
	});

	it("treats an empty system prompt as absent unless the flag is set", () => {
		const plain = model({});
		expect(convertMessages(plain, { systemPrompt: "", messages: [user] }, getCompat(plain))[0]?.role).toBe("user");
		const strict = model({ requiresSystemMessageFirst: true });
		expect(convertMessages(strict, { systemPrompt: "", messages: [user] }, getCompat(strict))[0]).toMatchObject({
			role: "system",
			content: "",
		});
	});
});
