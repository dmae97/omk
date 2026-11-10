import { getOAuthProviders } from "omk-ai/oauth";
import { describe, expect, it } from "vitest";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { FIXTURE_TOKEN, GATEWAY_URL, ON_ENV, ref, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { canonicalJson, createCatalogRegistry, readGolden, sha256 } from "./omk-provider-golden-lib.ts";

interface RegistryGolden {
	modelCount: number;
	providers: Record<string, { count: number; sha256: string }>;
	sha256: string;
}
const golden = readGolden<RegistryGolden>("registry.golden.json");

describe("OMK provider registration with OMK_PROVIDER_OMK=1", () => {
	it("adds exactly OMK/coder and OMK/reasoner and nothing else", () => {
		const all = registryWithOmk().getAll();
		expect(all.filter((m) => m.provider === "OMK").map(ref)).toEqual(["OMK/coder", "OMK/reasoner"]);
		expect(all).toHaveLength(golden.modelCount + 2);
	});

	it("leaves every non-OMK model byte-identical to the flag-off golden, per provider and in order", () => {
		const rest = registryWithOmk()
			.getAll()
			.filter((m) => m.provider !== "OMK");
		expect(rest).toHaveLength(golden.modelCount);
		expect(sha256(canonicalJson(rest))).toBe(golden.sha256);
		for (const [name, expected] of Object.entries(golden.providers)) {
			const own = rest.filter((m) => m.provider === name);
			expect({ count: own.length, sha256: sha256(canonicalJson(own)) }).toEqual(expected);
		}
	});

	it("warns when OMK_GATEWAY_BASE_URL is missing or blank and registers the models with the unset-URL marker (omk-provider-base-url-missing.test.ts)", () => {
		for (const url of [undefined, "", "   "]) {
			const registry = createCatalogRegistry();
			const diagnostics = registerOmkProviderIfEnabled(registry, {
				OMK_PROVIDER_OMK: "1",
				OMK_GATEWAY_BASE_URL: url,
			});
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]).toMatchObject({ type: "warning" });
			expect(diagnostics[0].message).toContain("OMK_GATEWAY_BASE_URL");
			expect(registry.getAll()).toHaveLength(golden.modelCount + 2);
			expect(registry.find("OMK", "coder")?.baseUrl).toBe("https://omk-base-url-unset.invalid/v1");
		}
	});

	it("uses the URL from the env var as given (trailing slashes trimmed) and uses the OMK stream path (omk-completions)", () => {
		const registry = registryWithOmk({ ...ON_ENV, OMK_GATEWAY_BASE_URL: ` ${GATEWAY_URL}// ` });
		for (const id of ["coder", "reasoner"]) {
			expect(registry.find("OMK", id)).toMatchObject({ api: "omk-completions", baseUrl: GATEWAY_URL });
		}
	});

	it("both models are text-only with the specified limits and explicit compat", () => {
		for (const id of ["coder", "reasoner"]) {
			const model = registryWithOmk().find("OMK", id);
			expect(model).toMatchObject({ input: ["text"], contextWindow: 1_000_000, maxTokens: 384_000 });
			expect(model?.compat).toMatchObject({
				thinkingFormat: "deepseek",
				requiresReasoningContentOnAssistantMessages: true,
				maxTokensField: "max_tokens",
				supportsReasoningEffort: true,
			});
		}
		expect(registryWithOmk().find("OMK", "coder")?.reasoning).toBe(false);
		expect(registryWithOmk().find("OMK", "reasoner")?.reasoning).toBe(true);
	});

	it("no model id mentions deepseek, and the harness marker is not part of the registered model", () => {
		for (const model of registryWithOmk()
			.getAll()
			.filter((m) => m.provider === "OMK")) {
			expect(JSON.stringify(model).toLowerCase()).not.toContain("deepseek-chat");
			expect(`${model.id} ${model.name}`.toLowerCase()).not.toContain("deepseek");
			expect(model).not.toHaveProperty("harness");
		}
	});

	it("registers the /login token flow and is unavailable until a token exists (see omk-provider-login.test.ts)", () => {
		const previous = process.env.OMK_ACCOUNT_TOKEN;
		try {
			delete process.env.OMK_ACCOUNT_TOKEN;
			expect(
				registryWithOmk()
					.getAvailable()
					.filter((m) => m.provider === "OMK"),
			).toEqual([]);
			expect(getOAuthProviders().map((p) => p.id)).toContain("OMK");
		} finally {
			if (previous !== undefined) process.env.OMK_ACCOUNT_TOKEN = previous;
		}
	});

	it("has credentials only once OMK_ACCOUNT_TOKEN is set", () => {
		const previous = process.env.OMK_ACCOUNT_TOKEN;
		try {
			delete process.env.OMK_ACCOUNT_TOKEN;
			const registry = registryWithOmk();
			const model = registry.find("OMK", "coder");
			expect(model && registry.hasConfiguredAuth(model)).toBe(false);
			process.env.OMK_ACCOUNT_TOKEN = FIXTURE_TOKEN;
			expect(model && registry.hasConfiguredAuth(model)).toBe(true);
		} finally {
			if (previous === undefined) delete process.env.OMK_ACCOUNT_TOKEN;
			else process.env.OMK_ACCOUNT_TOKEN = previous;
		}
	});

	it("does nothing for every flag value other than the exact string 1", () => {
		for (const flag of [undefined, "0", "false", "true", "", " 1 ", "01", "yes"]) {
			const registry = createCatalogRegistry();
			const env = { OMK_PROVIDER_OMK: flag, OMK_GATEWAY_BASE_URL: GATEWAY_URL };
			expect(registerOmkProviderIfEnabled(registry, env)).toEqual([]);
			expect(sha256(canonicalJson(registry.getAll()))).toBe(golden.sha256);
		}
	});
});
