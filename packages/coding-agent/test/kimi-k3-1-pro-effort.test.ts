import { type Api, getModel, getSupportedThinkingLevels, type Model, type ThinkingLevel } from "omk-ai";
import { describe, expect, it } from "vitest";
import { lowGroupEffort } from "../src/core/adaptive-effort.ts";
import { lowerReasoningEffort } from "../src/core/response-reasoning-cap.ts";

/**
 * Kimi K3.1 Pro cannot run with thinking off. OMK_ADAPTIVE_EFFORT and OMK_RESPONSE_REASONING_CAP
 * may only pick a supported thinking level or leave the level unset; an unset level reaches the
 * wire without `thinking: { type: "disabled" }` (see packages/ai/test/kimi-k3-1-pro.test.ts).
 */
const MODELS: Array<[string, string]> = [
	["kimi-coding", "k3.1-pro"],
	["kimi-coding", "k3.1-pro-highspeed"],
	["moonshotai", "kimi-k3.1-pro"],
	["moonshotai", "kimi-k3.1-pro-highspeed"],
];
const CEILINGS: Array<ThinkingLevel | undefined> = [
	undefined,
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
];

function load(provider: string, id: string): Model<Api> {
	const model = getModel(provider as never, id as never) as Model<Api> | undefined;
	if (!model) throw new Error(`Missing ${provider}/${id}`);
	return model;
}

describe("Kimi K3.1 Pro effort controls never turn thinking off", () => {
	it.each(MODELS)("%s/%s: adaptive-effort low group stays on a supported thinking level", (provider, id) => {
		const model = load(provider, id);
		const supported = getSupportedThinkingLevels(model);
		// The moonshotai picker still lists "off" (no thinkingLevelMap), but its payload never carries a
		// thinking toggle or reasoning_effort, so the API default (`max`) applies regardless.
		if (provider === "kimi-coding") expect(supported).not.toContain("off");
		for (const ceiling of CEILINGS) {
			const level = lowGroupEffort(model, ceiling);
			if (level === undefined) continue;
			expect(level as string, `${id} ceiling=${ceiling}`).not.toBe("off");
			expect(supported, `${id} ceiling=${ceiling}`).toContain(level);
		}
	});

	it("response-reasoning-cap retry lowers effort but never to off", () => {
		for (const ceiling of CEILINGS) {
			expect(lowerReasoningEffort(ceiling) as string | undefined).not.toBe("off");
		}
	});
});
