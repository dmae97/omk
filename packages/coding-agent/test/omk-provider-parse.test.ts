import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { createCatalogRegistry, FLAG_OFF_VARIANTS, variantLabel, withFlag } from "./omk-provider-golden-lib.ts";

/** Local stand-in for what PR (a) will register: test-only ids, a placeholder (non-secret) key and example URL. */
const FIXTURE_OMK_MODELS = ["coder", "reasoner"].map((id) => ({
	id,
	name: `fixture ${id}`,
	reasoning: id === "reasoner",
	input: ["text" as const],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
}));

function registryWithFixtureOmk(): ModelRegistry {
	const registry = createCatalogRegistry();
	registry.registerProvider("OMK", {
		api: "openai-completions",
		baseUrl: "https://gateway.invalid/v1",
		apiKey: "fixture-placeholder",
		models: FIXTURE_OMK_MODELS,
	});
	return registry;
}

const ref = (m: { provider: string; id: string } | undefined) => (m ? `${m.provider}/${m.id}` : null);

describe("`--model OMK/coder` parse level", () => {
	it("the CLI hands the raw string through unchanged", () => {
		expect(parseArgs(["--model", "OMK/coder"]).model).toBe("OMK/coder");
		const split = parseArgs(["--provider", "OMK", "--model", "coder"]);
		expect([split.provider, split.model]).toEqual(["OMK", "coder"]);
	});

	it("splits on the first slash into provider `OMK` and model `coder` once such a provider exists", () => {
		const registry = registryWithFixtureOmk();
		const resolved = resolveCliModel({ cliModel: "OMK/coder", modelRegistry: registry });
		expect(resolved.error).toBeUndefined();
		expect([resolved.model?.provider, resolved.model?.id]).toEqual(["OMK", "coder"]);
		// The provider prefix is matched case-insensitively but resolves to the canonical `OMK` spelling.
		expect(ref(resolveCliModel({ cliModel: "omk/reasoner", modelRegistry: registry }).model)).toBe("OMK/reasoner");
	});

	it.each(FLAG_OFF_VARIANTS.map((value) => [variantLabel(value), value] as const))(
		"OMK_PROVIDER_OMK=%s: nothing registers `OMK`, so `OMK/coder` fails to resolve exactly as on main",
		(_label, value) => {
			withFlag(value, () => {
				const registry = createCatalogRegistry();
				expect(registry.getAll().some((m) => m.provider === "OMK")).toBe(false);
				const resolved = resolveCliModel({ cliModel: "OMK/coder", modelRegistry: registry });
				expect(resolved.model).toBeUndefined();
				expect(resolved.error).toBe('Model "OMK/coder" not found. Use --list-models to see available models.');
				const explicit = resolveCliModel({ cliProvider: "OMK", cliModel: "coder", modelRegistry: registry });
				expect(explicit.error).toBe('Unknown provider "OMK". Use --list-models to see available providers/models.');
			});
		},
	);
});

describe("characterization of main's resolver (informs PR a; not a flag-off requirement)", () => {
	it("an exact bare id beats fuzzy matching, so bare `coder` WOULD move to a provider that owns id `coder`", () => {
		const before = ref(resolveCliModel({ cliModel: "coder", modelRegistry: createCatalogRegistry() }).model);
		const after = ref(resolveCliModel({ cliModel: "coder", modelRegistry: registryWithFixtureOmk() }).model);
		expect(after).toBe("OMK/coder");
		expect(before).not.toBe(after);
	});

	it("`--model OMK/...` never changes what deepseek/* patterns resolve to", () => {
		const base = createCatalogRegistry();
		const withOmk = registryWithFixtureOmk();
		for (const pattern of ["deepseek", "deepseek-flash", "deepseek/deepseek-flash", "deepseek-v4-pro"]) {
			const a = resolveCliModel({ cliModel: pattern, modelRegistry: base });
			const b = resolveCliModel({ cliModel: pattern, modelRegistry: withOmk });
			expect(ref(b.model)).toBe(ref(a.model));
		}
	});
});
