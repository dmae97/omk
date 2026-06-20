import { ThinkingLevel as GoogleSdkThinkingLevel } from "@google/genai";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";
import type { Api, Context, Model, SimpleStreamOptions } from "../src/types.ts";

interface GoogleThinkingPayload {
	config?: {
		thinkingConfig?: {
			includeThoughts?: boolean;
			thinkingBudget?: number;
			thinkingLevel?: unknown;
		};
	};
}

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

function makeContext(): Context {
	return {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};
}

async function capturePayload<TApi extends Api>(
	model: Model<TApi>,
	options: SimpleStreamOptions,
): Promise<GoogleThinkingPayload> {
	let capturedPayload: GoogleThinkingPayload | undefined;

	const s = streamSimple(model, makeContext(), {
		...options,
		apiKey: "fake-key",
		onPayload: (payload) => {
			capturedPayload = payload as GoogleThinkingPayload;
			throw new PayloadCaptured();
		},
	});

	await s.result();

	if (!capturedPayload) {
		throw new Error("Expected payload to be captured before request failure");
	}

	return capturedPayload;
}

describe("Google thinking payload", () => {
	it("maps Gemini 3 xhigh to the supported high thinking level", async () => {
		const payload = await capturePayload(getModel("google", "gemini-3-pro-preview"), { reasoning: "xhigh" });

		expect(payload.config?.thinkingConfig).toMatchObject({ includeThoughts: true });
		expect(payload.config?.thinkingConfig?.thinkingLevel).toBe("HIGH");
		expect(payload.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
	});

	it("maps Gemini 2.5 Pro xhigh to the high thinking budget", async () => {
		const payload = await capturePayload(getModel("google", "gemini-2.5-pro"), { reasoning: "xhigh" });

		expect(payload.config?.thinkingConfig).toMatchObject({
			includeThoughts: true,
			thinkingBudget: 32768,
		});
		expect(payload.config?.thinkingConfig?.thinkingLevel).toBeUndefined();
	});
});

describe("Google Vertex thinking payload", () => {
	it("maps Gemini 3 xhigh to the supported high thinking level", async () => {
		const payload = await capturePayload(getModel("google-vertex", "gemini-3-pro-preview"), { reasoning: "xhigh" });

		expect(payload.config?.thinkingConfig).toMatchObject({ includeThoughts: true });
		expect(payload.config?.thinkingConfig?.thinkingLevel).toBe(GoogleSdkThinkingLevel.HIGH);
		expect(payload.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
	});

	it("maps Gemini 2.5 Pro xhigh to the high thinking budget", async () => {
		const payload = await capturePayload(getModel("google-vertex", "gemini-2.5-pro"), { reasoning: "xhigh" });

		expect(payload.config?.thinkingConfig).toMatchObject({
			includeThoughts: true,
			thinkingBudget: 32768,
		});
		expect(payload.config?.thinkingConfig?.thinkingLevel).toBeUndefined();
	});
});
