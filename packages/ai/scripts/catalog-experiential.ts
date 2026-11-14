#!/usr/bin/env node

import type { Model, ModelThinkingLevel, OpenAICompletionsCompat } from "../src/types.ts";

const BASE_URL = "https://api.experientiallabs.ai/v1";
const CATALOG_URL = "https://api.experientiallabs.ai/api/models";
const PROVIDER = "experientiallabs";
const LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
];

interface ExperientialCapabilities {
	supports_reasoning?: boolean;
	supported_reasoning_efforts?: string[];
	maximum_output_tokens?: number;
	chat_max_tokens_field?: string;
}

interface ExperientialProvider {
	id: string;
	provider: string;
	provider_model_id: string;
	billing_source?: string;
	input_nano_usd_per_million?: number | null;
	cached_input_nano_usd_per_million?: number | null;
	cache_write_input_nano_usd_per_million?: number | null;
	output_nano_usd_per_million?: number | null;
	capabilities?: ExperientialCapabilities;
	status?: string;
	routable?: boolean | null;
}

interface ExperientialModel {
	model: {
		slug: string;
		display_name: string;
		context_window?: number | null;
		max_input_tokens?: number | null;
		max_output_tokens?: number | null;
		input_modalities?: string[];
		output_modalities?: string[];
		supported_params?: { reasoning?: boolean; tools?: boolean };
	};
	providers?: ExperientialProvider[];
	default_provider_ids?: string[];
}

interface ExperientialCatalog {
	models: ExperientialModel[];
	total: number;
}

/**
 * The authenticated OpenAI-compatible `/v1/models` row. This is the surface OMK
 * actually calls, so its reasoning declaration wins over the public route
 * catalogue's upstream capabilities. GLM-5.2, for example, declares reasoning
 * on a route but answers 400 for `reasoning_effort` on the gateway surface.
 */
interface ExperientialSurfaceModel {
	id: string;
	supports_tools?: boolean;
	supports_reasoning?: boolean;
	supported_reasoning_efforts?: string[];
	chat_max_tokens_field?: string | null;
	maximum_output_tokens?: number | null;
	context_window_tokens?: number | null;
}

function pricePerMillion(nanoUsd: number | null | undefined): number {
	return typeof nanoUsd === "number" && Number.isFinite(nanoUsd) ? nanoUsd / 1_000_000_000 : 0;
}

function reasoningMap(efforts: readonly string[]): NonNullable<Model<"openai-completions">["thinkingLevelMap"]> {
	const supported = new Set(efforts);
	return Object.fromEntries(
		LEVELS.map((level) => {
			if (level === "off") return [level, supported.has("none") ? "none" : null];
			return [level, supported.has(level) ? level : null];
		}),
	) as NonNullable<Model<"openai-completions">["thinkingLevelMap"]>;
}

function pickRoute(row: ExperientialModel): ExperientialProvider | undefined {
	const active = (row.providers ?? []).filter(
		(provider) => provider.status === "active" && provider.routable === true,
	);
	const defaults = new Set(row.default_provider_ids ?? []);
	return (
		active.find((provider) => defaults.has(provider.id) && provider.billing_source === "host_managed") ??
		active.find((provider) => defaults.has(provider.id)) ??
		active.find((provider) => provider.billing_source === "host_managed") ??
		active[0]
	);
}

function buildModel(
	row: ExperientialModel,
	surface: ExperientialSurfaceModel | undefined,
): Model<"openai-completions"> | undefined {
	const model = row.model;
	if (!surface) return undefined;
	if (!(model.output_modalities ?? []).includes("text")) return undefined;
	if (!(surface.supports_tools ?? model.supported_params?.tools)) return undefined;

	const route = pickRoute(row);
	if (!route) return undefined;

	const efforts = surface.supported_reasoning_efforts ?? [];
	const reasoning = surface.supports_reasoning === true && efforts.length > 0;
	const pricingRoute =
		[route, ...(row.providers ?? []).filter((provider) => provider.status === "active")].find(
			(provider) => provider.input_nano_usd_per_million != null,
		) ?? route;
	const maxTokens =
		surface.maximum_output_tokens ??
		model.max_output_tokens ??
		route.capabilities?.maximum_output_tokens ??
		4096;
	const contextWindow = surface.context_window_tokens ?? model.context_window ?? model.max_input_tokens ?? 4096;
	const maxTokensField = surface.chat_max_tokens_field ?? route.capabilities?.chat_max_tokens_field;
	const compat: OpenAICompletionsCompat = {
		maxTokensField: maxTokensField === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
		supportsReasoningEffort: reasoning,
	};

	const result: Model<"openai-completions"> = {
		id: model.slug,
		name: model.display_name,
		api: "openai-completions",
		provider: PROVIDER,
		baseUrl: BASE_URL,
		reasoning,
		input: (model.input_modalities ?? []).includes("image") ? ["text", "image"] : ["text"],
		cost: {
			input: pricePerMillion(pricingRoute.input_nano_usd_per_million),
			output: pricePerMillion(pricingRoute.output_nano_usd_per_million),
			cacheRead: pricePerMillion(pricingRoute.cached_input_nano_usd_per_million),
			cacheWrite: pricePerMillion(pricingRoute.cache_write_input_nano_usd_per_million),
		},
		contextWindow,
		maxTokens: Math.max(1, maxTokens),
		compat,
	};
	if (reasoning) result.thinkingLevelMap = reasoningMap(efforts);
	// Muse Spark's wire vocabulary stops at xhigh; OMK's max label is an alias for it.
	if (reasoning && /muse-spark/i.test(result.id) && result.thinkingLevelMap?.xhigh === "xhigh") {
		result.thinkingLevelMap.max = "xhigh";
	}
	return result;
}

/**
 * Fetch every callable, routable, tool-capable text model. The public catalogue
 * supplies pricing and route metadata; the authenticated OpenAI-compatible
 * `/v1/models` supplies the reasoning contract and the callable set.
 */
export async function fetchExperientialModels(): Promise<Model<"openai-completions">[]> {
	const apiKey = process.env.EXPLABS_API_KEY ?? process.env.EXPERIENTIAL_API_KEY;
	if (!apiKey) {
		throw new Error(
			"EXPLABS_API_KEY or EXPERIENTIAL_API_KEY is required to read the Experiential Labs /v1/models reasoning surface",
		);
	}

	const rows: ExperientialModel[] = [];
	for (let offset = 0; ; offset += 1000) {
		const response = await fetch(`${CATALOG_URL}?limit=1000&offset=${offset}`, {
			signal: AbortSignal.timeout(60_000),
		});
		if (!response.ok) throw new Error(`Experiential Labs catalog HTTP ${response.status}`);
		const catalog = (await response.json()) as ExperientialCatalog;
		if (!Array.isArray(catalog.models) || !Number.isSafeInteger(catalog.total) || catalog.total <= 0) {
			throw new Error("Invalid Experiential Labs catalog page");
		}
		if (catalog.models.length === 0) throw new Error("Incomplete Experiential Labs catalog pagination");
		rows.push(...catalog.models);
		if (rows.length > catalog.total) throw new Error("Inconsistent Experiential Labs catalog total");
		if (rows.length === catalog.total) break;
	}

	const surfaceResponse = await fetch(`${BASE_URL}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(60_000),
	});
	if (!surfaceResponse.ok) throw new Error(`Experiential Labs /v1/models HTTP ${surfaceResponse.status}`);
	const surfaceBody = (await surfaceResponse.json()) as { data?: ExperientialSurfaceModel[] };
	if (!Array.isArray(surfaceBody.data) || surfaceBody.data.length === 0) {
		throw new Error("Invalid or empty Experiential Labs callable model list");
	}
	const surface = new Map(surfaceBody.data.map((model) => [model.id, model]));

	const models = rows
		.map((row) => buildModel(row, surface.get(row.model.slug)))
		.filter((model): model is Model<"openai-completions"> => model !== undefined);
	models.sort((a, b) => a.id.localeCompare(b.id));
	if (models.length === 0) throw new Error("Experiential Labs returned no callable tool-capable text models");
	return models;
}
