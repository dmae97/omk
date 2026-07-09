/**
 * OA adjudication fixture loader and in-memory AdaptOrch client for local/dev evaluation.
 */

import { readFile } from "node:fs/promises";
import type { AdaptOrchCallToolFn, AdaptOrchClient } from "../../../../adaptorch-wpl/src/index.ts";
import {
	createLiveAdaptOrchClient,
	createInMemoryAdaptOrchClient as createWplInMemoryClient,
	parseOaTransportModeFromEnv,
} from "../../../../adaptorch-wpl/src/index.ts";

/** Optional session-injected MCP `callTool` when `OMK_WALL_OA_TRANSPORT=mcp`. */
let wallAdaptOrchCallTool: AdaptOrchCallToolFn | undefined;

export function setWallAdaptOrchCallTool(fn: AdaptOrchCallToolFn | undefined): void {
	wallAdaptOrchCallTool = fn;
}

/** Minimal capability surface an extension host may expose for live MCP transport. */
export interface McpCallToolCapable {
	callMcpTool?(server: string, name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Default MCP server name used by the live adaptorch transport. */
export const ADAPTORCH_MCP_SERVER = "adaptorch";

/**
 * Build an {@link AdaptOrchCallToolFn} that forwards to a session MCP capability,
 * or return `undefined` when the host does not expose `callMcpTool`. The adaptorch
 * server name is used as the MCP target by default. Pure: does not touch module state.
 */
export function buildLiveCallToolFromCapability(
	api: McpCallToolCapable,
	server: string = ADAPTORCH_MCP_SERVER,
): AdaptOrchCallToolFn | undefined {
	if (typeof api.callMcpTool !== "function") return undefined;
	return (name, args) => api.callMcpTool!(server, name, args);
}

/**
 * Auto-wire live adaptorch MCP transport when the host exposes `callMcpTool`.
 * Called once from the extension entry. Idempotent and a no-op when the capability
 * is absent (fixture transport remains the default). Using the live client is still
 * gated by `OMK_WALL_OA_TRANSPORT=mcp` (explicit operator opt-in).
 */
export function autoWireLiveAdaptOrch(api: McpCallToolCapable): void {
	setWallAdaptOrchCallTool(buildLiveCallToolFromCapability(api));
}

export const CORRECTNESS_WALL_EXTENSION_VERSION = "1" as const;

/** Per-run payloads returned by fake adaptorch_get_run / _get_artifacts / _get_traces. */
export interface OaRunFixture {
	run: unknown;
	artifacts: unknown;
	traces: unknown;
}

export interface AdjudicationFixtureFile {
	/** Extension / fixture schema version (surfaced on verification receipts as wall_version). */
	wall_version?: string;
	/** Optional default dispatch record id for adjudication requests. */
	dispatchRecordId?: string;
	/** Map of AdaptOrch run_id → MCP tool payloads. */
	runsById: Record<string, OaRunFixture>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFixtureJson(raw: unknown): AdjudicationFixtureFile {
	if (!isRecord(raw)) {
		throw new Error("OA fixture root must be a JSON object");
	}
	const runsById = raw.runsById;
	if (!isRecord(runsById)) {
		throw new Error("OA fixture missing runsById object");
	}
	const normalized: Record<string, OaRunFixture> = {};
	for (const [runId, entry] of Object.entries(runsById)) {
		if (!isRecord(entry)) {
			throw new Error(`OA fixture runsById.${runId} must be an object`);
		}
		if (!("run" in entry) || !("artifacts" in entry) || !("traces" in entry)) {
			throw new Error(`OA fixture runsById.${runId} must include run, artifacts, and traces`);
		}
		normalized[runId] = {
			run: entry.run,
			artifacts: entry.artifacts,
			traces: entry.traces,
		};
	}
	return {
		wall_version:
			typeof raw.wall_version === "string" && raw.wall_version.length > 0
				? raw.wall_version
				: CORRECTNESS_WALL_EXTENSION_VERSION,
		dispatchRecordId: typeof raw.dispatchRecordId === "string" ? raw.dispatchRecordId : undefined,
		runsById: normalized,
	};
}

export async function loadAdjudicationFixtureFile(filePath: string): Promise<AdjudicationFixtureFile> {
	const text = await readFile(filePath, "utf-8");
	const parsed: unknown = JSON.parse(text);
	return parseFixtureJson(parsed);
}

/** In-memory {@link AdaptOrchClient} backed by fixture run payloads (delegates to omk-adaptorch-wpl). */
export function createInMemoryAdaptOrchClient(fixture: AdjudicationFixtureFile): AdaptOrchClient {
	return createWplInMemoryClient(fixture.runsById);
}

export function resolveAdjudicationFixturePath(toolParamPath?: string): string | undefined {
	const fromTool = toolParamPath?.trim();
	if (fromTool) return fromTool;
	const fromEnv = process.env.OMK_WALL_OA_FIXTURE_PATH?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export async function resolveOaClientForEvaluation(options: {
	previewOnly: boolean;
	runIds?: string[];
	adjudicationFixturePath?: string;
}): Promise<{ client?: AdaptOrchClient; fixture?: AdjudicationFixtureFile }> {
	const runIds = options.runIds ?? [];
	if (options.previewOnly || runIds.length === 0) {
		return {};
	}
	const transportMode = parseOaTransportModeFromEnv();
	if (transportMode === "mcp" && wallAdaptOrchCallTool !== undefined) {
		const fixturePath = resolveAdjudicationFixturePath(options.adjudicationFixturePath);
		const fixture = fixturePath !== undefined ? await loadAdjudicationFixtureFile(fixturePath) : undefined;
		return {
			client: createLiveAdaptOrchClient(wallAdaptOrchCallTool),
			fixture,
		};
	}
	const fixturePath = resolveAdjudicationFixturePath(options.adjudicationFixturePath);
	if (!fixturePath) {
		return {};
	}
	const fixture = await loadAdjudicationFixtureFile(fixturePath);
	return { client: createInMemoryAdaptOrchClient(fixture), fixture };
}

export function wallVersionFromFixture(fixture?: AdjudicationFixtureFile): string {
	return fixture?.wall_version ?? CORRECTNESS_WALL_EXTENSION_VERSION;
}
