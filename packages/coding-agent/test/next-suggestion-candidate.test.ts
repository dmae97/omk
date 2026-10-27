import type { AssistantMessage } from "omk-ai";
import { getModel } from "omk-ai";
import { describe, expect, it } from "vitest";
import type { RecordedMainRequest } from "../src/core/next-suggestion.ts";
import { NextSuggestionCandidate } from "../src/modes/interactive/next-suggestion-candidate.ts";

const model = getModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("test model missing");
const finalAssistant = { role: "assistant" } as AssistantMessage;
const record: RecordedMainRequest = { model, context: { messages: [] }, options: undefined, atMs: 1 };
const identity = { provider: model.provider, id: model.id };

describe("NextSuggestionCandidate", () => {
	it("reuses only the identical live context and model", () => {
		const cache = new NextSuggestionCandidate(() => 1000);
		cache.store(record, finalAssistant, "next");
		expect(cache.get(record, finalAssistant, identity)).toBe("next");
		expect(cache.get({ ...record }, finalAssistant, identity)).toBeUndefined();
		cache.store(record, finalAssistant, "next");
		expect(cache.get(record, { ...finalAssistant }, identity)).toBeUndefined();
		cache.store(record, finalAssistant, "next");
		expect(cache.get(record, finalAssistant, { provider: model.provider, id: "other" })).toBeUndefined();
	});

	it("does not revive a dismissed candidate", () => {
		const cache = new NextSuggestionCandidate(() => 1000);
		cache.store(record, finalAssistant, "next");
		cache.dismiss("next");
		expect(cache.get(record, finalAssistant, identity)).toBeUndefined();
	});

	it("expires a candidate at 120 seconds", () => {
		let now = 1000;
		const cache = new NextSuggestionCandidate(() => now);
		cache.store(record, finalAssistant, "next");
		now += 119_999;
		expect(cache.get(record, finalAssistant, identity)).toBe("next");
		now = 121_000;
		expect(cache.get(record, finalAssistant, identity)).toBeUndefined();
	});
});
