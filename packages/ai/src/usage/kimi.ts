import { $env } from "@oh-my-pi/pi-utils";
import type {
	UsageAmount,
	UsageCache,
	UsageFetchContext,
	UsageFetchParams,
	UsageLimit,
	UsageProvider,
	UsageReport,
	UsageStatus,
	UsageWindow,
} from "../usage";
import { getKimiCommonHeaders, refreshKimiToken } from "../utils/oauth/kimi";

const DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const USAGE_PATH = "usages";
const DEFAULT_CACHE_TTL_MS = 60_000;

interface KimiUsagePayload {
	usage?: unknown;
	limits?: unknown;
}

type KimiUsageRow = {
	label: string;
	used?: number;
	limit?: number;
	remaining?: number;
	resetsAt?: number;
	resetInMs?: number;
	window?: UsageWindow;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const parsed = Number(trimmed);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
};

function normalizeBaseUrl(baseUrl?: string): string {
	const envBase = $env.KIMI_CODE_BASE_URL?.trim();
	const candidate = baseUrl?.trim() || envBase || DEFAULT_BASE_URL;
	return candidate.replace(/\/+$/, "");
}

function buildUsageUrl(baseUrl: string): string {
	const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	return `${normalized}${USAGE_PATH}`;
}

function parseResetTimes(data: Record<string, unknown>, nowMs: number): Pick<UsageWindow, "resetsAt" | "resetInMs"> {
	const timeKeys = ["reset_at", "resetAt", "reset_time", "resetTime"] as const;
	for (const key of timeKeys) {
		const value = data[key];
		if (typeof value === "string" && value.trim()) {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) {
				return { resetsAt: parsed, resetInMs: parsed - nowMs };
			}
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			const parsed = value > 1_000_000_000_000 ? value : value * 1000;
			return { resetsAt: parsed, resetInMs: parsed - nowMs };
		}
	}

	const secondsKeys = ["reset_in", "resetIn", "ttl", "window"] as const;
	for (const key of secondsKeys) {
		const seconds = toNumber(data[key]);
		if (seconds !== undefined) {
			return { resetsAt: nowMs + seconds * 1000, resetInMs: seconds * 1000 };
		}
	}

	return {};
}

function formatDurationLabel(duration: number, timeUnit: string): string | undefined {
	const upper = timeUnit.toUpperCase();
	if (upper.includes("MINUTE")) {
		if (duration >= 60 && duration % 60 === 0) return `${duration / 60}h limit`;
		return `${duration}m limit`;
	}
	if (upper.includes("HOUR")) return `${duration}h limit`;
	if (upper.includes("DAY")) return `${duration}d limit`;
	if (upper.includes("SECOND")) return `${duration}s limit`;
	return undefined;
}

function buildWindow(windowData: Record<string, unknown>, nowMs: number): UsageWindow | undefined {
	const duration = toNumber(windowData.duration);
	const timeUnit = typeof windowData.timeUnit === "string" ? windowData.timeUnit : "";
	const label = duration !== undefined && timeUnit ? formatDurationLabel(duration, timeUnit) : undefined;
	const resets = parseResetTimes(windowData, nowMs);

	if (duration === undefined && !label && !resets.resetsAt && !resets.resetInMs) return undefined;
	let durationMs: number | undefined;
	if (duration !== undefined) {
		if (timeUnit.toUpperCase().includes("MINUTE")) durationMs = duration * 60_000;
		else if (timeUnit.toUpperCase().includes("HOUR")) durationMs = duration * 3_600_000;
		else if (timeUnit.toUpperCase().includes("DAY")) durationMs = duration * 86_400_000;
		else if (timeUnit.toUpperCase().includes("SECOND")) durationMs = duration * 1000;
	}

	return {
		id: duration !== undefined && timeUnit ? `${duration}${timeUnit.toLowerCase()}` : "default",
		label: label ?? "Usage window",
		durationMs,
		...resets,
	};
}

function buildUsageRow(data: Record<string, unknown>, defaultLabel: string, nowMs: number): KimiUsageRow | null {
	const limit = toNumber(data.limit);
	let used = toNumber(data.used);
	const remaining = toNumber(data.remaining);
	if (used === undefined && remaining !== undefined && limit !== undefined) {
		used = limit - remaining;
	}

	if (used === undefined && limit === undefined) return null;
	const resets = parseResetTimes(data, nowMs);
	return {
		label:
			typeof data.name === "string" && data.name
				? data.name
				: typeof data.title === "string" && data.title
					? data.title
					: defaultLabel,
		used,
		limit,
		remaining,
		resetsAt: resets.resetsAt,
		resetInMs: resets.resetInMs,
	};
}

function buildUsageAmount(row: KimiUsageRow): UsageAmount {
	const amount: UsageAmount = { unit: "unknown" };
	if (row.limit !== undefined) amount.limit = row.limit;
	if (row.used !== undefined) amount.used = row.used;
	if (row.remaining !== undefined) amount.remaining = row.remaining;
	if (row.limit !== undefined && row.used !== undefined && row.limit > 0) {
		amount.usedFraction = Math.min(Math.max(row.used / row.limit, 0), 1);
		amount.remainingFraction = Math.min(Math.max((row.limit - row.used) / row.limit, 0), 1);
		amount.remaining = amount.remaining ?? row.limit - row.used;
	}
	return amount;
}

function buildUsageStatus(amount: UsageAmount): UsageStatus {
	if (amount.usedFraction === undefined) return "unknown";
	if (amount.usedFraction >= 1) return "exhausted";
	if (amount.usedFraction >= 0.9) return "warning";
	return "ok";
}

function toUsageLimit(row: KimiUsageRow, provider: string, index: number, accountId?: string): UsageLimit {
	const window: UsageWindow | undefined =
		row.window ??
		(row.resetsAt || row.resetInMs
			? {
					id: "default",
					label: "Usage window",
					resetsAt: row.resetsAt,
					resetInMs: row.resetInMs,
				}
			: undefined);

	const amount = buildUsageAmount(row);
	return {
		id: `${provider}:${index}`,
		label: row.label,
		scope: {
			provider,
			accountId,
			windowId: window?.id,
			shared: true,
		},
		window,
		amount,
		status: buildUsageStatus(amount),
	};
}

function parseUsagePayload(payload: unknown, nowMs: number): { rows: KimiUsageRow[]; raw: KimiUsagePayload } | null {
	if (!isRecord(payload)) return null;
	const data = payload as KimiUsagePayload;
	const rows: KimiUsageRow[] = [];

	if (isRecord(data.usage)) {
		const summary = buildUsageRow(data.usage, "Total quota", nowMs);
		if (summary) rows.push(summary);
	}

	if (Array.isArray(data.limits)) {
		data.limits.forEach((item, idx) => {
			if (!isRecord(item)) return;
			const detail = isRecord(item.detail) ? item.detail : item;
			const windowData = isRecord(item.window) ? item.window : {};
			const label =
				(typeof item.name === "string" && item.name) ||
				(typeof item.title === "string" && item.title) ||
				(typeof item.scope === "string" && item.scope) ||
				(typeof detail.name === "string" && detail.name) ||
				(typeof detail.title === "string" && detail.title) ||
				formatDurationLabel(toNumber(windowData.duration) ?? 0, String(windowData.timeUnit || "")) ||
				`Limit #${idx + 1}`;
			const row = buildUsageRow(detail, label, nowMs);
			if (row) {
				row.window = buildWindow(windowData, nowMs);
				rows.push(row);
			}
		});
	}

	return { rows, raw: data };
}

function resolveCacheExpiry(report: UsageReport | null, nowMs: number): number {
	if (!report) return nowMs + DEFAULT_CACHE_TTL_MS;
	const resetCandidates = report.limits
		.map(limit => limit.window?.resetsAt)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	if (resetCandidates.length === 0) return nowMs + DEFAULT_CACHE_TTL_MS;
	return Math.min(nowMs + DEFAULT_CACHE_TTL_MS, Math.min(...resetCandidates));
}

async function getCachedReport(cache: UsageCache, key: string, nowMs: number): Promise<UsageReport | null | undefined> {
	const cached = await cache.get(key);
	if (!cached) return undefined;
	if (cached.expiresAt <= nowMs) return undefined;
	return cached.value;
}

async function setCachedReport(
	cache: UsageCache,
	key: string,
	report: UsageReport | null,
	expiresAt: number,
): Promise<void> {
	await cache.set(key, { value: report, expiresAt });
}

export const kimiUsageProvider: UsageProvider = {
	id: "kimi-code",
	supports(params: UsageFetchParams): boolean {
		return params.provider === "kimi-code" && params.credential.type === "oauth";
	},
	async fetchUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
		if (params.provider !== "kimi-code") return null;
		const { credential } = params;
		if (credential.type !== "oauth") return null;

		let accessToken = credential.accessToken;
		if (!accessToken) return null;

		const nowMs = ctx.now();
		if (credential.expiresAt !== undefined && credential.expiresAt <= nowMs) {
			if (!credential.refreshToken) {
				ctx.logger?.warn("Kimi usage token expired, no refresh token", { provider: params.provider });
				return null;
			}
			try {
				ctx.logger?.debug("Kimi usage token expired, refreshing", { provider: params.provider });
				const refreshed = await refreshKimiToken(credential.refreshToken);
				accessToken = refreshed.access;
			} catch (error) {
				ctx.logger?.warn("Kimi usage token refresh failed", { provider: params.provider, error: String(error) });
				return null;
			}
		}

		const baseUrl = normalizeBaseUrl(params.baseUrl);
		const accountKey = credential.accountId ?? credential.email ?? "unknown";
		const cacheKey = `usage:kimi-code:${accountKey}:${baseUrl}`;
		const cached = await getCachedReport(ctx.cache, cacheKey, nowMs);
		if (cached !== undefined) return cached;

		const url = buildUsageUrl(baseUrl);
		let payload: unknown;
		try {
			const response = await ctx.fetch(url, {
				headers: {
					...(await getKimiCommonHeaders()),
					Authorization: `Bearer ${accessToken}`,
				},
				signal: params.signal,
			});
			if (!response.ok) {
				ctx.logger?.warn("Kimi usage request failed", { status: response.status, provider: params.provider });
				return null;
			}
			payload = await response.json();
		} catch (error) {
			ctx.logger?.warn("Kimi usage request error", { provider: params.provider, error: String(error) });
			return null;
		}

		const parsed = parseUsagePayload(payload, nowMs);
		if (!parsed || parsed.rows.length === 0) {
			ctx.logger?.warn("Kimi usage response invalid", { provider: params.provider });
			return null;
		}

		const limits = parsed.rows.map((row, index) => toUsageLimit(row, params.provider, index, credential.accountId));

		const report: UsageReport = {
			provider: params.provider,
			fetchedAt: nowMs,
			limits,
			metadata: {
				endpoint: url,
			},
			raw: parsed.raw,
		};

		const expiresAt = resolveCacheExpiry(report, nowMs);
		await setCachedReport(ctx.cache, cacheKey, report, expiresAt);
		return report;
	},
};
