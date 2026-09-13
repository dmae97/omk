import { getSupportedThinkingLevels } from "omk-ai";
import { getOAuthProvider } from "omk-ai/oauth";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { defaultModelPerProvider, findInitialModel, resolveCliModel } from "../src/core/model-resolver.ts";

function createRegistry(): ModelRegistry {
	return ModelRegistry.inMemory(
		AuthStorage.inMemory({
			devin: {
				type: "oauth",
				access: "devin-session-token$fixture",
				refresh: "fixture",
				expires: 4_000_000_000_000,
			},
		}),
	);
}

describe("Devin CLI subscription model selection", () => {
	it("makes the registered subscription available to the login picker", () => {
		expect(getOAuthProvider("devin")?.name).toBe("Devin CLI (subscription)");
	});

	it("selects SWE-2 with max through the real argument parser and resolver", () => {
		const args = parseArgs(["--provider", "devin", "--model", "swe-2", "--thinking", "max"]);
		expect(args.diagnostics).toEqual([]);
		expect(args.thinking).toBe("max");
		const registry = createRegistry();
		const result = resolveCliModel({ cliProvider: args.provider, cliModel: args.model, modelRegistry: registry });
		expect(result.model).toMatchObject({ provider: "devin", api: "devin-agent", id: "swe-2" });
		if (!result.model) throw new Error("Missing SWE-2");
		expect(getSupportedThinkingLevels(result.model)).toEqual(["medium", "high", "max"]);
		expect(result.model.contextWindow).toBe(1_000_000);
		expect(registry.getAvailable().some((model) => model.provider === "devin" && model.id === "swe-2")).toBe(true);
	});

	it("uses SWE-2 as the Devin provider default", async () => {
		expect(defaultModelPerProvider.devin).toBe("swe-2");
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "devin",
			modelRegistry: createRegistry(),
		});
		expect(result.model).toMatchObject({ provider: "devin", id: "swe-2" });
	});
});
