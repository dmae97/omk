import { describe, expect, it } from "vitest";
import {
	type BridgeCatalogProvenance,
	bridgeCatalogProvenance,
	bridgeHealthUrl,
	bridgeModelsUrl,
	isCodexChatGptWebProvider,
	type ModelsJsonModel,
	parseBridgeCatalog,
	parseBridgeHealth,
	planBridgeModelSync,
	provenanceMatches,
	rewriteProviderModels,
} from "../src/core/codex-chatgpt-web-bridge.ts";

/**
 * The launcher's /v1/models document is account-aware: the same chatgpt-web/* slug advertises a
 * 90K window on Plus and 333K on Pro with Bigger Context. models.json rows must follow that
 * document instead of a hardcoded guess, otherwise OMK compacts far too early or too late.
 *
 * The document carries two numbers per row: `context_window` is the bridge's rejection ceiling and
 * `auto_compact_token_limit` is the budget it expects a client to compact within (Codex's effective
 * window). OMK's `contextWindow` drives its own compaction policy, so it follows the budget; the
 * ceiling is kept as provenance on the provider.
 */

const BASE_URL = "http://127.0.0.1:17841/v1";

function catalogRow(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		slug,
		display_name: `ChatGPT Web — ${slug.slice("chatgpt-web/".length)}`,
		context_window: 333_579,
		max_context_window: 333_579,
		auto_compact_token_limit: 285_000,
		default_reasoning_level: "high",
		input_modalities: ["text", "image"],
		supported_in_api: true,
		visibility: "list",
		...overrides,
	};
}

const catalog = {
	models: [
		{ slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", context_window: 258_000, visibility: "list" },
		catalogRow("chatgpt-web/light", { default_reasoning_level: "low" }),
		catalogRow("chatgpt-web/high"),
		catalogRow("chatgpt-web/pro", { context_window: 336_579, default_reasoning_level: "ultra" }),
	],
};

describe("codex-chatgpt-web bridge: URLs and provider shape", () => {
	it("derives /healthz from the origin and /models from the versioned base URL", () => {
		expect(bridgeHealthUrl(BASE_URL)).toBe("http://127.0.0.1:17841/healthz");
		expect(bridgeHealthUrl(`${BASE_URL}/`)).toBe("http://127.0.0.1:17841/healthz");
		expect(bridgeModelsUrl(`${BASE_URL}/`, "0.147.0")).toBe(`${BASE_URL}/models?client_version=0.147.0`);
	});

	it("recognizes a bridge provider only by api plus the turn-metadata compat flag", () => {
		expect(isCodexChatGptWebProvider({ api: "openai-responses", compat: { sendCodexTurnMetadata: true } })).toBe(
			true,
		);
		expect(isCodexChatGptWebProvider({ api: "openai-responses", compat: { sendCodexTurnMetadata: false } })).toBe(
			false,
		);
		expect(isCodexChatGptWebProvider({ api: "openai-responses" })).toBe(false);
		expect(isCodexChatGptWebProvider({ api: "openai-completions", compat: { sendCodexTurnMetadata: true } })).toBe(
			false,
		);
		expect(isCodexChatGptWebProvider(null)).toBe(false);
	});
});

describe("codex-chatgpt-web bridge: /healthz", () => {
	it("parses the launcher health document", () => {
		const health = parseBridgeHealth({
			status: "ok",
			service: "codex-chatgpt-web",
			version: "5.0.4",
			mode: "full",
			accepting_turns: true,
		});

		expect(health).toEqual({ version: "5.0.4", mode: "full", acceptingTurns: true });
	});

	it("rejects documents from another service or with missing fields", () => {
		expect(parseBridgeHealth({ status: "ok", service: "other", version: "1.0.0", mode: "full" })).toBeUndefined();
		expect(parseBridgeHealth({ status: "ok", service: "codex-chatgpt-web" })).toBeUndefined();
		expect(parseBridgeHealth("ok")).toBeUndefined();
	});
});

describe("codex-chatgpt-web bridge: /v1/models", () => {
	it("keeps only chatgpt-web/* rows and reads their account-aware limits", () => {
		const rows = parseBridgeCatalog(catalog);

		expect(rows?.map((row) => row.id)).toEqual(["chatgpt-web/light", "chatgpt-web/high", "chatgpt-web/pro"]);
		expect(rows?.[2]).toEqual({
			id: "chatgpt-web/pro",
			name: "ChatGPT Web — pro",
			contextWindow: 336_579,
			autoCompactTokenLimit: 285_000,
			reasoningLevel: "ultra",
			input: ["text", "image"],
		});
	});

	it("returns undefined for a document without a models array", () => {
		expect(parseBridgeCatalog({ error: { message: "upstream" } })).toBeUndefined();
		expect(parseBridgeCatalog([])).toBeUndefined();
	});

	it("skips a chatgpt-web row whose limits are not positive integers", () => {
		const rows = parseBridgeCatalog({ models: [catalogRow("chatgpt-web/high", { context_window: "big" })] });

		expect(rows).toEqual([]);
	});
});

describe("codex-chatgpt-web bridge: sync plan", () => {
	const existing: readonly ModelsJsonModel[] = [
		{
			id: "chatgpt-web/high",
			name: "ChatGPT Web — High",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 90_000,
			maxTokens: 20_000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			thinkingLevelMap: { high: "high" },
		},
		{
			id: "chatgpt-web/extra-high",
			name: "ChatGPT Web — Extra High",
			reasoning: true,
			contextWindow: 111_193,
			maxTokens: 32_768,
		},
		{ id: "my-custom/passthrough", name: "Custom", contextWindow: 1 },
	];

	it("sets contextWindow to the bridge's compaction budget while preserving user-owned fields", () => {
		const plan = planBridgeModelSync(existing, parseBridgeCatalog(catalog) ?? []);
		const high = plan.models.find((model) => model.id === "chatgpt-web/high");

		expect(high?.contextWindow).toBe(285_000);
		expect(high?.name).toBe("ChatGPT Web — high");
		expect(high?.maxTokens).toBe(20_000);
		expect(high?.thinkingLevelMap).toEqual({ high: "high" });
		expect(plan.changes).toContainEqual({
			id: "chatgpt-web/high",
			field: "contextWindow",
			from: 90_000,
			to: 285_000,
		});
	});

	it("falls back to the ceiling when a row publishes no compaction budget", () => {
		const luna = catalogRow("chatgpt-web/luna", { auto_compact_token_limit: undefined, context_window: 1_050_000 });
		const plan = planBridgeModelSync([], parseBridgeCatalog({ models: [luna] }) ?? []);

		expect(plan.models[0]?.contextWindow).toBe(1_050_000);
	});

	it("adds rows the bridge advertises and drops chatgpt-web rows it no longer serves", () => {
		const plan = planBridgeModelSync(existing, parseBridgeCatalog(catalog) ?? []);

		expect(plan.added).toEqual(["chatgpt-web/light", "chatgpt-web/pro"]);
		expect(plan.removed).toEqual(["chatgpt-web/extra-high"]);
		const pro = plan.models.find((model) => model.id === "chatgpt-web/pro");
		expect(pro).toEqual({
			id: "chatgpt-web/pro",
			name: "ChatGPT Web — pro",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 285_000,
			maxTokens: 32_768,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			thinkingLevelMap: { max: "max" },
		});
		const light = plan.models.find((model) => model.id === "chatgpt-web/light");
		expect(light?.reasoning).toBe(false);
		expect(light?.thinkingLevelMap).toBeUndefined();
	});

	it("leaves rows outside the chatgpt-web namespace untouched and in place", () => {
		const plan = planBridgeModelSync(existing, parseBridgeCatalog(catalog) ?? []);

		expect(plan.models.find((model) => model.id === "my-custom/passthrough")).toEqual(existing[2]);
		expect(plan.models.map((model) => model.id)).toEqual([
			"chatgpt-web/high",
			"my-custom/passthrough",
			"chatgpt-web/light",
			"chatgpt-web/pro",
		]);
	});

	it("reports no changes when the rows already match", () => {
		const first = planBridgeModelSync(existing, parseBridgeCatalog(catalog) ?? []);
		const second = planBridgeModelSync(first.models, parseBridgeCatalog(catalog) ?? []);

		expect(second.changes).toEqual([]);
		expect(second.added).toEqual([]);
		expect(second.removed).toEqual([]);
	});
});

describe("codex-chatgpt-web bridge: provenance", () => {
	it("records the bridge, the client version, and every row's ceiling", () => {
		const provenance = bridgeCatalogProvenance(
			{ bridgeVersion: "5.0.4", clientVersion: "0.147.0", syncedAt: "2026-09-07T00:00:00.000Z" },
			parseBridgeCatalog(catalog) ?? [],
		);

		expect(provenance).toEqual({
			bridgeVersion: "5.0.4",
			clientVersion: "0.147.0",
			syncedAt: "2026-09-07T00:00:00.000Z",
			contextCeilings: { "chatgpt-web/light": 333_579, "chatgpt-web/high": 333_579, "chatgpt-web/pro": 336_579 },
		});
	});

	it("treats a re-sync as unchanged unless the bridge, client, or ceilings moved", () => {
		const base: BridgeCatalogProvenance = {
			bridgeVersion: "5.0.4",
			clientVersion: "0.147.0",
			syncedAt: "2026-09-07T00:00:00.000Z",
			contextCeilings: { "chatgpt-web/high": 333_579 },
		};

		expect(provenanceMatches({ ...base, syncedAt: "2026-09-08T00:00:00.000Z" }, base)).toBe(true);
		expect(provenanceMatches({ ...base, bridgeVersion: "5.0.5" }, base)).toBe(false);
		expect(provenanceMatches({ ...base, contextCeilings: { "chatgpt-web/high": 90_000 } }, base)).toBe(false);
		expect(provenanceMatches(undefined, base)).toBe(false);
		expect(provenanceMatches("5.0.4", base)).toBe(false);
	});
});

describe("codex-chatgpt-web bridge: models.json rewrite", () => {
	const provenance: BridgeCatalogProvenance = {
		bridgeVersion: "5.0.4",
		clientVersion: "0.147.0",
		syncedAt: "2026-09-07T00:00:00.000Z",
		contextCeilings: { "chatgpt-web/high": 333_579 },
	};
	const text = `{
  "providers": {
    "other": { "baseUrl": "https://example.test/v1", "models": [{ "id": "keep-me" }] },
    "codex-chatgpt-web": {
      "baseUrl": "http://127.0.0.1:17841/v1",
      "api": "openai-responses",
      "compat": { "sendCodexTurnMetadata": true },
      "models": [{ "id": "chatgpt-web/high", "contextWindow": 90000 }]
    }
  }
}
`;

	it("replaces the target provider's models and provenance, keeping every other key and the indentation", () => {
		const rewritten = rewriteProviderModels(text, "codex-chatgpt-web", {
			models: [{ id: "chatgpt-web/high", contextWindow: 285_000 }],
			bridgeCatalog: provenance,
		});

		expect(rewritten).toBeDefined();
		const parsed = JSON.parse(rewritten ?? "") as {
			providers: Record<string, { models: ModelsJsonModel[]; compat?: unknown; bridgeCatalog?: unknown }>;
		};
		expect(parsed.providers.other?.models).toEqual([{ id: "keep-me" }]);
		expect(parsed.providers["codex-chatgpt-web"]?.models).toEqual([
			{ id: "chatgpt-web/high", contextWindow: 285_000 },
		]);
		expect(parsed.providers["codex-chatgpt-web"]?.compat).toEqual({ sendCodexTurnMetadata: true });
		expect(parsed.providers["codex-chatgpt-web"]?.bridgeCatalog).toEqual(provenance);
		expect(rewritten?.startsWith('{\n  "providers"')).toBe(true);
		expect(rewritten?.endsWith("\n")).toBe(true);
	});

	it("returns undefined when the provider is missing so the caller never writes a guess", () => {
		expect(rewriteProviderModels(text, "absent", { models: [], bridgeCatalog: provenance })).toBeUndefined();
	});

	it("returns undefined for text that is not a models.json document", () => {
		const update = { models: [], bridgeCatalog: provenance };
		expect(rewriteProviderModels("{ not json", "codex-chatgpt-web", update)).toBeUndefined();
		expect(rewriteProviderModels('{"providers": []}', "codex-chatgpt-web", update)).toBeUndefined();
	});
});
