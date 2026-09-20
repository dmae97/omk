import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { convertMessages } from "../src/providers/openai-completions.ts";
import { getCompat } from "../src/providers/openai-completions-compat.ts";
import { streamSimple } from "../src/stream.ts";
import type { Context, Model, ThinkingLevel } from "../src/types.ts";

/**
 * WorkBuddy wire contract.
 *
 * Reproduced against the live endpoint on 2026-09-19 and asserted here without
 * a network call:
 *   - `stream: false` is rejected (`400 11101`), so the request must stream;
 *   - the first message must be `role: "system"` (`400 11128` otherwise) — an
 *     empty system message is accepted, which is what the caller without a
 *     prompt ends up sending;
 *   - `max_completion_tokens` is accepted but ignored, so only `max_tokens`
 *     carries the cap;
 *   - `reasoning_effort` is sent only for the effort values the product
 *     declares, and never for a lane whose ladder is empty.
 */

class PayloadCaptured extends Error {}
afterEach(() => vi.unstubAllGlobals());

function model(id: string): Model<"openai-completions"> {
	const found = getModels("workbuddy").find((entry) => entry.id === id);
	if (!found) throw new Error(`Missing workbuddy/${id}`);
	return found;
}

async function capturePayload(
	id: string,
	context: Context,
	options: { reasoning?: ThinkingLevel } = {},
): Promise<Record<string, unknown>> {
	let payload: unknown;
	const fetch = vi.fn(() => {
		throw new Error("Unexpected network call");
	});
	vi.stubGlobal("fetch", fetch);
	await streamSimple(model(id), context, {
		apiKey: "fixture-key",
		reasoning: options.reasoning,
		maxTokens: 4096,
		onPayload: (body) => {
			payload = body;
			throw new PayloadCaptured();
		},
	}).result();
	expect(fetch).not.toHaveBeenCalled();
	if (typeof payload !== "object" || payload === null) throw new Error("Payload was not captured");
	return payload as Record<string, unknown>;
}

const userTurn: Context = { messages: [{ role: "user", content: "fixture", timestamp: 0 }] };

describe("workbuddy request shape", () => {
	it("streams, because a non-streaming request is rejected upstream", async () => {
		const payload = await capturePayload("glm-5.3", userTurn, { reasoning: "high" });
		expect(payload.stream).toBe(true);
	});

	it("caps output with max_tokens and never sends the ignored max_completion_tokens", async () => {
		const payload = await capturePayload("glm-5.3", userTurn, { reasoning: "high" });
		expect(payload.max_tokens).toBe(4096);
		expect(payload).not.toHaveProperty("max_completion_tokens");
	});

	it("opens with a system message even when the caller has no system prompt", async () => {
		const payload = await capturePayload("glm-5.3", userTurn, { reasoning: "high" });
		const messages = payload.messages as Array<{ role: string; content: unknown }>;
		expect(messages[0]).toMatchObject({ role: "system", content: "" });
		expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
	});

	it("sends the caller's system prompt once, in first position", async () => {
		const payload = await capturePayload(
			"glm-5.3",
			{ systemPrompt: "You are terse.", messages: userTurn.messages },
			{ reasoning: "high" },
		);
		const messages = payload.messages as Array<{ role: string; content: unknown }>;
		expect(messages[0]).toMatchObject({ role: "system", content: "You are terse." });
		expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
	});

	it.each([
		["glm-5.3", "high", "high"],
		["glm-5.3", "max", "max"],
		["glm-5.2", "xhigh", "xhigh"],
		["kimi-k3", "medium", "medium"],
		["hy3", "low", "low"],
	] as ReadonlyArray<[string, ThinkingLevel, string]>)(
		"maps %s %s to reasoning_effort %s",
		async (id, level, expected) => {
			const payload = await capturePayload(id, userTurn, { reasoning: level });
			expect(payload.reasoning_effort).toBe(expected);
		},
	);

	it("sends no reasoning_effort on a lane with no declared ladder", async () => {
		const payload = await capturePayload("gemini-3.1-pro", userTurn, { reasoning: "high" });
		expect(payload).not.toHaveProperty("reasoning_effort");
	});

	it("serializes tools and carries them on the request", async () => {
		const payload = await capturePayload(
			"glm-5.3",
			{
				messages: userTurn.messages,
				tools: [
					{
						name: "read_file",
						description: "Read a file",
						parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
					},
				],
			} as Context,
			{ reasoning: "high" },
		);
		expect(payload.tools).toMatchObject([
			{ type: "function", function: { name: "read_file", description: "Read a file" } },
		]);
	});
});

describe("workbuddy message conversion", () => {
	it("converts image blocks to data URIs, which is the only form the endpoint accepts", () => {
		const messages = convertMessages(
			model("kimi-k3"),
			{
				messages: [
					{
						role: "user",
						content: [{ type: "image", data: "QUJD", mimeType: "image/png" }],
						timestamp: 0,
					},
				],
			},
			getCompat(model("kimi-k3")),
		);
		expect(messages).toMatchObject([
			{ role: "system", content: "" },
			{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] },
		]);
	});

	it("does not prepend a system message for providers that do not require it", () => {
		const other = getModels("deepseek").find((entry) => entry.id === "deepseek-flash");
		if (!other) throw new Error("Missing deepseek/deepseek-flash");
		const messages = convertMessages(
			other as Model<"openai-completions">,
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			getCompat(other as Model<"openai-completions">),
		);
		expect(messages[0]?.role).toBe("user");
	});

	it("uses the system role rather than developer, which the endpoint screens out", () => {
		const messages = convertMessages(
			model("gpt-5.6-sol"),
			{ systemPrompt: "prompt", messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			getCompat(model("gpt-5.6-sol")),
		);
		expect(messages[0]).toMatchObject({ role: "system", content: "prompt" });
		expect(messages.some((message) => message.role === "developer")).toBe(false);
	});
});
