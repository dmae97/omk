import { z } from "zod";
import type { Model } from "../../types";

const DEFAULT_ANTIGRAVITY_DISCOVERY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const FETCH_AVAILABLE_MODELS_PATH = "/v1internal:fetchAvailableModels";
const DEFAULT_USER_AGENT = "antigravity/1.107.0 linux/amd64";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

/**
 * Raw model metadata returned by Antigravity's `fetchAvailableModels` endpoint.
 */
export interface AntigravityDiscoveryApiModel {
	displayName?: string;
	supportsImages?: boolean;
	supportsThinking?: boolean;
	thinkingBudget?: number;
	recommended?: boolean;
	maxTokens?: number;
	maxOutputTokens?: number;
	model?: string;
	apiProvider?: string;
	modelProvider?: string;
	isInternal?: boolean;
	supportsVideo?: boolean;
}

/**
 * Grouping metadata used by Antigravity to surface recommended model ids.
 */
export interface AntigravityDiscoveryAgentModelGroup {
	modelIds?: string[];
}

/**
 * Sort/group metadata used by Antigravity to surface recommended model ids.
 */
export interface AntigravityDiscoveryAgentModelSort {
	groups?: AntigravityDiscoveryAgentModelGroup[];
}

/**
 * Response payload returned by Antigravity's `fetchAvailableModels` endpoint.
 */
export interface AntigravityDiscoveryApiResponse {
	models?: Record<string, AntigravityDiscoveryApiModel>;
	agentModelSorts?: AntigravityDiscoveryAgentModelSort[];
}
const AntigravityDiscoveryApiModelSchema: z.ZodType<AntigravityDiscoveryApiModel> = z
	.object({
		displayName: z.preprocess(value => (typeof value === "string" ? value : undefined), z.string().optional()),
		supportsImages: z.preprocess(value => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
		supportsThinking: z.preprocess(value => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
		thinkingBudget: z.preprocess(
			value => (typeof value === "number" && Number.isFinite(value) ? value : undefined),
			z.number().optional(),
		),
		recommended: z.preprocess(value => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
		maxTokens: z.preprocess(
			value => (typeof value === "number" && Number.isFinite(value) ? value : undefined),
			z.number().optional(),
		),
		maxOutputTokens: z.preprocess(
			value => (typeof value === "number" && Number.isFinite(value) ? value : undefined),
			z.number().optional(),
		),
		model: z.preprocess(value => (typeof value === "string" ? value : undefined), z.string().optional()),
		apiProvider: z.preprocess(value => (typeof value === "string" ? value : undefined), z.string().optional()),
		modelProvider: z.preprocess(value => (typeof value === "string" ? value : undefined), z.string().optional()),
		isInternal: z.preprocess(value => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
		supportsVideo: z.preprocess(value => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
	})
	.passthrough();
const AntigravityDiscoveryAgentModelGroupSchema: z.ZodType<AntigravityDiscoveryAgentModelGroup> = z
	.object({
		modelIds: z.preprocess(
			value =>
				Array.isArray(value)
					? value.filter((modelId): modelId is string => typeof modelId === "string")
					: undefined,
			z.array(z.string()).optional(),
		),
	})
	.passthrough();
const AntigravityDiscoveryAgentModelSortSchema: z.ZodType<AntigravityDiscoveryAgentModelSort> = z
	.object({
		groups: z.preprocess(
			value => (Array.isArray(value) ? value : undefined),
			z
				.array(z.unknown())
				.transform(groups =>
					groups.flatMap(group => {
						const parsedGroup = AntigravityDiscoveryAgentModelGroupSchema.safeParse(group);
						return parsedGroup.success ? [parsedGroup.data] : [];
					}),
				)
				.optional(),
		),
	})
	.passthrough();
const AntigravityDiscoveryApiResponseSchema: z.ZodType<AntigravityDiscoveryApiResponse> = z
	.object({
		models: z.preprocess(
			value => (typeof value === "object" && value !== null ? value : undefined),
			z
				.record(z.string(), z.unknown())
				.transform(models => {
					const normalized: Record<string, AntigravityDiscoveryApiModel> = {};
					for (const [modelId, modelValue] of Object.entries(models)) {
						if (typeof modelValue !== "object" || modelValue === null) {
							continue;
						}
						const parsedModel = AntigravityDiscoveryApiModelSchema.safeParse(modelValue);
						if (parsedModel.success) {
							normalized[modelId] = parsedModel.data;
						}
					}
					return normalized;
				})
				.optional(),
		),
		agentModelSorts: z.preprocess(
			value => (Array.isArray(value) ? value : undefined),
			z
				.array(z.unknown())
				.transform(sorts =>
					sorts.flatMap(sort => {
						const parsedSort = AntigravityDiscoveryAgentModelSortSchema.safeParse(sort);
						return parsedSort.success ? [parsedSort.data] : [];
					}),
				)
				.optional(),
		),
	})
	.passthrough();

/**
 * Options for fetching Antigravity discovery models.
 */
export interface FetchAntigravityDiscoveryModelsOptions {
	/** OAuth access token used as `Authorization: Bearer <token>`. */
	token: string;
	/** Optional endpoint override. Defaults to Antigravity daily endpoint. */
	endpoint?: string;
	/** Optional project id. Defaults to an empty string for discovery. */
	project?: string;
	/** Optional user agent override. */
	userAgent?: string;
	/** Optional abort signal for request cancellation. */
	signal?: AbortSignal;
	/** Optional fetch implementation override for tests. */
	fetcher?: typeof fetch;
}

/**
 * Fetches discoverable Antigravity models and normalizes them into canonical model entries.
 *
 * Returns `null` on network/payload/auth failures.
 * Returns `[]` only when the endpoint responds successfully with no usable models.
 */
export async function fetchAntigravityDiscoveryModels(
	options: FetchAntigravityDiscoveryModelsOptions,
): Promise<Model<"google-gemini-cli">[] | null> {
	const fetcher = options.fetcher ?? fetch;
	const endpoint = trimTrailingSlashes(options.endpoint ?? DEFAULT_ANTIGRAVITY_DISCOVERY_ENDPOINT);

	let response: Response;
	try {
		response = await fetcher(`${endpoint}${FETCH_AVAILABLE_MODELS_PATH}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.token}`,
				"Content-Type": "application/json",
				"User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
			},
			body: JSON.stringify({ project: options.project ?? "" }),
			signal: options.signal,
		});
	} catch {
		return null;
	}

	if (!response.ok) {
		return null;
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return null;
	}

	const parsed = parseAntigravityDiscoveryResponse(payload);
	if (!parsed) {
		return null;
	}

	const recommendedIds = collectRecommendedModelIds(parsed.agentModelSorts ?? []);
	const models: Model<"google-gemini-cli">[] = [];

	for (const [modelId, model] of Object.entries(parsed.models ?? {})) {
		if (model.isInternal === true) {
			continue;
		}
		if (model.recommended !== true && !recommendedIds.has(modelId)) {
			continue;
		}

		const supportsImages = model.supportsImages === true;
		models.push({
			id: modelId,
			name: model.displayName ? `${model.displayName} (Antigravity)` : modelId,
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: endpoint,
			reasoning: model.supportsThinking === true,
			input: supportsImages ? ["text", "image"] : ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: toPositiveNumberOr(model.maxTokens, DEFAULT_CONTEXT_WINDOW),
			maxTokens: toPositiveNumberOr(model.maxOutputTokens, DEFAULT_MAX_TOKENS),
		});
	}

	models.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	return models;
}

function collectRecommendedModelIds(sorts: AntigravityDiscoveryAgentModelSort[]): Set<string> {
	const ids = new Set<string>();
	for (const sort of sorts) {
		for (const group of sort.groups ?? []) {
			for (const modelId of group.modelIds ?? []) {
				if (typeof modelId === "string" && modelId.length > 0) {
					ids.add(modelId);
				}
			}
		}
	}
	return ids;
}

function parseAntigravityDiscoveryResponse(value: unknown): AntigravityDiscoveryApiResponse | null {
	const parsed = AntigravityDiscoveryApiResponseSchema.safeParse(value);
	if (!parsed.success) {
		return null;
	}
	return parsed.data;
}

function trimTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

function toPositiveNumberOr(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
}
