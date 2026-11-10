import { clampThinkingLevel, getModel, getSupportedThinkingLevels, type ThinkingLevel } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THINKING_LEVEL } from "../src/core/defaults.ts";
import {
	capturePayload,
	captureRequest,
	FIXTURE_TOKEN,
	GATEWAY_URL,
	registryWithOmk,
} from "./omk-provider-flag-on-lib.ts";

afterEach(() => vi.unstubAllGlobals());

const registry = registryWithOmk();
const coder = registry.find("OMK", "coder");
const reasoner = registry.find("OMK", "reasoner");
const flash = getModel("deepseek", "deepseek-flash");
if (!coder || !reasoner) throw new Error("OMK models are not registered");

const wire = (p: Record<string, unknown>) => ({
	thinking: p.thinking,
	reasoning_effort: p.reasoning_effort,
	max_tokens: p.max_tokens,
});

describe("OMK/reasoner effort levels", () => {
	it("never offers off, minimal, xhigh or max; high stays selectable", () => {
		const levels = getSupportedThinkingLevels(reasoner);
		expect(levels).toEqual(["low", "medium", "high"]);
		for (const rejected of ["off", "minimal", "xhigh", "max"]) expect(levels).not.toContain(rejected);
		expect(levels).toContain("high");
	});

	it("clamps off and minimal up to low and xhigh/max down to high, so thinking can never be switched off", () => {
		for (const level of ["off", "minimal"] as const) expect(clampThinkingLevel(reasoner, level)).toBe("low");
		for (const level of ["xhigh", "max"] as const) expect(clampThinkingLevel(reasoner, level)).toBe("high");
	});

	it("the default level (medium, defaults.ts) is accepted as-is and goes out as effort `low`", async () => {
		expect(DEFAULT_THINKING_LEVEL).toBe("medium");
		const level = clampThinkingLevel(reasoner, DEFAULT_THINKING_LEVEL);
		expect(level).toBe("medium");
		const payload = await capturePayload(reasoner, { reasoning: level as ThinkingLevel });
		expect(payload).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
		// deepseek-flash, by contrast, clamps the same default UP to high.
		expect(clampThinkingLevel(flash, DEFAULT_THINKING_LEVEL)).toBe("high");
	});

	it("the user can pick high and gets effort high", async () => {
		expect(clampThinkingLevel(reasoner, "high")).toBe("high");
		expect(await capturePayload(reasoner, { reasoning: "high" })).toMatchObject({
			thinking: { type: "enabled" },
			reasoning_effort: "high",
		});
	});
});

describe("OMK/reasoner payload parity with deepseek/deepseek-flash", () => {
	it.each(["low", "high"] as const)(
		"level %s: thinking, reasoning_effort and max_tokens equal deepseek-flash",
		async (level) => {
			const [omk, upstream] = await Promise.all([
				capturePayload(reasoner, { reasoning: level }),
				capturePayload(flash, { reasoning: level }),
			]);
			expect(wire(omk)).toEqual(wire(upstream));
			expect(omk).not.toHaveProperty("max_completion_tokens");
		},
	);

	it("medium is sent exactly like low", async () => {
		const [medium, low] = await Promise.all([
			capturePayload(reasoner, { reasoning: "medium" }),
			capturePayload(reasoner, { reasoning: "low" }),
		]);
		expect(wire(medium)).toEqual(wire(low));
	});

	it("carries the OMK model id and the same flag-independent request shape (no store, no developer role)", async () => {
		const payload = await capturePayload(reasoner, { reasoning: "low" });
		expect(payload.model).toBe("reasoner");
		expect(payload).not.toHaveProperty("store");
	});
});

describe("OMK/coder", () => {
	it("does not support thinking and sends neither thinking nor reasoning_effort", async () => {
		expect(coder.reasoning).toBe(false);
		for (const reasoning of [undefined, "high"] as const) {
			const payload = await capturePayload(coder, { reasoning });
			expect(payload).toMatchObject({ model: "coder", max_tokens: 4096 });
			expect(payload).not.toHaveProperty("thinking");
			expect(payload).not.toHaveProperty("reasoning_effort");
		}
	});
});

describe("OMK models are text-only", () => {
	it.each(["coder", "reasoner"])("%s: image blocks are dropped from the request", async (id) => {
		const model = registry.find("OMK", id);
		if (!model) throw new Error("missing model");
		const payload = await capturePayload(model, { reasoning: "low" }, [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe this" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				],
				timestamp: 0,
			},
		]);
		expect(JSON.stringify(payload.messages)).not.toMatch(/image_url|data:image/);
		expect(JSON.stringify(payload.messages)).toContain("describe this");
	});
});

describe("OMK gateway request", () => {
	it("posts to <OMK_GATEWAY_BASE_URL>/chat/completions with Authorization: Bearer <token> and the OMK model id", async () => {
		const [request] = await captureRequest(reasoner, { reasoning: "low" });
		expect(request.url).toBe(`${GATEWAY_URL}/chat/completions`);
		expect(request.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
		expect(request.body.model).toBe("reasoner");
	});
});
