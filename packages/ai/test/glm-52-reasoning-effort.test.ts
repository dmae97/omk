import { describe, expect, it } from "vitest";
import { getModel, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Context, Model } from "../src/types.ts";

// GLM-5.2 "max" (xhigh): every GLM-5.2 host keeps xhigh selectable (UI label "max").
// The three effort-string hosts emit the literal wire value "max" (user-mandated
// Option A); toggle/budget hosts ignore the map and route to their own max thinking.

interface CapturedPayload {
	reasoning?: { effort?: string };
	reasoning_effort?: string;
}

async function capturePayload(model: Model<"openai-completions">): Promise<CapturedPayload> {
	let captured: CapturedPayload | undefined;
	const payloadCaptureModel: Model<"openai-completions"> = { ...model, baseUrl: "http://127.0.0.1:9" };
	const context: Context = { messages: [{ role: "user", content: "Hello", timestamp: Date.now() }] };

	const stream = streamSimple(payloadCaptureModel, context, {
		apiKey: "fake-key",
		reasoning: "xhigh", // the UI "max" selection
		onPayload: (payload) => {
			captured = payload as CapturedPayload;
			return payload;
		},
	});

	try {
		await stream.result();
	} catch {
		// The dead baseUrl makes the request fail after the payload is built; ignore.
	}

	if (!captured) throw new Error("Expected payload to be captured before request failure");
	return captured;
}

describe("GLM-5.2 max(xhigh) reasoning mapping", () => {
	it("keeps xhigh selectable and maps it to high on effort-string hosts", () => {
		// Literal getModel calls (not a loop over mixed provider/id unions) so each
		// TModelId stays a valid key of its provider instead of collapsing to never.
		const models = [
			getModel("openrouter", "z-ai/glm-5.2"),
			getModel("cloudflare-workers-ai", "@cf/zai-org/glm-5.2"),
			getModel("opencode-go", "glm-5.2"),
		];
		for (const model of models) {
			expect(model).toBeDefined();
			expect(getSupportedThinkingLevels(model)).toContain("xhigh"); // "max" stays visible
			expect(model.thinkingLevelMap?.xhigh).toBe("max"); // literal max sent to provider
		}
	});

	it("keeps xhigh(max) selectable for kimi-for-coding (anthropic budget path)", () => {
		const model = getModel("kimi-coding", "kimi-for-coding");
		expect(model).toBeDefined();
		expect(model.reasoning).toBe(true);
		// Budget-path anthropic model: xhigh stays exposed and routes to the max thinking
		// budget; thinkingLevelMap is not consulted on this path, so it stays unmapped.
		expect(getSupportedThinkingLevels(model)).toContain("xhigh");
		expect(model.thinkingLevelMap?.xhigh).toBeUndefined();
	});

	it("leaves toggle hosts unmapped while still exposing xhigh", () => {
		const models = [getModel("zai", "glm-5.2"), getModel("zai-coding-cn", "glm-5.2")];
		for (const model of models) {
			expect(model).toBeDefined();
			expect(model.thinkingLevelMap?.xhigh).toBeUndefined();
			expect(getSupportedThinkingLevels(model)).toContain("xhigh");
		}
	});

	it("openrouter z-ai/glm-5.2 sends reasoning.effort:'max'", async () => {
		const payload = await capturePayload(getModel("openrouter", "z-ai/glm-5.2"));
		expect(payload.reasoning?.effort).toBe("max");
	});

	it("cloudflare-workers-ai @cf/zai-org/glm-5.2 sends reasoning_effort:'max'", async () => {
		const payload = await capturePayload(getModel("cloudflare-workers-ai", "@cf/zai-org/glm-5.2"));
		expect(payload.reasoning_effort).toBe("max");
	});

	it("opencode-go glm-5.2 sends reasoning_effort:'max'", async () => {
		const payload = await capturePayload(getModel("opencode-go", "glm-5.2"));
		expect(payload.reasoning_effort).toBe("max");
	});
});
