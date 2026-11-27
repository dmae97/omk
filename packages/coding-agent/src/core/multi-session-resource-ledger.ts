import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

let nextLeaseTempSeq = 1;

import { join } from "node:path";

export const MULTI_SESSION_LEASE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SESSION_LEASE_TTL_MS = 60_000;
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface SessionResourceLeaseInput {
	readonly sessionId: string;
	readonly pid: number;
	readonly rssBytes: number;
	readonly cpuSlots: number;
	readonly tokensUsed: number;
	readonly tokenBudgetCap?: number;
	readonly updatedAtMs: number;
}

export interface SessionResourceLeaseRecord extends SessionResourceLeaseInput {
	readonly schemaVersion: typeof MULTI_SESSION_LEASE_SCHEMA_VERSION;
}

export interface FleetResourceSummary {
	readonly activeSessions: number;
	readonly prunedStaleSessions: number;
	readonly totalRssBytes: number;
	readonly totalCpuSlots: number;
	readonly totalTokensUsed: number;
	readonly sessions: readonly SessionResourceLeaseRecord[];
}

export interface FleetResourceLimits {
	readonly maxTotalRssBytes: number;
	readonly maxTotalCpuSlots: number;
	readonly maxTotalTokens: number;
}

export interface SessionQuotaRequest {
	readonly sessionId: string;
	readonly requestedCpuSlots: number;
	readonly requestedTokens: number;
}

export type FleetQuotaReason =
	| "fleet.ram.exceeded"
	| "fleet.cpu.saturated"
	| "fleet.tokens.exhausted"
	| "fleet.fair_share.throttled";

export type FleetAdmissionStatus = "allow" | "throttle" | "deny_budget";

export interface UnifiedSessionQuotaDecision {
	readonly status: FleetAdmissionStatus;
	readonly remainingRssBytes: number;
	readonly remainingCpuSlots: number;
	readonly remainingTokens: number;
	readonly allocatedCpuSlots: number;
	readonly allocatedTokenCap: number;
	readonly reasons: readonly FleetQuotaReason[];
}

function assertSafeSessionId(sessionId: string): void {
	if (!SAFE_SESSION_ID.test(sessionId) || sessionId === "." || sessionId === "..") {
		throw new RangeError(`invalid sessionId: ${sessionId}`);
	}
}

function isNonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseLeaseRecord(raw: unknown): SessionResourceLeaseRecord | null {
	if (!raw || typeof raw !== "object") return null;
	const rec = raw as Record<string, unknown>;
	if (rec.schemaVersion !== MULTI_SESSION_LEASE_SCHEMA_VERSION) return null;
	if (typeof rec.sessionId !== "string" || !SAFE_SESSION_ID.test(rec.sessionId)) return null;
	if (typeof rec.pid !== "number" || !Number.isInteger(rec.pid) || rec.pid <= 0) return null;
	if (
		!isNonNegativeFinite(rec.rssBytes) ||
		!isNonNegativeFinite(rec.cpuSlots) ||
		!isNonNegativeFinite(rec.tokensUsed) ||
		!isNonNegativeFinite(rec.updatedAtMs)
	) {
		return null;
	}
	if (rec.tokenBudgetCap !== undefined && !isNonNegativeFinite(rec.tokenBudgetCap)) return null;
	return {
		schemaVersion: MULTI_SESSION_LEASE_SCHEMA_VERSION,
		sessionId: rec.sessionId,
		pid: rec.pid,
		rssBytes: Math.floor(rec.rssBytes),
		cpuSlots: Math.floor(rec.cpuSlots),
		tokensUsed: Math.floor(rec.tokensUsed),
		...(rec.tokenBudgetCap !== undefined ? { tokenBudgetCap: Math.floor(rec.tokenBudgetCap) } : {}),
		updatedAtMs: Math.floor(rec.updatedAtMs),
	};
}

export function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
		return code === "EPERM";
	}
}

/**
 * File-backed cross-session resource ledger for independent OMK processes.
 * Atomic write+rename prevents partial reads; dead PIDs and expired TTL leases self-prune.
 */
export class MultiSessionResourceLedger {
	readonly directory: string;
	private readonly ttlMs: number;

	constructor(directory: string, options?: { readonly ttlMs?: number }) {
		if (directory.trim().length === 0) throw new RangeError("ledger directory must not be empty");
		this.directory = directory;
		this.ttlMs = Math.max(1_000, Math.floor(options?.ttlMs ?? DEFAULT_SESSION_LEASE_TTL_MS));
	}

	heartbeat(input: SessionResourceLeaseInput): SessionResourceLeaseRecord {
		assertSafeSessionId(input.sessionId);
		const record = parseLeaseRecord({ ...input, schemaVersion: MULTI_SESSION_LEASE_SCHEMA_VERSION });
		if (!record) throw new RangeError("invalid session resource lease payload");
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const targetPath = join(this.directory, `${record.sessionId}.json`);
		const tempPath = join(this.directory, `.${record.sessionId}.${process.pid}.${nextLeaseTempSeq++}.tmp`);
		writeFileSync(tempPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(tempPath, targetPath);
		return record;
	}

	release(sessionId: string): void {
		assertSafeSessionId(sessionId);
		rmSync(join(this.directory, `${sessionId}.json`), { force: true });
	}

	snapshot(nowMs = Date.now(), isPidAlive: (pid: number) => boolean = defaultIsPidAlive): FleetResourceSummary {
		let entries: string[];
		try {
			entries = readdirSync(this.directory);
		} catch {
			return {
				activeSessions: 0,
				prunedStaleSessions: 0,
				totalRssBytes: 0,
				totalCpuSlots: 0,
				totalTokensUsed: 0,
				sessions: [],
			};
		}

		const sessions: SessionResourceLeaseRecord[] = [];
		let prunedStaleSessions = 0;
		let totalRssBytes = 0;
		let totalCpuSlots = 0;
		let totalTokensUsed = 0;

		for (const name of entries.sort()) {
			if (!name.endsWith(".json") || name.startsWith(".")) continue;
			const fullPath = join(this.directory, name);
			let parsed: SessionResourceLeaseRecord | null = null;
			try {
				parsed = parseLeaseRecord(JSON.parse(readFileSync(fullPath, "utf8")));
			} catch {
				parsed = null;
			}
			if (parsed === null || nowMs - parsed.updatedAtMs > this.ttlMs || !isPidAlive(parsed.pid)) {
				rmSync(fullPath, { force: true });
				prunedStaleSessions += 1;
				continue;
			}
			sessions.push(parsed);
			totalRssBytes += parsed.rssBytes;
			totalCpuSlots += parsed.cpuSlots;
			totalTokensUsed += parsed.tokensUsed;
		}

		return {
			activeSessions: sessions.length,
			prunedStaleSessions,
			totalRssBytes,
			totalCpuSlots,
			totalTokensUsed,
			sessions,
		};
	}
}

/**
 * Compute unified RAM/CPU/token admission for one session against all active peers.
 * Peer usage excludes the caller's own previous lease entry so self-renewals never double-count.
 */
export function computeUnifiedSessionQuota(
	summary: FleetResourceSummary,
	limits: FleetResourceLimits,
	request: SessionQuotaRequest,
): UnifiedSessionQuotaDecision {
	const peers = summary.sessions.filter((s) => s.sessionId !== request.sessionId);
	const peerRss = peers.reduce((sum, s) => sum + s.rssBytes, 0);
	const peerCpu = peers.reduce((sum, s) => sum + s.cpuSlots, 0);
	const peerTokens = peers.reduce((sum, s) => sum + s.tokensUsed, 0);

	const remainingRssBytes = Math.max(0, limits.maxTotalRssBytes - peerRss);
	const remainingCpuSlots = Math.max(0, limits.maxTotalCpuSlots - peerCpu);
	const remainingTokens = Math.max(0, limits.maxTotalTokens - peerTokens);

	const reasons: FleetQuotaReason[] = [];
	if (remainingRssBytes === 0) reasons.push("fleet.ram.exceeded");
	if (remainingTokens === 0 && request.requestedTokens > 0) reasons.push("fleet.tokens.exhausted");
	if (remainingCpuSlots === 0 && request.requestedCpuSlots > 0) reasons.push("fleet.cpu.saturated");

	if (reasons.includes("fleet.ram.exceeded") || reasons.includes("fleet.tokens.exhausted")) {
		return {
			status: "deny_budget",
			remainingRssBytes,
			remainingCpuSlots,
			remainingTokens,
			allocatedCpuSlots: 0,
			allocatedTokenCap: 0,
			reasons,
		};
	}

	const allocatedCpuSlots = Math.min(Math.max(0, Math.floor(request.requestedCpuSlots)), remainingCpuSlots);
	const allocatedTokenCap = Math.min(Math.max(0, Math.floor(request.requestedTokens)), remainingTokens);

	if (allocatedCpuSlots < request.requestedCpuSlots || allocatedTokenCap < request.requestedTokens) {
		reasons.push("fleet.fair_share.throttled");
	}

	return {
		status: reasons.length > 0 ? "throttle" : "allow",
		remainingRssBytes,
		remainingCpuSlots,
		remainingTokens,
		allocatedCpuSlots,
		allocatedTokenCap,
		reasons,
	};
}
