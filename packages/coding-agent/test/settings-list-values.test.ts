import { describe, expect, it } from "vitest";
import { parseDefaultActiveSkills, parseSubscriptionUsageProviders } from "../src/core/settings-list-values.ts";

const VALID_NAME_ERROR = "defaultActiveSkills entries must be valid skill names";
const SKILLS_ARRAY_ERROR = "defaultActiveSkills must be an array of at most 64 skill names";
const PROVIDERS_ERROR = "subscriptionUsageProviders must be an array of non-empty provider IDs";

describe("parseDefaultActiveSkills", () => {
	it("returns an empty list for undefined and for an empty array", () => {
		expect(parseDefaultActiveSkills(undefined)).toEqual([]);
		expect(parseDefaultActiveSkills([])).toEqual([]);
	});

	it("keeps valid kebab-case names in order", () => {
		expect(parseDefaultActiveSkills(["foo", "foo-bar", "a1"])).toEqual(["foo", "foo-bar", "a1"]);
	});

	it("drops duplicates, keeping first-seen order", () => {
		expect(parseDefaultActiveSkills(["foo", "bar", "foo"])).toEqual(["foo", "bar"]);
	});

	it.each(["Foo", "foo_bar", "-foo", "foo-", "foo--bar", ""])("rejects the invalid skill name %j", (name) => {
		expect(() => parseDefaultActiveSkills([name])).toThrow(new Error(VALID_NAME_ERROR));
	});

	it("accepts a 64-character name and rejects a longer one", () => {
		const longest = "a".repeat(64);
		expect(parseDefaultActiveSkills([longest])).toEqual([longest]);
		expect(() => parseDefaultActiveSkills(["a".repeat(65)])).toThrow(new Error(VALID_NAME_ERROR));
	});

	it("accepts 64 entries and rejects more than 64 entries", () => {
		const max = Array.from({ length: 64 }, (_, index) => `skill-${index}`);
		expect(parseDefaultActiveSkills(max)).toEqual(max);
		expect(() => parseDefaultActiveSkills([...max, "one-more"])).toThrow(new Error(SKILLS_ARRAY_ERROR));
	});

	it.each(["foo", null])("rejects the non-array value %j", (value) => {
		expect(() => parseDefaultActiveSkills(value)).toThrow(new Error(SKILLS_ARRAY_ERROR));
	});
});

describe("parseSubscriptionUsageProviders", () => {
	it("returns undefined for undefined and keeps an empty array empty", () => {
		expect(parseSubscriptionUsageProviders(undefined)).toBeUndefined();
		expect(parseSubscriptionUsageProviders([])).toEqual([]);
	});

	it("keeps provider IDs in order, including padded IDs as-is", () => {
		expect(parseSubscriptionUsageProviders(["openai", "anthropic"])).toEqual(["openai", "anthropic"]);
		expect(parseSubscriptionUsageProviders([" openai"])).toEqual([" openai"]);
	});

	it.each([[""], ["  "]])("rejects empty or whitespace-only entries %j", (value) => {
		expect(() => parseSubscriptionUsageProviders(value)).toThrow(new Error(PROVIDERS_ERROR));
	});

	it("rejects a non-array value", () => {
		expect(() => parseSubscriptionUsageProviders("openai")).toThrow(new Error(PROVIDERS_ERROR));
	});

	it("returns a copy, so mutating the input afterwards does not change the result", () => {
		const input = ["openai"];
		const parsed = parseSubscriptionUsageProviders(input);
		input.push("anthropic");

		expect(parsed).toEqual(["openai"]);
		expect(parsed).not.toBe(input);
	});
});
