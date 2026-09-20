import { describe, expect, it } from "vitest";
import { WORKBUDDY_BASE_URL } from "../scripts/catalog-workbuddy.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";

/**
 * WorkBuddy catalog contract.
 *
 * Every id here was probed against `https://www.workbuddy.ai/v2/chat/completions`
 * on 2026-09-19 (see `scripts/catalog-workbuddy.ts` for the recorded contract).
 * The assertions that matter are the ones that keep the catalog from over-claiming:
 * only provider-declared effort values are selectable, and `off` is never offered
 * because no disable literal was verified.
 */

const EXPECTED_COMPAT = {
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
	supportsUsageInStreaming: true,
	requiresSystemMessageFirst: true,
} as const;

describe("workbuddy provider catalog", () => {
	const models = getModels("workbuddy");

	it("registers the probed lanes and nothing else", () => {
		expect(models.map((model) => model.id).sort()).toEqual(
			[
				"auto",
				"claude-opus-4.6",
				"claude-opus-5",
				"claude-sonnet-4.6",
				"deepseek-v3-0324",
				"deepseek-v4.1-flash",
				"gemini-3.1-pro",
				"gemini-3.5-flash",
				"gemini-3.8-flash",
				"glm-5.1",
				"glm-5.2",
				"glm-5.3",
				"glm-5v-turbo",
				"gpt-5.3-codex",
				"gpt-5.4",
				"gpt-5.5",
				"gpt-5.6-luna",
				"gpt-5.6-sol",
				"gpt-5.6-terra",
				"gpt-6-astra",
				"grok-4.6",
				"hy3",
				"hy4-preview",
				"kimi-k2.5",
				"kimi-k2.6",
				"kimi-k3",
				"minimax-m3",
			].sort(),
		);
	});

	it("omits lanes the endpoint refused or that resolve to undeclared server-side targets", () => {
		const ids = new Set(models.map((model) => model.id));
		// 429 on repeat attempts while its siblings answered 200.
		expect(ids.has("glm-5.0")).toBe(false);
		// Probed and refused with `11102 model service info not found`.
		for (const refused of ["claude-sonnet-5", "gemini-3.6-flash", "gpt-5.2", "qwen3.8-max", "hunyuan-t1"]) {
			expect(ids.has(refused), refused).toBe(false);
		}
		// CLI role aliases: the endpoint answers 200 but the target model, limits
		// and effort ladder are decided server-side and are not declared here.
		for (const alias of ["fast-model", "balanced-model", "primary-model", "deep-model", "default-model"]) {
			expect(ids.has(alias), alias).toBe(false);
		}
	});

	it("pins the endpoint and the verified wire compatibility on every entry", () => {
		for (const model of models) {
			expect(model, model.id).toMatchObject({
				api: "openai-completions",
				provider: "workbuddy",
				baseUrl: WORKBUDDY_BASE_URL,
				compat: EXPECTED_COMPAT,
			});
		}
	});

	it("prices nothing: the plan bills in provider credits, not USD per million tokens", () => {
		for (const model of models) {
			expect(model.cost, model.id).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		}
	});

	it.each([
		["glm-5.3", ["low", "high", "max"]],
		["glm-5.2", ["high", "xhigh"]],
		["hy3", ["low", "high"]],
		["gpt-5.6-sol", ["low", "medium", "high", "xhigh"]],
		["gpt-5.6-luna", ["low", "medium", "high", "xhigh"]],
		["kimi-k3", ["medium"]],
		["gpt-5.5", ["high"]],
		// Lanes the gateway serves without declaring: the ladder is the vendor's own,
		// and every value here was accepted on a live probe.
		["claude-opus-5", ["low", "medium", "high", "xhigh", "max"]],
		["claude-opus-4.6", ["low", "medium", "high", "max"]],
		["claude-sonnet-4.6", ["low", "medium", "high", "max"]],
		["deepseek-v4.1-flash", ["low", "high", "max"]],
		["gemini-3.8-flash", ["low", "medium", "high"]],
		["gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
		["grok-4.6", ["low", "medium", "high", "xhigh"]],
		["hy4-preview", ["low", "high"]],
	] as ReadonlyArray<readonly [string, readonly string[]]>)(
		"exposes only the declared effort values for %s",
		(id, declared) => {
			const model = models.find((entry) => entry.id === id);
			expect(model, id).toBeDefined();
			if (!model) throw new Error(`Missing workbuddy/${id}`);
			const ceilingAlias = declared.includes("xhigh") && !declared.includes("max") ? ["max"] : [];
			expect(getSupportedThinkingLevels(model).sort()).toEqual([...declared, ...ceilingAlias].sort());
			// No unmapped tier may leak through as its own wire value; the only alias is
			// OMK's documented `max` label onto a declared `xhigh` ceiling.
			for (const level of ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
				const mapped = model.thinkingLevelMap?.[level];
				if (mapped === null) continue;
				if (level === "max" && declared.includes("xhigh") && !declared.includes("max")) {
					expect(mapped, `${id}/max alias`).toBe("xhigh");
					continue;
				}
				expect(declared.includes(level), `${id}/${level}`).toBe(true);
				expect(mapped, `${id}/${level}`).toBe(level);
			}
		},
	);

	it("never offers off on a reasoning lane: no disable literal was verified on this endpoint", () => {
		for (const model of models) {
			expect(model.thinkingLevelMap?.off, model.id).toBeNull();
			// A non-reasoning lane reports `["off"]` because there is nothing to
			// control; a reasoning lane must not advertise a disabled state it
			// cannot express.
			if (model.reasoning) expect(getSupportedThinkingLevels(model), model.id).not.toContain("off");
		}
	});

	it("keeps a reasoning lane that declares no effort out of the effort business", () => {
		const model = models.find((entry) => entry.id === "gemini-3.1-pro");
		expect(model?.reasoning).toBe(true);
		expect(getSupportedThinkingLevels(model!)).toEqual([]);
		expect(model?.compat).toMatchObject({ supportsReasoningEffort: false });
	});

	it("carries the declared context windows and output caps", () => {
		const expected: Array<[string, number, number, boolean]> = [
			["glm-5.3", 1_000_000, 48_000, true],
			["kimi-k3", 1_000_000, 32_000, true],
			["gpt-5.6-sol", 1_000_000, 128_000, true],
			["glm-5.1", 200_000, 48_000, false],
			["deepseek-v3-0324", 128_000, 8_192, false],
			["auto", 168_000, 32_000, true],
		];
		for (const [id, contextWindow, maxTokens, image] of expected) {
			expect(
				models.find((entry) => entry.id === id),
				id,
			).toMatchObject({
				contextWindow,
				maxTokens,
				input: image ? ["text", "image"] : ["text"],
			});
		}
	});
});
