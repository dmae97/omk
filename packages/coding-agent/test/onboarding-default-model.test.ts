import { describe, expect, it } from "vitest";
import { type CredentialSource, pickDefaultModel } from "../src/core/provider-default-models.ts";

const bedrock = { provider: "amazon-bedrock", id: "us.anthropic.claude-opus-4-6-v1" };
const anthropic = { provider: "anthropic", id: "claude-opus-4-8" };
const openai = { provider: "openai", id: "gpt-5.4" };
const sources =
	(map: Record<string, CredentialSource>) =>
	(provider: string): CredentialSource =>
		map[provider];

describe("default model ranking", () => {
	it("prefers an explicit provider key over ambient AWS credentials (the table lists Bedrock first)", () => {
		const picked = pickDefaultModel(
			[bedrock, anthropic],
			sources({ "amazon-bedrock": undefined, anthropic: "environment" }),
		);
		expect(picked).toBe(anthropic);
	});

	it("keeps Bedrock when it was configured deliberately through /login", () => {
		const picked = pickDefaultModel(
			[bedrock, anthropic],
			sources({ "amazon-bedrock": "stored", anthropic: "environment" }),
		);
		expect(picked).toBe(bedrock);
	});

	it("still uses ambient credentials when nothing else exists", () => {
		expect(pickDefaultModel([bedrock], sources({}))).toBe(bedrock);
	});

	it("falls back to table order inside one tier", () => {
		expect(pickDefaultModel([openai, anthropic], sources({ anthropic: "environment", openai: "environment" }))).toBe(
			anthropic,
		);
	});

	it("ignores models that are not their provider's default", () => {
		expect(pickDefaultModel([{ provider: "anthropic", id: "claude-haiku" }], sources({}))).toBeUndefined();
	});
});
