/**
 * codex-chatgpt-web bridge catalog.
 *
 * The launcher (https://github.com/miuuyy/codex-chatgpt-web) serves a loopback Responses bridge
 * whose `/v1/models` document is account-aware: a `chatgpt-web/*` slug advertises a 90K context
 * window on Plus and 333K on Pro with Bigger Context. This module reads that document and derives
 * the models.json rows for the provider, so OMK compacts on the bridge's real limits instead of a
 * hardcoded guess. Network and file I/O stay in the caller.
 */

export const CODEX_CHATGPT_WEB_MODEL_PREFIX = "chatgpt-web/";
/**
 * Codex CLI version the bridge catalog was last verified against (2026-09-07). The Codex backend
 * gates model visibility by `client_version`; a stale value yields an empty or partial catalog.
 */
export const CODEX_CHATGPT_WEB_FALLBACK_CLIENT_VERSION = "0.147.0";
const BRIDGE_SERVICE_NAME = "codex-chatgpt-web";
const DEFAULT_MAX_TOKENS = 32_768;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export type ModelInput = "text" | "image";

export interface BridgeHealth {
	readonly version: string;
	readonly mode: string;
	readonly acceptingTurns: boolean;
}

export interface BridgeCatalogRow {
	readonly id: string;
	readonly name: string;
	readonly contextWindow: number;
	readonly autoCompactTokenLimit: number | undefined;
	readonly reasoningLevel: string;
	readonly input: readonly ModelInput[];
}

/** One models.json model row. Keys OMK does not derive are carried through untouched. */
export interface ModelsJsonModel {
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly reasoning?: boolean;
	readonly input?: readonly ModelInput[];
	readonly thinkingLevelMap?: Readonly<Record<string, string>>;
	readonly cost?: Readonly<Record<string, number>>;
	readonly [extra: string]: unknown;
}

export type SyncedField = "name" | "contextWindow" | "reasoning" | "input";

export interface ModelFieldChange {
	readonly id: string;
	readonly field: SyncedField;
	readonly from: unknown;
	readonly to: unknown;
}

export interface BridgeSyncPlan {
	readonly models: readonly ModelsJsonModel[];
	readonly added: readonly string[];
	readonly removed: readonly string[];
	readonly changes: readonly ModelFieldChange[];
}

/** Where the provider's rows came from, stored on the provider so the numbers stay explainable. */
export interface BridgeCatalogProvenance {
	readonly bridgeVersion: string;
	readonly clientVersion: string;
	readonly syncedAt: string;
	/** The bridge's rejection ceiling per row; `contextWindow` follows its compaction budget instead. */
	readonly contextCeilings: Readonly<Record<string, number>>;
}

export interface ProviderSyncUpdate {
	readonly models: readonly ModelsJsonModel[];
	readonly bridgeCatalog: BridgeCatalogProvenance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isModelInput(value: unknown): value is ModelInput {
	return value === "text" || value === "image";
}

export function bridgeHealthUrl(baseUrl: string): string {
	return new URL("/healthz", baseUrl).toString();
}

export function bridgeModelsUrl(baseUrl: string, clientVersion: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/models?client_version=${encodeURIComponent(clientVersion)}`;
}

/** The models.json provider shape this module can sync; other keys pass through untouched. */
export interface CodexChatGptWebProviderConfig {
	readonly api: "openai-responses";
	readonly compat: { readonly sendCodexTurnMetadata: true };
	readonly baseUrl?: unknown;
	readonly models?: unknown;
	readonly [extra: string]: unknown;
}

/** A models.json provider is the bridge when it speaks Responses and opts into Codex turn metadata. */
export function isCodexChatGptWebProvider(provider: unknown): provider is CodexChatGptWebProviderConfig {
	return (
		isRecord(provider) &&
		provider.api === "openai-responses" &&
		isRecord(provider.compat) &&
		provider.compat.sendCodexTurnMetadata === true
	);
}

export function parseBridgeHealth(value: unknown): BridgeHealth | undefined {
	if (!isRecord(value) || value.service !== BRIDGE_SERVICE_NAME) return undefined;
	if (typeof value.version !== "string" || typeof value.mode !== "string") return undefined;
	return { version: value.version, mode: value.mode, acceptingTurns: value.accepting_turns === true };
}

function parseCatalogRow(value: unknown): BridgeCatalogRow | undefined {
	if (!isRecord(value) || typeof value.slug !== "string") return undefined;
	if (!value.slug.startsWith(CODEX_CHATGPT_WEB_MODEL_PREFIX)) return undefined;
	if (!isPositiveInteger(value.context_window)) return undefined;
	const modalities = Array.isArray(value.input_modalities) ? value.input_modalities.filter(isModelInput) : [];
	return {
		id: value.slug,
		name: typeof value.display_name === "string" && value.display_name.length > 0 ? value.display_name : value.slug,
		contextWindow: value.context_window,
		autoCompactTokenLimit: isPositiveInteger(value.auto_compact_token_limit)
			? value.auto_compact_token_limit
			: undefined,
		reasoningLevel: typeof value.default_reasoning_level === "string" ? value.default_reasoning_level : "low",
		input: modalities.length > 0 ? modalities : ["text"],
	};
}

/** `chatgpt-web/*` rows of a `/v1/models` document; undefined when the document has no models array. */
export function parseBridgeCatalog(value: unknown): readonly BridgeCatalogRow[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.models)) return undefined;
	return value.models.flatMap((entry) => {
		const row = parseCatalogRow(entry);
		return row ? [row] : [];
	});
}

/** OMK thinking levels the bridge's fixed effort corresponds to; the bridge ignores the request effort. */
function thinkingLevelMap(reasoningLevel: string): Readonly<Record<string, string>> | undefined {
	switch (reasoningLevel) {
		case "xhigh":
			return { xhigh: "xhigh" };
		case "ultra":
			return { max: "max" };
		default:
			return undefined;
	}
}

/**
 * OMK compacts within `contextWindow` by its own headroom policy, so the row carries the budget the
 * bridge expects a client to compact within (`auto_compact_token_limit`, Codex's effective window)
 * rather than the rejection ceiling. Rows without a budget (Luna) use the ceiling itself.
 */
function derivedFields(row: BridgeCatalogRow): Pick<ModelsJsonModel, SyncedField> {
	return {
		name: row.name,
		contextWindow: row.autoCompactTokenLimit ?? row.contextWindow,
		reasoning: row.reasoningLevel !== "low",
		input: row.input,
	};
}

function newModel(row: BridgeCatalogRow): ModelsJsonModel {
	const levels = thinkingLevelMap(row.reasoningLevel);
	return {
		id: row.id,
		...derivedFields(row),
		maxTokens: DEFAULT_MAX_TOKENS,
		cost: ZERO_COST,
		...(levels ? { thinkingLevelMap: levels } : {}),
	};
}

function fieldChanges(existing: ModelsJsonModel, row: BridgeCatalogRow): readonly ModelFieldChange[] {
	const next = derivedFields(row);
	const fields: readonly SyncedField[] = ["name", "contextWindow", "reasoning", "input"];
	return fields.flatMap((field) => {
		const from = existing[field];
		const to = next[field];
		return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ id: existing.id, field, from, to }];
	});
}

/**
 * Merge the bridge catalog into the provider's models: derived fields follow the catalog, rows the
 * bridge no longer serves are dropped, and everything else (user-owned fields, other namespaces,
 * ordering) is preserved.
 */
export function planBridgeModelSync(
	existing: readonly ModelsJsonModel[],
	rows: readonly BridgeCatalogRow[],
): BridgeSyncPlan {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const changes: ModelFieldChange[] = [];
	const removed: string[] = [];
	const kept: ModelsJsonModel[] = [];
	for (const model of existing) {
		if (!model.id.startsWith(CODEX_CHATGPT_WEB_MODEL_PREFIX)) {
			kept.push(model);
			continue;
		}
		const row = byId.get(model.id);
		if (!row) {
			removed.push(model.id);
			continue;
		}
		changes.push(...fieldChanges(model, row));
		kept.push({ ...model, ...derivedFields(row) });
	}
	const seen = new Set(existing.map((model) => model.id));
	const added = rows.filter((row) => !seen.has(row.id));
	return {
		models: [...kept, ...added.map(newModel)],
		added: added.map((row) => row.id),
		removed,
		changes,
	};
}

export function bridgeCatalogProvenance(
	source: Omit<BridgeCatalogProvenance, "contextCeilings">,
	rows: readonly BridgeCatalogRow[],
): BridgeCatalogProvenance {
	return { ...source, contextCeilings: Object.fromEntries(rows.map((row) => [row.id, row.contextWindow])) };
}

/** True when the stored provenance already describes this catalog; `syncedAt` alone never forces a rewrite. */
export function provenanceMatches(stored: unknown, next: BridgeCatalogProvenance): boolean {
	if (!isRecord(stored)) return false;
	return (
		stored.bridgeVersion === next.bridgeVersion &&
		stored.clientVersion === next.clientVersion &&
		JSON.stringify(stored.contextCeilings) === JSON.stringify(next.contextCeilings)
	);
}

function detectIndent(text: string): string {
	if (/^\t+"/m.test(text)) return "\t";
	const spaces = /^( +)"/m.exec(text);
	return spaces?.[1] ?? "  ";
}

/**
 * Replace one provider's `models` array and `bridgeCatalog` provenance in a models.json document,
 * preserving every other key and the file's indentation. Undefined when the text is not a JSON
 * document with that provider, so a caller never writes a guess.
 */
export function rewriteProviderModels(
	modelsJsonText: string,
	providerId: string,
	update: ProviderSyncUpdate,
): string | undefined {
	let document: unknown;
	try {
		document = JSON.parse(modelsJsonText);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (!isRecord(document) || !isRecord(document.providers)) return undefined;
	const provider = document.providers[providerId];
	if (!isRecord(provider)) return undefined;
	const providers = { ...document.providers, [providerId]: { ...provider, ...update } };
	const serialized = JSON.stringify({ ...document, providers }, null, detectIndent(modelsJsonText));
	return modelsJsonText.endsWith("\n") ? `${serialized}\n` : serialized;
}
