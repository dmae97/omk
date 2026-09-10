import type { Model } from "omk-ai";
import { describe, expect, it, vi } from "vitest";
import { streamSimpleOpenAICompletions } from "../../ai/src/providers/openai-completions.ts";
import { applyModelContract } from "../src/provider-request.ts";
import { contract, model as fixture } from "./provider-request-fixtures.ts";

const model: Model<"openai-completions"> = { ...fixture, api: "openai-completions" };

async function inspectPayload(payload: unknown, maxTokens?: number) {
	const options = applyModelContract(contract, model, { maxTokens });
	return options.onPayload?.(payload, model);
}

describe("Chat Completions final-payload contract", () => {
	it.each(["max_tokens", "max_completion_tokens"])("accepts a valid %s cap", async (field) => {
		await expect(inspectPayload({ model: model.id, [field]: 512 })).resolves.toBeUndefined();
	});

	it("checks serialized model identity even without an observation hook", async () => {
		await expect(inspectPayload({ model: "unexpected-model", max_tokens: 512 })).rejects.toThrow();
	});

	it.each(["model", "limit"])("blocks HTTP dispatch when the adapter receives a changed %s", async (changed) => {
		const transport = vi.fn(() => {
			throw new Error("Unexpected fixture network call");
		});
		vi.stubGlobal("fetch", transport);
		try {
			const options = applyModelContract(contract, model, {});
			const result = await streamSimpleOpenAICompletions(
				changed === "model" ? { ...model, id: "other" } : model,
				{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
				{ ...options, apiKey: "fixture-key", maxTokens: changed === "limit" ? 2048 : 512 },
			).result();
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/model contract/i);
			expect(transport).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it.each([undefined, null, 0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "512", 2048])(
		"rejects a missing, invalid, or excessive wire cap: %s",
		async (max_tokens) => {
			await expect(inspectPayload({ model: model.id, max_tokens })).rejects.toThrow();
		},
	);

	it("enforces the smaller explicit request cap, not just the run cap", async () => {
		await expect(inspectPayload({ model: model.id, max_tokens: 513 }, 512)).rejects.toThrow();
	});

	it("refuses ambiguous output-limit fields", async () => {
		await expect(inspectPayload({ model: model.id, max_tokens: 512, max_completion_tokens: 512 })).rejects.toThrow();
	});

	it.each([null, [], "payload"].map((payload) => ({ payload })))(
		"refuses a malformed payload: $payload",
		async ({ payload }) => {
			await expect(inspectPayload(payload)).rejects.toThrow();
		},
	);

	it("validates the wire payload before calling an observer", async () => {
		const observer = vi.fn();
		const options = applyModelContract(contract, model, { onPayload: observer });
		await expect(options.onPayload?.({ model: model.id, max_tokens: 2048 }, model)).rejects.toThrow();
		expect(observer).not.toHaveBeenCalled();
	});

	it("pins model identity before an asynchronous credential resolver can mutate metadata", async () => {
		const selected = { ...model };
		const options = applyModelContract(contract, selected, {});
		selected.id = "changed-after-validation";
		await expect(
			Promise.resolve(options.onPayload?.({ model: selected.id, max_tokens: 512 }, selected)),
		).rejects.toThrow();
	});

	it("does not clone a large payload without a user observer, including nested SDK enforcement", async () => {
		const clone = vi.spyOn(globalThis, "structuredClone");
		try {
			const outer = applyModelContract(contract, model, {});
			const inner = applyModelContract(contract, model, outer);
			await expect(
				Promise.resolve(inner.onPayload?.({ model: model.id, max_tokens: 512 }, model)),
			).resolves.toBeUndefined();
			expect(clone).not.toHaveBeenCalled();
		} finally {
			clone.mockRestore();
		}
	});

	it("preserves immutable observation under nested SDK enforcement", async () => {
		const outer = applyModelContract(contract, model, {
			onPayload: (payload) => {
				if (typeof payload === "object" && payload !== null) Object.assign(payload, { max_tokens: 2048 });
			},
		});
		const inner = applyModelContract(contract, model, outer);
		const payload = { model: model.id, max_tokens: 512 };
		await expect(inner.onPayload?.(payload, model)).rejects.toThrow();
		expect(payload.max_tokens).toBe(512);
	});
});
