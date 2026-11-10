import { describe, expect, it } from "vitest";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { ref, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { readGolden } from "./omk-provider-golden-lib.ts";

interface Outcome {
	model: string | null;
	thinkingLevel: string | null;
	warning: string | null;
	error: string | null;
}
const golden = readGolden<{ outcomes: Record<string, Outcome> }>("resolver.golden.json").outcomes;

/** Turns a golden key (`--provider P --model M` or `--model M`) back into resolveCliModel input. */
function resolve(key: string): Outcome {
	const match = /^(?:--provider (\S+) )?--model (.+)$/.exec(key);
	if (!match) throw new Error(`bad golden key ${key}`);
	const r = resolveCliModel({ cliProvider: match[1], cliModel: match[2], modelRegistry: registryWithOmk() });
	return {
		model: ref(r.model),
		thinkingLevel: r.thinkingLevel ?? null,
		warning: r.warning ?? null,
		error: r.error ?? null,
	};
}

/** Patterns that name OMK explicitly: they are allowed (and expected) to change once the provider exists. */
const EXPLICIT_OMK = /omk/i;

describe("CLI model resolution with OMK_PROVIDER_OMK=1", () => {
	it("resolves --model OMK/coder and OMK/reasoner (any case of the provider) to the OMK models", () => {
		expect(resolve("--model OMK/coder")).toMatchObject({ model: "OMK/coder", error: null });
		expect(resolve("--model OMK/reasoner")).toMatchObject({ model: "OMK/reasoner", error: null });
		expect(resolve("--model omk/coder")).toMatchObject({ model: "OMK/coder", error: null });
		expect(resolve("--provider OMK --model coder")).toMatchObject({ model: "OMK/coder", error: null });
		expect(resolve("--provider OMK --model OMK/reasoner")).toMatchObject({ model: "OMK/reasoner", error: null });
		expect(resolve("--model OMK/coder:high")).toMatchObject({ model: "OMK/coder", thinkingLevel: "high" });
	});

	it("an unlisted OMK id is passed through with a warning, like any other known provider", () => {
		const outcome = resolve("--model OMK/unknown-model");
		expect(outcome.model).toBe("OMK/unknown-model");
		expect(outcome.warning).toContain("unknown-model");
	});

	it("every short or canonical pattern that does not mention OMK resolves exactly as on main", () => {
		const keys = Object.keys(golden).filter((k) => !EXPLICIT_OMK.test(k));
		expect(keys.length).toBeGreaterThanOrEqual(15);
		for (const key of keys) expect({ key, ...resolve(key) }).toEqual({ key, ...golden[key] });
		for (const key of ["--model flash", "--model deepseek", "--model pro", "--model deepseek/deepseek-flash"]) {
			expect(keys).toContain(key);
		}
	});

	it("deepseek/* ids and provider-scoped deepseek patterns are untouched", () => {
		expect(resolve("--model deepseek/deepseek-flash").model).toBe("deepseek/deepseek-flash");
		expect(resolve("--model deepseek-v4-pro").model).toBe("deepseek/deepseek-v4-pro");
		expect(resolve("--provider deepseek --model flash")).toEqual(golden["--provider deepseek --model flash"]);
	});

	it("bare `coder` and `reasoner` are not captured: coder -> qwen3-coder-plus, reasoner -> not found, as on main", () => {
		expect(resolve("--model coder").model).toBe("experientiallabs/qwen3-coder-plus");
		expect(resolve("--model reasoner").model).toBeNull();
		expect(resolve("--model reasoner").error).toContain("not found");
		for (const key of ["--model coder", "--model reasoner", "--model coder:high", "--model reasoner:max"]) {
			expect({ key, ...resolve(key) }).toEqual({ key, ...golden[key] });
		}
	});

	it("only the full reference or an explicit --provider reaches OMK: OMK/coder and --provider OMK --model coder", () => {
		expect(resolve("--model OMK/coder").model).toBe("OMK/coder");
		expect(resolve("--provider OMK --model coder").model).toBe("OMK/coder");
		expect(resolve("--model omk/reasoner").model).toBe("OMK/reasoner");
	});
});
