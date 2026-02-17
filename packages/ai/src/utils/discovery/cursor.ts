import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { z } from "zod";
import { GetUsableModelsRequestSchema, GetUsableModelsResponseSchema } from "../../providers/cursor/gen/agent_pb";
import type { Model } from "../../types";

const CURSOR_DEFAULT_BASE_URL = "https://api2.cursor.sh";
const CURSOR_DEFAULT_CLIENT_VERSION = "cli-2026.01.09-231024f";
const CURSOR_GET_USABLE_MODELS_PATH = "/agent.v1.AgentService/GetUsableModels";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

const OptionalDisplayNameSchema = z.string().optional().catch(undefined);
const CursorAliasesSchema = z
	.array(z.unknown())
	.optional()
	.catch([])
	.transform(aliases => (aliases ?? []).filter((alias: unknown): alias is string => typeof alias === "string"));

const CursorModelDetailsSchema = z.object({
	modelId: z.string(),
	displayName: OptionalDisplayNameSchema,
	displayNameShort: OptionalDisplayNameSchema,
	displayModelId: OptionalDisplayNameSchema,
	aliases: CursorAliasesSchema,
	thinkingDetails: z.unknown().optional(),
});

const CursorDecodedResponseSchema = z.object({
	models: z.array(z.unknown()).optional().catch([]),
});

type CursorModelDetailsValue = z.infer<typeof CursorModelDetailsSchema>;

/**
 * Options for fetching dynamic Cursor models from `GetUsableModels`.
 */
export interface CursorModelDiscoveryOptions {
	/** Cursor access token used for bearer authentication. */
	apiKey: string;
	/** Optional Cursor API base URL override. */
	baseUrl?: string;
	/** Optional client version override sent as `x-cursor-client-version`. */
	clientVersion?: string;
	/** Optional request timeout in milliseconds. */
	timeoutMs?: number;
	/** Optional list of custom Cursor model ids to include in request context. */
	customModelIds?: string[];
	/** Optional fetch implementation override for tests. */
	fetchImpl?: typeof fetch;
}

/**
 * Fetches Cursor models through `GetUsableModels` and normalizes them into canonical model entries.
 *
 * Returns `null` on request/decode failures.
 * Returns `[]` only when the endpoint responds successfully with no usable models.
 */
export async function fetchCursorUsableModels(
	options: CursorModelDiscoveryOptions,
): Promise<Model<"cursor-agent">[] | null> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const signal = AbortSignal.timeout(timeoutMs);

	try {
		const requestPayload = create(GetUsableModelsRequestSchema, {
			customModelIds: normalizeCustomModelIds(options.customModelIds),
		});
		const response = await fetchImpl(buildCursorUrl(options.baseUrl), {
			method: "POST",
			headers: {
				"content-type": "application/connect+proto",
				"connect-protocol-version": "1",
				te: "trailers",
				authorization: `Bearer ${options.apiKey}`,
				"x-ghost-mode": "true",
				"x-cursor-client-version": options.clientVersion ?? CURSOR_DEFAULT_CLIENT_VERSION,
				"x-cursor-client-type": "cli",
			},
			body: encodeConnectUnaryMessage(toBinary(GetUsableModelsRequestSchema, requestPayload)),
			signal,
		});

		if (!response.ok) {
			return null;
		}

		const responseBuffer = new Uint8Array(await response.arrayBuffer());
		const decoded = decodeGetUsableModelsResponse(responseBuffer);
		const parsedDecoded = CursorDecodedResponseSchema.safeParse(decoded);
		if (!parsedDecoded.success) {
			return null;
		}

		return normalizeCursorModels(parsedDecoded.data.models, options.baseUrl);
	} catch {
		return null;
	}
}

function buildCursorUrl(baseUrl?: string): string {
	return `${(baseUrl ?? CURSOR_DEFAULT_BASE_URL).replace(/\/+$/, "")}${CURSOR_GET_USABLE_MODELS_PATH}`;
}

function normalizeCustomModelIds(customModelIds: readonly string[] | undefined): string[] {
	if (!customModelIds) {
		return [];
	}
	const normalized = new Set<string>();
	for (const value of customModelIds) {
		if (typeof value !== "string") {
			continue;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		normalized.add(trimmed);
	}
	return [...normalized];
}

function encodeConnectUnaryMessage(payload: Uint8Array): Uint8Array {
	const framed = new Uint8Array(5 + payload.length);
	framed[0] = 0;
	const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
	view.setUint32(1, payload.length, false);
	framed.set(payload, 5);
	return framed;
}

function decodeGetUsableModelsResponse(payload: Uint8Array) {
	if (payload.length === 0) {
		return null;
	}

	const framedBody = decodeConnectUnaryBody(payload);
	if (framedBody) {
		try {
			return fromBinary(GetUsableModelsResponseSchema, framedBody);
		} catch {
			return null;
		}
	}

	try {
		return fromBinary(GetUsableModelsResponseSchema, payload);
	} catch {
		return null;
	}
}

function decodeConnectUnaryBody(payload: Uint8Array): Uint8Array | null {
	if (payload.length < 5) {
		return null;
	}

	const flags = payload[0];
	if (typeof flags !== "number") {
		return null;
	}

	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	const messageLength = view.getUint32(1, false);
	const totalLength = 5 + messageLength;
	if (totalLength !== payload.length) {
		return null;
	}

	const compressionFlagSet = (flags & 0b0000_0001) !== 0;
	const endStreamFlagSet = (flags & 0b0000_0010) !== 0;
	if (compressionFlagSet || endStreamFlagSet) {
		return null;
	}

	return payload.subarray(5);
}

function normalizeCursorModels(
	models: readonly unknown[] | undefined,
	baseUrlOverride?: string,
): Model<"cursor-agent">[] {
	if (!models || models.length === 0) {
		return [];
	}

	const byId = new Map<string, Model<"cursor-agent">>();
	for (const model of models) {
		const normalized = normalizeCursorModel(model, baseUrlOverride);
		if (!normalized) {
			continue;
		}
		byId.set(normalized.id, normalized);
	}

	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeCursorModel(model: unknown, baseUrlOverride?: string): Model<"cursor-agent"> | null {
	const parsedModel = CursorModelDetailsSchema.safeParse(model);
	if (!parsedModel.success) {
		return null;
	}

	const details = parsedModel.data;
	const id = details.modelId.trim();
	if (!id) {
		return null;
	}

	const name = pickModelDisplayName(details, id);
	return {
		id,
		name,
		api: "cursor-agent",
		provider: "cursor",
		baseUrl: baseUrlOverride ?? CURSOR_DEFAULT_BASE_URL,
		reasoning: Boolean(details.thinkingDetails),
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	};
}

function pickModelDisplayName(model: CursorModelDetailsValue, fallbackId: string): string {
	const candidates = [model.displayName, model.displayNameShort, model.displayModelId, ...model.aliases, fallbackId];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}
		const trimmed = candidate.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return fallbackId;
}
