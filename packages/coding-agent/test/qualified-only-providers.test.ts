import { afterEach, describe, expect, it } from "vitest";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { markQualifiedOnlyProvider, resetQualifiedOnlyProviders } from "../src/core/qualified-only-providers.ts";
import { createCatalogRegistry, readGolden } from "./omk-provider-golden-lib.ts";

/** Stand-in provider: placeholder key and `.invalid` host, nothing here touches the network. */
function registryWithOmk() {
	const registry = createCatalogRegistry();
	registry.registerProvider("OMK", {
		api: "openai-completions",
		baseUrl: "https://gateway.invalid/v1",
		apiKey: "fixture-placeholder",
		models: ["coder", "reasoner"].map((id) => ({
			id,
			name: `OMK ${id}`,
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		})),
	});
	return registry;
}

interface Outcome {
	model: string | null;
	thinkingLevel: string | null;
	warning: string | null;
	error: string | null;
}
const golden = readGolden<{ outcomes: Record<string, Outcome> }>("resolver.golden.json").outcomes;

function resolve(key: string): Outcome {
	const match = /^(?:--provider (\S+) )?--model (.+)$/.exec(key);
	if (!match) throw new Error(`bad golden key ${key}`);
	const r = resolveCliModel({ cliProvider: match[1], cliModel: match[2], modelRegistry: registryWithOmk() });
	return {
		model: r.model ? `${r.model.provider}/${r.model.id}` : null,
		thinkingLevel: r.thinkingLevel ?? null,
		warning: r.warning ?? null,
		error: r.error ?? null,
	};
}

afterEach(() => resetQualifiedOnlyProviders());

describe("qualified-only providers in model resolution", () => {
	it("control: an unmarked OMK provider captures bare `coder` and `reasoner` (the problem being fixed)", () => {
		expect(resolve("--model coder").model).toBe("OMK/coder");
		expect(resolve("--model reasoner").model).toBe("OMK/reasoner");
	});

	it("marked: short patterns resolve exactly as on main (coder -> qwen3-coder-plus, reasoner -> not found)", () => {
		markQualifiedOnlyProvider("OMK");
		expect(resolve("--model coder").model).toBe("experientiallabs/qwen3-coder-plus");
		expect(resolve("--model reasoner")).toEqual(golden["--model reasoner"]);
		expect(resolve("--model reasoner").error).toContain("not found");
	});

	it("marked: every golden pattern that does not mention OMK is identical to main", () => {
		markQualifiedOnlyProvider("OMK");
		const keys = Object.keys(golden).filter((key) => !/omk/i.test(key));
		expect(keys.length).toBeGreaterThanOrEqual(15);
		for (const key of keys) expect({ key, ...resolve(key) }).toEqual({ key, ...golden[key] });
	});

	it("marked: the full reference and the provider-scoped forms still resolve to OMK", () => {
		markQualifiedOnlyProvider("OMK");
		expect(resolve("--model OMK/coder")).toMatchObject({ model: "OMK/coder", error: null });
		expect(resolve("--model omk/reasoner")).toMatchObject({ model: "OMK/reasoner", error: null });
		expect(resolve("--model OMK/coder:high")).toMatchObject({ model: "OMK/coder", thinkingLevel: "high" });
		expect(resolve("--provider OMK --model coder")).toMatchObject({ model: "OMK/coder", error: null });
		expect(resolve("--provider OMK --model OMK/reasoner")).toMatchObject({ model: "OMK/reasoner", error: null });
	});

	it("marking is per provider: other providers' bare and fuzzy matches are unaffected", () => {
		markQualifiedOnlyProvider("OMK");
		expect(resolve("--model deepseek-v4-pro").model).toBe("deepseek/deepseek-v4-pro");
		expect(resolve("--model flash")).toEqual(golden["--model flash"]);
	});
});
