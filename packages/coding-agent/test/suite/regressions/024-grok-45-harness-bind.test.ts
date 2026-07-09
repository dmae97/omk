/**
 * Grok-4.5 harness bind: presets default to grok-4.5; compaction prefers 4.5;
 * Imagine ids stay blocked on grok-oauth-proxy completions.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { resolveCompactionModel } from "../../../src/core/compaction/model-policy.ts";
import { assertTextChatModelForCompletion } from "../../../src/core/grok-harness.ts";
import { GROK_OAUTH_PROVIDER } from "../../../src/core/grok-playbook.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../../");

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
	it("project presets pin grok-oauth-proxy / grok-4.5", () => {
		const presets = JSON.parse(readFileSync(join(repoRoot, ".omk/presets.json"), "utf-8")) as Record<
			string,
			{ provider: string; model: string }
		>;
		for (const name of ["grok-verified", "grok-adaptorch-prod"] as const) {
			expect(presets[name]?.provider).toBe(GROK_OAUTH_PROVIDER);
			expect(presets[name]?.model).toBe("grok-4.5");
		}
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
