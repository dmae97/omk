import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } from "../src/provider-models/descriptors";
import { alibabaCodingPlanModelManagerOptions } from "../src/provider-models/openai-compat";
import { getEnvApiKey } from "../src/stream";

const originalAlibabaApiKey = Bun.env.ALIBABA_CODING_PLAN_API_KEY;

afterEach(() => {
	if (originalAlibabaApiKey === undefined) {
		delete Bun.env.ALIBABA_CODING_PLAN_API_KEY;
		return;
	}
	Bun.env.ALIBABA_CODING_PLAN_API_KEY = originalAlibabaApiKey;
});

describe("alibaba-coding-plan provider support", () => {
	test("resolves ALIBABA_CODING_PLAN_API_KEY from environment", () => {
		Bun.env.ALIBABA_CODING_PLAN_API_KEY = "alibaba-test-key";
		expect(getEnvApiKey("alibaba-coding-plan")).toBe("alibaba-test-key");
	});

	test("registers built-in descriptor and default model", () => {
		const descriptor = PROVIDER_DESCRIPTORS.find(item => item.providerId === "alibaba-coding-plan");
		expect(descriptor).toBeDefined();
		expect(descriptor?.defaultModel).toBe("qwen3.5-plus");
		expect(DEFAULT_MODEL_PER_PROVIDER["alibaba-coding-plan"]).toBe("qwen3.5-plus");
	});

	test("builds model manager options with alibaba-coding-plan defaults", () => {
		const options = alibabaCodingPlanModelManagerOptions();
		expect(options.providerId).toBe("alibaba-coding-plan");
		expect(options.fetchDynamicModels).toBeDefined();
	});
});
