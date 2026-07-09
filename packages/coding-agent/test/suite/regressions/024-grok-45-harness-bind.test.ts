/**
 * Grok-4.5 harness bind: compaction prefers 4.5; Imagine ids stay blocked on
 * grok-oauth-proxy completions. (Project `.omk/presets.json` is gitignored and
 * is not asserted here — CI clones have no local presets file.)
 */
import type { Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { resolveCompactionModel } from "../../../src/core/compaction/model-policy.ts";
import { assertTextChatModelForCompletion, isGrokOAuthProvider } from "../../../src/core/grok-harness.ts";
import { GROK_OAUTH_PROVIDER } from "../../../src/core/grok-playbook.ts";

function chat(id: string): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: GROK_OAUTH_PROVIDER,
		baseUrl: "http://127.0.0.1:9996/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
	};
}

describe("024 grok-4.5 harness bind", () => {
	it("identifies grok-oauth-proxy as the Grok OAuth provider id", () => {
		expect(GROK_OAUTH_PROVIDER).toBe("grok-oauth-proxy");
		expect(isGrokOAuthProvider(GROK_OAUTH_PROVIDER)).toBe(true);
		expect(isGrokOAuthProvider("xai")).toBe(false);
	});

	it("blocks imagine models on grok-oauth-proxy and allows grok-4.5", () => {
		expect(() => assertTextChatModelForCompletion("grok-imagine-image", GROK_OAUTH_PROVIDER)).toThrow(/tool-only/);
		expect(() => assertTextChatModelForCompletion("grok-4.5", GROK_OAUTH_PROVIDER)).not.toThrow();
	});

	it("compaction prefers grok-4.5 for imagine sessions", () => {
		const imagine = chat("grok-imagine-image");
		const resolved = resolveCompactionModel(imagine, [imagine, chat("grok-4.3"), chat("grok-4.5")]);
		expect(resolved.id).toBe("grok-4.5");
	});
});
