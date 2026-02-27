import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } from "../src/provider-models/descriptors";
import { kiloModelManagerOptions } from "../src/provider-models/openai-compat";
import { getEnvApiKey } from "../src/stream";
import { getOAuthProviders } from "../src/utils/oauth";

const originalKiloApiKey = Bun.env.KILO_API_KEY;

afterEach(() => {
	if (originalKiloApiKey === undefined) {
		delete Bun.env.KILO_API_KEY;
		return;
	}
	Bun.env.KILO_API_KEY = originalKiloApiKey;
});

describe("kilo provider support", () => {
	test("resolves KILO_API_KEY from environment", () => {
		Bun.env.KILO_API_KEY = "kilo-test-key";
		expect(getEnvApiKey("kilo")).toBe("kilo-test-key");
	});

	test("registers built-in descriptor and default model", () => {
		const descriptor = PROVIDER_DESCRIPTORS.find(item => item.providerId === "kilo");
		expect(descriptor).toBeDefined();
		expect(descriptor?.defaultModel).toBe("anthropic/claude-sonnet-4.5");
		expect(descriptor?.catalogDiscovery?.envVars).toContain("KILO_API_KEY");
		expect(descriptor?.catalogDiscovery?.allowUnauthenticated).toBe(true);
		expect(DEFAULT_MODEL_PER_PROVIDER.kilo).toBe("anthropic/claude-sonnet-4.5");
	});

	test("registers Kilo in OAuth provider selector", () => {
		const provider = getOAuthProviders().find(item => item.id === "kilo");
		expect(provider?.name).toBe("Kilo Gateway");
	});
	test("builds model manager options with kilo defaults", () => {
		const options = kiloModelManagerOptions();
		expect(options.providerId).toBe("kilo");
		expect(options.fetchDynamicModels).toBeDefined();
	});
});
