/**
 * Persists latest correctness-wall verdict metadata under .omk/wall-cache (no diff, no secrets).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserVerdict, VerdictCard } from "../../../../adaptorch-wpl/src/index.ts";

export type WallMode = "shadow" | "soft" | "hard";

export interface WallVerdictCacheEntry {
	mode: WallMode;
	verdict: UserVerdict;
	wouldBlock: boolean;
	verdictCardSummary: {
		verdict: UserVerdict;
		risk: VerdictCard["risk"];
		kind: string;
		blockedReasonCount: number;
		passedCheckCount: number;
		firstBlockedReason?: string;
		firstNextAction?: string;
	};
	timestamp: string;
}

/** Shadow-mode telemetry line (append-only NDJSON; no diff or secrets). */
export interface WallShadowTelemetryEvent {
	event: "correctness_wall_shadow";
	wall_version: string;
	mode: WallMode;
	verdict: UserVerdict;
	wouldBlock: boolean;
	kind: string;
	tool?: "edit" | "write" | "correctness_wall_evaluate";
	previewOnly: boolean;
	usedOaFixture: boolean;
	timestamp: string;
}

const CACHE_REL = join(".omk", "wall-cache", "latest.json");
const SHADOW_TELEMETRY_REL = join(".omk", "wall-cache", "shadow-telemetry.ndjson");

function summarizeVerdictCard(card: VerdictCard): WallVerdictCacheEntry["verdictCardSummary"] {
	return {
		verdict: card.verdict,
		risk: card.risk,
		kind: card.kind,
		blockedReasonCount: card.blocked_reasons.length,
		passedCheckCount: card.passed_checks.length,
		firstBlockedReason: card.blocked_reasons[0],
		firstNextAction: card.next_actions[0],
	};
}

export async function writeVerdictCache(
	cwd: string,
	entry: {
		mode: WallMode;
		verdict: UserVerdict;
		wouldBlock: boolean;
		verdictCard: VerdictCard;
	},
): Promise<void> {
	const payload: WallVerdictCacheEntry = {
		mode: entry.mode,
		verdict: entry.verdict,
		wouldBlock: entry.wouldBlock,
		verdictCardSummary: summarizeVerdictCard(entry.verdictCard),
		timestamp: new Date().toISOString(),
	};
	const dir = join(cwd, ".omk", "wall-cache");
	await mkdir(dir, { recursive: true });
	await writeFile(join(cwd, CACHE_REL), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export async function appendShadowTelemetry(cwd: string, event: WallShadowTelemetryEvent): Promise<void> {
	const dir = join(cwd, ".omk", "wall-cache");
	await mkdir(dir, { recursive: true });
	await writeFile(join(cwd, SHADOW_TELEMETRY_REL), `${JSON.stringify(event)}\n`, { flag: "a" });
}
