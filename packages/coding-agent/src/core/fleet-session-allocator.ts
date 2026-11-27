import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import {
	computeUnifiedSessionQuota,
	type FleetResourceLimits,
	MultiSessionResourceLedger,
	type UnifiedSessionQuotaDecision,
} from "./multi-session-resource-ledger.ts";

export class FleetResourceBudgetError extends Error {
	readonly code = "fleet_budget_denied";
	readonly decision: UnifiedSessionQuotaDecision;
	constructor(decision: UnifiedSessionQuotaDecision) {
		super(`omk.fleet_budget:${decision.reasons.join(",") || decision.status}`);
		this.name = "FleetResourceBudgetError";
		this.decision = decision;
	}
}

function parsePositiveIntEnv(name: string): number | undefined {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;
	const n = Number(raw);
	return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function resolveFleetLimitsFromEnv(): FleetResourceLimits | undefined {
	const maxTotalRssBytes = parsePositiveIntEnv("OMK_FLEET_MAX_RSS_BYTES");
	const maxTotalCpuSlots = parsePositiveIntEnv("OMK_FLEET_MAX_CPU_SLOTS");
	const maxTotalTokens = parsePositiveIntEnv("OMK_FLEET_MAX_TOKENS");
	if (maxTotalRssBytes === undefined && maxTotalCpuSlots === undefined && maxTotalTokens === undefined) {
		return undefined;
	}
	return {
		maxTotalRssBytes: maxTotalRssBytes ?? Number.MAX_SAFE_INTEGER,
		maxTotalCpuSlots: maxTotalCpuSlots ?? Number.MAX_SAFE_INTEGER,
		maxTotalTokens: maxTotalTokens ?? Number.MAX_SAFE_INTEGER,
	};
}

function sanitizeLeaseSessionId(raw: string): string {
	const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
	return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : `pid-${process.pid}`;
}

/**
 * Connects a live SessionRunBudget to the file-backed MultiSessionResourceLedger:
 * updates leases on execution/stream completion, enforces fleet limits when configured,
 * and releases the session lease on close.
 */
export class SessionFleetCoordinator {
	private tokensUsed = 0;
	private activeSessionId: string | undefined;
	private activeLedgerDir: string | undefined;

	private ledgerForEnv(): MultiSessionResourceLedger | undefined {
		if (process.env.OMK_FLEET_LEDGER === "0") return undefined;
		const dir = process.env.OMK_FLEET_LEDGER_DIR?.trim() || join(getAgentDir(), "run", "session-leases");
		this.activeLedgerDir = dir;
		return new MultiSessionResourceLedger(dir);
	}

	admitAndHeartbeat(rawSessionId: string | undefined, requestedTokens = 1): UnifiedSessionQuotaDecision | undefined {
		if (!rawSessionId) return undefined;
		const ledger = this.ledgerForEnv();
		if (!ledger) return undefined;
		const sessionId = sanitizeLeaseSessionId(rawSessionId);
		this.activeSessionId = sessionId;
		const limits = resolveFleetLimitsFromEnv();
		const nowMs = Date.now();
		let decision: UnifiedSessionQuotaDecision | undefined;
		if (limits) {
			const summary = ledger.snapshot(nowMs);
			decision = computeUnifiedSessionQuota(summary, limits, {
				sessionId,
				requestedCpuSlots: 1,
				requestedTokens: Math.max(1, requestedTokens),
			});
			if (decision.status === "deny_budget") {
				throw new FleetResourceBudgetError(decision);
			}
		}
		try {
			ledger.heartbeat({
				sessionId,
				pid: process.pid,
				rssBytes: process.memoryUsage().rss,
				cpuSlots: decision ? Math.max(1, decision.allocatedCpuSlots) : 1,
				tokensUsed: this.tokensUsed,
				...(decision &&
				Number.isFinite(decision.allocatedTokenCap) &&
				decision.allocatedTokenCap < Number.MAX_SAFE_INTEGER
					? { tokenBudgetCap: decision.allocatedTokenCap }
					: {}),
				updatedAtMs: nowMs,
			});
		} catch {
			// Fail-open on unwritable lease dir unless explicit fleet limits denied admission above.
		}
		return decision;
	}

	recordStreamUsage(rawSessionId: string | undefined, deltaTokens: number): void {
		if (!rawSessionId || !Number.isFinite(deltaTokens) || deltaTokens <= 0) return;
		this.tokensUsed += Math.floor(deltaTokens);
		const ledger = this.ledgerForEnv();
		if (!ledger) return;
		const sessionId = sanitizeLeaseSessionId(rawSessionId);
		this.activeSessionId = sessionId;
		try {
			ledger.heartbeat({
				sessionId,
				pid: process.pid,
				rssBytes: process.memoryUsage().rss,
				cpuSlots: 1,
				tokensUsed: this.tokensUsed,
				updatedAtMs: Date.now(),
			});
		} catch {
			// Best-effort heartbeat update on stream completion.
		}
	}

	release(rawSessionId?: string): void {
		const sid = rawSessionId ? sanitizeLeaseSessionId(rawSessionId) : this.activeSessionId;
		const dir =
			this.activeLedgerDir ??
			(process.env.OMK_FLEET_LEDGER_DIR?.trim() || join(getAgentDir(), "run", "session-leases"));
		if (!sid) return;
		try {
			new MultiSessionResourceLedger(dir).release(sid);
		} catch {
			// Best-effort lease cleanup on session close.
		}
		this.activeSessionId = undefined;
	}
}
