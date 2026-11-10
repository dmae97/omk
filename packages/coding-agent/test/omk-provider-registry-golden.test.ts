import { getOAuthProviders } from "omk-ai/oauth";
import { describe, expect, it } from "vitest";
import {
	canonicalJson,
	createCatalogRegistry,
	FLAG_OFF_VARIANTS,
	GOLDEN_BASE_SHA,
	goldenOrUpdate,
	sha256,
	variantLabel,
	withFlag,
} from "./omk-provider-golden-lib.ts";

interface RegistryGolden {
	baseSha: string;
	providerCount: number;
	modelCount: number;
	oauthProviderIds: string[];
	providers: Record<string, { count: number; sha256: string }>;
	sha256: string;
}

function snapshot(flag: string | undefined): RegistryGolden {
	return withFlag(flag, () => {
		const all = createCatalogRegistry().getAll();
		const byProvider = new Map<string, unknown[]>();
		for (const model of all) {
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		const providers: RegistryGolden["providers"] = {};
		for (const name of [...byProvider.keys()].sort()) {
			const models = byProvider.get(name) ?? [];
			providers[name] = { count: models.length, sha256: sha256(canonicalJson(models)) };
		}
		return {
			baseSha: GOLDEN_BASE_SHA,
			providerCount: byProvider.size,
			modelCount: all.length,
			oauthProviderIds: getOAuthProviders()
				.map((provider) => provider.id)
				.sort(),
			providers,
			// Order-sensitive on purpose: getAll() order is user-visible (model picker, --list-models).
			sha256: sha256(canonicalJson(all)),
		};
	});
}

describe("OMK provider flags-off: ModelRegistry.getAll() golden", () => {
	const golden = goldenOrUpdate("registry.golden.json", snapshot(undefined));

	it("golden was cut from the v1.5.11 base and contains no OMK provider", () => {
		expect(golden.baseSha).toBe(GOLDEN_BASE_SHA);
		expect(Object.keys(golden.providers)).not.toContain("OMK");
		expect(golden.oauthProviderIds).not.toContain("OMK");
		expect(golden.providers.deepseek?.count).toBe(3);
	});

	it.each(FLAG_OFF_VARIANTS.map((value) => [variantLabel(value), value] as const))(
		"OMK_PROVIDER_OMK=%s leaves the registry byte-identical to the golden",
		(_label, value) => {
			const current = snapshot(value);
			// Per-provider hashes first so a failure names the provider that drifted.
			expect(current.providers).toEqual(golden.providers);
			expect(current.providerCount).toBe(golden.providerCount);
			expect(current.modelCount).toBe(golden.modelCount);
			expect(current.oauthProviderIds).toEqual(golden.oauthProviderIds);
			expect(current.sha256).toBe(golden.sha256);
		},
	);

	it("all flag variants are identical to each other (survives a reviewed catalog refresh)", () => {
		const hashes = new Set(FLAG_OFF_VARIANTS.map((value) => snapshot(value).sha256));
		expect(hashes.size).toBe(1);
	});

	it("the flag does not leak between variants", () => {
		withFlag("1", () => undefined);
		expect(process.env.OMK_PROVIDER_OMK).toBeUndefined();
	});
});
