import { getApiProvider } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { capturePayload, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { createCatalogRegistry } from "./omk-provider-golden-lib.ts";

afterEach(() => vi.unstubAllGlobals());

function model(id: "coder" | "reasoner") {
	const found = registryWithOmk().find("OMK", id);
	if (!found) throw new Error(`missing OMK/${id}`);
	return found;
}

describe("flag off", () => {
	// Runs first on purpose: provider registration is process-global once the flag is on.
	it("registers no OMK stream path and leaves the openai-completions provider alone", () => {
		const before = getApiProvider("openai-completions");
		registerOmkProviderIfEnabled(createCatalogRegistry(), { OMK_PROVIDER_OMK: "0", OMK_GATEWAY_BASE_URL: "x" });
		expect(getApiProvider("omk-completions")).toBeUndefined();
		expect(getApiProvider("openai-completions")).toBe(before);
	});
});

describe("OMK/reasoner calls without a reasoning level (compaction, summaries, other internal calls)", () => {
	it("go out as wire model `coder` with no thinking and no reasoning_effort", async () => {
		for (const options of [{}, { reasoning: undefined }]) {
			const payload = await capturePayload(model("reasoner"), options);
			expect(payload).toMatchObject({ model: "coder", max_tokens: 4096 });
			expect(payload).not.toHaveProperty("thinking");
			expect(payload).not.toHaveProperty("reasoning_effort");
		}
	});

	it("do not mutate the registered model: OMK/reasoner is still reasoner afterwards", async () => {
		const reasoner = model("reasoner");
		await capturePayload(reasoner, {});
		expect([reasoner.id, reasoner.reasoning]).toEqual(["reasoner", true]);
		expect(await capturePayload(reasoner, { reasoning: "low" })).toMatchObject({ model: "reasoner" });
	});
});

describe("OMK/reasoner calls with a reasoning level", () => {
	const inputs = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

	it.each(inputs)("level %s: wire model reasoner, thinking enabled, never disabled", async (level) => {
		const payload = await capturePayload(model("reasoner"), { reasoning: level as never });
		expect(payload.model).toBe("reasoner");
		expect(payload.thinking).toEqual({ type: "enabled" });
		expect(JSON.stringify(payload)).not.toContain("disabled");
	});

	it.each([
		["off", "low"],
		["minimal", "low"],
		["low", "low"],
		["medium", "low"],
		["high", "high"],
		["xhigh", "high"],
		["max", "high"],
	] as const)("effort mapping is pinned: %s goes out as reasoning_effort %s", async (level, effort) => {
		const payload = await capturePayload(model("reasoner"), { reasoning: level as never });
		expect(payload.reasoning_effort).toBe(effort);
	});
});

describe("OMK/coder", () => {
	it("keeps its own wire model and never gets thinking, with or without a level", async () => {
		for (const reasoning of [undefined, "high"] as const) {
			const payload = await capturePayload(model("coder"), { reasoning });
			expect(payload.model).toBe("coder");
			expect(payload).not.toHaveProperty("thinking");
			expect(payload).not.toHaveProperty("reasoning_effort");
		}
	});
});
