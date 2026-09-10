import { describe, expect, it } from "vitest";
import { applyModelContract } from "../src/provider-request.ts";
import { contract, model } from "./provider-request-fixtures.ts";

describe("contract payload observation", () => {
	it("accepts an unchanged provider payload with optional undefined fields", async () => {
		const options = applyModelContract(contract, model, { onPayload: (payload) => payload });
		const payload = { model: model.id, max_output_tokens: 1024, temperature: undefined };
		await expect(options.onPayload?.(payload, model)).resolves.toEqual(payload);
	});

	it("rejects an in-place mutation without changing the original payload", async () => {
		const options = applyModelContract(contract, model, {
			onPayload: (payload) => {
				if (typeof payload === "object" && payload !== null) Object.assign(payload, { model: "other" });
			},
		});
		const payload = { model: model.id };
		await expect(options.onPayload?.(payload, model)).rejects.toThrow();
		expect(payload.model).toBe(model.id);
	});

	it("does not expose mutable model metadata to an observation hook", async () => {
		const options = applyModelContract(contract, model, {
			onPayload: (payload, observedModel) => {
				observedModel.id = "changed";
				return payload;
			},
		});
		const selected = { ...model };
		await expect(options.onPayload?.({ model: model.id }, selected)).rejects.toThrow();
		expect(selected.id).toBe(model.id);
	});
});
