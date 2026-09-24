import { expect, it } from "vitest";
import { createOpenAiWasmTokenCounter } from "../src/core/context-budget-token-counter.ts";
import { validateMcpTimeoutMs } from "../src/core/mcp/deadline-policy.ts";
import { mcpPublicDiagnostic } from "../src/core/mcp/public-diagnostic.ts";
import { validateMcpCallResult } from "../src/core/mcp/result-contract.ts";
import { RunBudget } from "../src/core/run-budget.ts";
import { countTokenizerModule, validateTokenCountResult } from "../src/core/tokenizer-module-adapter.ts";

it("uses the real token-counter caller for WASM snake_case and releases its encoder", () => {
	let freed = 0;
	const module = {
		encoding_for_model: () => ({
			encode: () => new Uint32Array([1, 2]),
			free: () => {
				freed++;
			},
		}),
	};
	const counter = createOpenAiWasmTokenCounter({
		resolve: (name) => (name === "tiktoken" ? name : undefined),
		load: () => module,
	});
	expect(counter.countText("fixture", "gpt-4o").tokens).toBe(2);
	expect(freed).toBe(1);
	expect(countTokenizerModule({ encode: () => [1] }, "fixture", "text", "unknown", "cl100k_base")?.method).toBe(
		"estimated",
	);
});
it("rejects malformed results and poisonous numeric inputs", () => {
	expect(() => validateMcpCallResult({ content: [], isError: "true" })).toThrow();
	expect(() => validateMcpTimeoutMs(Number.NaN)).toThrow();
	expect(() =>
		validateTokenCountResult(
			{ tokens: -1, method: "exact", confidence: "high", adapterId: "fixture", modelId: "fixture", notes: [] },
			"fixture",
		),
	).toThrow();
});
it("owns unbounded budgets without granting a cancellation-based refund", () => {
	const budget = new RunBudget(undefined, () => {});
	const release = budget.admit();
	budget.close();
	expect(budget.snapshot().activeRequests).toBe(1);
	release();
	release();
	expect(budget.snapshot().activeRequests).toBe(0);
});
it("does not include raw error payloads in manager diagnostics", () => {
	expect(mcpPublicDiagnostic(new Error("fixture-secret"), "connect")).toBe("mcp.connect_failed (Error)");
});
