import { describe, expect, it } from "vitest";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import {
	createCatalogRegistry,
	FLAG_OFF_VARIANTS,
	GOLDEN_BASE_SHA,
	goldenOrUpdate,
	variantLabel,
	withFlag,
} from "./omk-provider-golden-lib.ts";

/** One `--model` / `--provider` invocation, as the CLI hands it to resolveCliModel. */
interface Invocation {
	provider?: string;
	model: string;
}

/** Short fuzzy patterns that a new OMK/* model could start to capture, plus canonical and OMK-shaped ids. */
const INVOCATIONS: Invocation[] = [
	{ model: "coder" },
	{ model: "reasoner" },
	{ model: "flash" },
	{ model: "deepseek" },
	{ model: "pro" },
	{ model: "omk" },
	{ model: "OMK" },
	{ model: "coder:high" },
	{ model: "reasoner:max" },
	{ model: "flash:off" },
	{ model: "deepseek/deepseek-flash" },
	{ model: "deepseek-flash" },
	{ model: "deepseek-flash:high" },
	{ model: "deepseek-v4-pro" },
	{ model: "DeepSeek/DeepSeek-V4-Pro" },
	{ model: "anthropic/claude-opus-4-8" },
	{ model: "openai/gpt-5.4" },
	{ model: "openrouter/deepseek/deepseek-chat" },
	{ model: "zai/glm-5.1" },
	{ model: "OMK/coder" },
	{ model: "OMK/reasoner" },
	{ model: "omk/coder" },
	{ model: "OMK/coder:high" },
	{ model: "OMK/unknown-model" },
	{ provider: "deepseek", model: "flash" },
	{ provider: "deepseek", model: "deepseek/deepseek-flash" },
	{ provider: "OMK", model: "coder" },
	{ provider: "OMK", model: "OMK/reasoner" },
	{ provider: "omk", model: "coder" },
];

interface Outcome {
	model: string | null;
	thinkingLevel: string | null;
	warning: string | null;
	error: string | null;
}
interface ResolverGolden {
	baseSha: string;
	outcomes: Record<string, Outcome>;
}

const keyOf = (inv: Invocation): string => `${inv.provider ? `--provider ${inv.provider} ` : ""}--model ${inv.model}`;

function resolveAll(flag: string | undefined): ResolverGolden {
	return withFlag(flag, () => {
		const modelRegistry = createCatalogRegistry();
		const outcomes: Record<string, Outcome> = {};
		for (const inv of INVOCATIONS) {
			const r = resolveCliModel({ cliProvider: inv.provider, cliModel: inv.model, modelRegistry });
			outcomes[keyOf(inv)] = {
				model: r.model ? `${r.model.provider}/${r.model.id}` : null,
				thinkingLevel: r.thinkingLevel ?? null,
				warning: r.warning ?? null,
				error: r.error ?? null,
			};
		}
		return { baseSha: GOLDEN_BASE_SHA, outcomes };
	});
}

describe("OMK provider flags-off: CLI model resolution golden", () => {
	const golden = goldenOrUpdate("resolver.golden.json", resolveAll(undefined));

	it("covers every invocation exactly once", () => {
		expect(Object.keys(golden.outcomes).sort()).toEqual(INVOCATIONS.map(keyOf).sort());
		expect(golden.baseSha).toBe(GOLDEN_BASE_SHA);
	});

	it("keeps today's behavior for the sanity anchors (golden is not vacuous)", () => {
		expect(golden.outcomes["--model deepseek/deepseek-flash"].model).toBe("deepseek/deepseek-flash");
		expect(golden.outcomes["--model deepseek-v4-pro"].model).toBe("deepseek/deepseek-v4-pro");
		expect(golden.outcomes["--model OMK/coder"].model).toBeNull();
		expect(golden.outcomes["--model OMK/coder"].error).toContain("not found");
		expect(golden.outcomes["--provider OMK --model coder"].error).toContain('Unknown provider "OMK"');
	});

	it.each(FLAG_OFF_VARIANTS.map((value) => [variantLabel(value), value] as const))(
		"OMK_PROVIDER_OMK=%s resolves every pattern exactly as main",
		(_label, value) => {
			expect(resolveAll(value).outcomes).toEqual(golden.outcomes);
		},
	);
});
