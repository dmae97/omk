import type { Api, Model } from "../src/types.ts";

const BASE_URL = "https://api.groq.com/openai/v1";

interface GroqModel {
	id: string;
	name?: string;
	active?: boolean;
	context_window?: number;
	max_completion_tokens?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	supported_features?: string[];
	pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
}

function positiveLimit(value: number | undefined, fallback: number | undefined): number {
	const limit = value ?? fallback;
	if (!Number.isSafeInteger(limit) || limit === undefined || limit <= 0) {
		throw new Error("Invalid Groq context/output limit");
	}
	return limit;
}

function price(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const number = Number(value);
	const perMillion = number * 1_000_000;
	if (typeof value !== "string" || !value.trim() || !Number.isFinite(perMillion) || number < 0) {
		throw new Error("Invalid Groq pricing");
	}
	return perMillion;
}

/** Use the authenticated callable set when configured; never downgrade a failed query to an empty catalog. */
export async function fetchGroqModels(metadata: Model<Api>[]): Promise<Model<Api>[]> {
	const apiKey = process.env.GROQ_API_KEY?.trim();
	if (!apiKey) return metadata;
	const response = await fetch(`${BASE_URL}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(60_000),
	});
	if (!response.ok) throw new Error(`Groq models HTTP ${response.status}`);
	const body = (await response.json()) as { data?: GroqModel[]; has_more?: boolean; total?: number };
	if (!Array.isArray(body?.data) || body.data.length === 0 || body.has_more || (body.total !== undefined && body.total !== body.data.length)) {
		throw new Error("Invalid or incomplete Groq model list");
	}
	const known = new Map(metadata.map((model) => [model.id, model]));
	const ids = new Set<string>();
	const models: Model<Api>[] = [];
	for (const row of body.data) {
		if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) {
			throw new Error("Invalid or duplicate Groq model id");
		}
		ids.add(row.id);
		const previous = known.get(row.id);
		for (const values of [row.supported_features, row.input_modalities, row.output_modalities]) {
			if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string"))) {
				throw new Error("Invalid Groq capability declaration");
			}
		}
		if (row.active !== undefined && typeof row.active !== "boolean") throw new Error("Invalid Groq active flag");
		if (row.active === false) continue;
		if (row.input_modalities && !row.input_modalities.includes("text")) continue;
		if (row.supported_features ? !row.supported_features.includes("tools") : !previous) continue;
		if (row.output_modalities && !row.output_modalities.includes("text")) continue;
		const reasoning = row.supported_features?.includes("reasoning") ?? previous?.reasoning ?? false;
		models.push({
			...previous,
			id: row.id,
			name: row.name ?? previous?.name ?? row.id,
			api: "openai-completions",
			provider: "groq",
			baseUrl: BASE_URL,
			reasoning,
			thinkingLevelMap: reasoning ? previous?.thinkingLevelMap : undefined,
			input: row.input_modalities ? (row.input_modalities.includes("image") ? ["text", "image"] : ["text"]) : previous?.input ?? ["text"],
			contextWindow: positiveLimit(row.context_window, previous?.contextWindow),
			maxTokens: positiveLimit(row.max_completion_tokens, previous?.maxTokens),
			cost: {
				input: price(row.pricing?.prompt, previous?.cost.input ?? 0),
				output: price(row.pricing?.completion, previous?.cost.output ?? 0),
				cacheRead: price(row.pricing?.input_cache_read, previous?.cost.cacheRead ?? 0),
				cacheWrite: price(row.pricing?.input_cache_write, previous?.cost.cacheWrite ?? 0),
			},
		});
	}
	if (!models.length) throw new Error("Groq returned no tool-capable text models");
	return models.sort((a, b) => a.id.localeCompare(b.id));
}
