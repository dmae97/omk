/**
 * codex-chatgpt-web provider sync workflow: health check, account-aware catalog fetch, sync plan,
 * and the models.json rewrite. I/O arrives through `BridgeSyncIo`; expected failures are reported
 * as `BridgeSyncFailure` with a user-facing message that never carries a credential.
 */

import {
	type BridgeCatalogProvenance,
	type BridgeHealth,
	type BridgeSyncPlan,
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
} from "./codex-chatgpt-web-bridge.ts";

const LAUNCHER_HINT =
	"Start the Codex Web GPT launcher (it hosts the signed-in ChatGPT Web session and the local bridge), then retry.";
const LOGIN_HINT = "run /login openai-codex in OMK";

interface BridgeSyncResponse {
	readonly status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

interface BridgeSyncRequestInit {
	readonly signal: AbortSignal;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface BridgeSyncIo {
	readonly readFile: (path: string) => string;
	readonly writeFile: (path: string, text: string) => void;
	readonly fetch: (url: string, init: BridgeSyncRequestInit) => Promise<BridgeSyncResponse>;
	readonly getCodexAccessToken: () => Promise<string | undefined>;
	/** ISO timestamp for `bridgeCatalog.syncedAt`. */
	readonly now: () => string;
}

export interface BridgeSyncRequest {
	readonly providerId: string;
	readonly modelsPath: string;
	readonly timeoutMs: number;
	readonly clientVersion: string;
	readonly dryRun: boolean;
}

export interface BridgeSyncReport {
	readonly modelsPath: string;
	readonly baseUrl: string;
	readonly health: BridgeHealth;
	readonly clientVersion: string;
	readonly plan: BridgeSyncPlan;
	readonly bridgeCatalog: BridgeCatalogProvenance;
	readonly written: boolean;
}

export class BridgeSyncFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BridgeSyncFailure";
	}
}

interface LoadedProvider {
	readonly text: string;
	readonly baseUrl: string;
	readonly models: readonly ModelsJsonModel[];
	readonly bridgeCatalog: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasBridgeSyncChanges(plan: BridgeSyncPlan): boolean {
	return plan.changes.length + plan.added.length + plan.removed.length > 0;
}

/** Parse models.json once and narrow the target provider to the bridge shape this workflow can sync. */
function loadProvider(io: BridgeSyncIo, path: string, providerId: string): LoadedProvider {
	const text = io.readFile(path);
	let document: unknown;
	try {
		document = JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) throw new BridgeSyncFailure(`Could not read ${path}: ${error.message}`);
		throw error;
	}
	const provider = isRecord(document) && isRecord(document.providers) ? document.providers[providerId] : undefined;
	if (provider === undefined) throw new BridgeSyncFailure(`Provider "${providerId}" is not defined in ${path}.`);
	if (!isCodexChatGptWebProvider(provider)) {
		throw new BridgeSyncFailure(
			`Provider "${providerId}" is not a codex-chatgpt-web bridge: provider sync supports openai-responses providers with compat.sendCodexTurnMetadata: true.`,
		);
	}
	if (typeof provider.baseUrl !== "string") throw new BridgeSyncFailure(`Provider "${providerId}" has no baseUrl.`);
	const rows: readonly unknown[] = Array.isArray(provider.models) ? provider.models : [];
	const models = rows.flatMap((model) =>
		isRecord(model) && typeof model.id === "string" ? [{ ...model, id: model.id }] : [],
	);
	return { text, baseUrl: provider.baseUrl, models, bridgeCatalog: provider.bridgeCatalog };
}

async function request(io: BridgeSyncIo, url: string, init: BridgeSyncRequestInit): Promise<BridgeSyncResponse> {
	try {
		return await io.fetch(url, init);
	} catch (error) {
		if (error instanceof Error) {
			throw new BridgeSyncFailure(`Bridge request to ${url} failed (${error.message}). ${LAUNCHER_HINT}`);
		}
		throw error;
	}
}

async function checkHealth(io: BridgeSyncIo, baseUrl: string, timeoutMs: number): Promise<BridgeHealth> {
	const url = bridgeHealthUrl(baseUrl);
	const response = await request(io, url, { signal: AbortSignal.timeout(timeoutMs) });
	if (response.status !== 200) {
		throw new BridgeSyncFailure(`Bridge health check at ${url} returned HTTP ${response.status}. ${LAUNCHER_HINT}`);
	}
	const health = parseBridgeHealth(await response.json());
	if (!health)
		throw new BridgeSyncFailure(`${url} did not answer as codex-chatgpt-web; check the provider's baseUrl.`);
	return health;
}

async function fetchCatalog(io: BridgeSyncIo, sync: BridgeSyncRequest, baseUrl: string) {
	const token = await io.getCodexAccessToken();
	if (!token) {
		throw new BridgeSyncFailure(
			`The bridge forwards /v1/models to the Codex backend with your ChatGPT OAuth; ${LOGIN_HINT} first.`,
		);
	}
	const response = await request(io, bridgeModelsUrl(baseUrl, sync.clientVersion), {
		signal: AbortSignal.timeout(sync.timeoutMs),
		headers: { authorization: `Bearer ${token}` },
	});
	if (response.status === 401 || response.status === 403) {
		throw new BridgeSyncFailure(`The Codex backend rejected OMK's openai-codex OAuth token; ${LOGIN_HINT} again.`);
	}
	if (response.status !== 200) {
		const body = await response.text();
		throw new BridgeSyncFailure(`Bridge catalog request returned HTTP ${response.status}: ${body.slice(0, 300)}`);
	}
	const rows = parseBridgeCatalog(await response.json());
	if (rows === undefined) throw new BridgeSyncFailure("Bridge catalog response has no models array.");
	if (rows.length === 0) {
		throw new BridgeSyncFailure(
			`Bridge advertised no chatgpt-web/* models for client_version ${sync.clientVersion}; sign in to the launcher and press Install models.`,
		);
	}
	return rows;
}

/**
 * Run the sync. models.json is rewritten when a row changes or the recorded provenance no longer
 * describes the bridge (its version, the client version, or a ceiling moved); `dryRun` only reports.
 */
export async function syncCodexChatGptWebProvider(
	sync: BridgeSyncRequest,
	io: BridgeSyncIo,
): Promise<BridgeSyncReport> {
	const provider = loadProvider(io, sync.modelsPath, sync.providerId);
	const health = await checkHealth(io, provider.baseUrl, sync.timeoutMs);
	const rows = await fetchCatalog(io, sync, provider.baseUrl);
	const plan = planBridgeModelSync(provider.models, rows);
	const bridgeCatalog = bridgeCatalogProvenance(
		{ bridgeVersion: health.version, clientVersion: sync.clientVersion, syncedAt: io.now() },
		rows,
	);
	const stale = hasBridgeSyncChanges(plan) || !provenanceMatches(provider.bridgeCatalog, bridgeCatalog);
	const written = stale && !sync.dryRun;
	if (written) {
		const rewritten = rewriteProviderModels(provider.text, sync.providerId, { models: plan.models, bridgeCatalog });
		if (rewritten === undefined) throw new BridgeSyncFailure(`Could not rewrite ${sync.modelsPath}.`);
		io.writeFile(sync.modelsPath, rewritten);
	}
	return {
		modelsPath: sync.modelsPath,
		baseUrl: provider.baseUrl,
		health,
		clientVersion: sync.clientVersion,
		plan,
		bridgeCatalog,
		written,
	};
}
