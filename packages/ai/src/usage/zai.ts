import type {
	UsageAmount,
	UsageFetchContext,
	UsageFetchParams,
	UsageLimit,
	UsageProvider,
	UsageReport,
	UsageStatus,
	UsageWindow,
} from "$ai/usage";

const DEFAULT_ENDPOINT = "https://api.z.ai";
const QUOTA_PATH = "/api/monitor/usage/quota/limit";
const MODEL_USAGE_PATH = "/api/monitor/usage/model-usage";
const DEFAULT_CACHE_TTL_MS = 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeZaiBaseUrl(baseUrl?: string): string {
	if (!baseUrl || !baseUrl.trim()) return DEFAULT_ENDPOINT;
	try {
		return new URL(baseUrl.trim()).origin;
	} catch {
		return DEFAULT_ENDPOINT;
	}
}

interface ZaiUsageLimitItem {
	type?: string;
	usage?: number;
	currentValue?: number;
	percentage?: number;
	remaining?: number;
	nextResetTime?: number;
}

interface ZaiQuotaPayload {
	success?: boolean;
	code?: number;
	msg?: string;
	data?: {
		limits?: ZaiUsageLimitItem[];
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function parseMillis(value: unknown): number | undefined {
	const parsed = toNumber(value);
	if (parsed === undefined) return undefined;
	return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

function parseLimitItem(value: unknown): ZaiUsageLimitItem | null {
	if (!isRecord(value)) return null;
	const type = typeof value.type === "string" ? value.type : undefined;
	if (!type) return null;
	return {
		type,
		usage: toNumber(value.usage),
		currentValue: toNumber(value.currentValue),
		percentage: toNumber(value.percentage),
		remaining: toNumber(value.remaining),
		nextResetTime: parseMillis(value.nextResetTime),
	};
}

function buildUsageAmount(args: {
	used: number | undefined;
	limit: number | undefined;
	remaining: number | undefined;
	unit: UsageAmount["unit"];
	percentage?: number;
}): UsageAmount {
	const usedFraction =
		args.percentage !== undefined
			? Math.min(Math.max(args.percentage / 100, 0), 1)
			: args.used !== undefined && args.limit !== undefined && args.limit > 0
				? Math.min(args.used / args.limit, 1)
				: undefined;
	const remainingFraction = usedFraction !== undefined ? Math.max(1 - usedFraction, 0) : undefined;
	return {
		used: args.used,
		limit: args.limit,
		remaining: args.remaining,
		usedFraction,
		remainingFraction,
		unit: args.unit,
	};
}

function buildUsageWindow(
	id: string,
	label: string,
	resetsAt: number | undefined,
	now: number,
): UsageWindow | undefined {
	if (!resetsAt) return { id, label };
	const resetInMs = Math.max(0, resetsAt - now);
	return {
		id,
		label,
		resetsAt,
		resetInMs,
	};
}

function getUsageStatus(usedFraction: number | undefined): UsageStatus | undefined {
	if (usedFraction === undefined) return undefined;
	if (usedFraction >= 1) return "exhausted";
	if (usedFraction >= 0.9) return "warning";
	return "ok";
}

function buildCacheKey(params: UsageFetchParams): string {
	const credential = params.credential;
	const account = credential.accountId ?? credential.email ?? "unknown";
	const token = credential.apiKey ?? credential.accessToken;
	const fingerprint = token && typeof token === "string" ? Bun.hash(token).toString(16) : "anonymous";
	const baseUrl = params.baseUrl ?? DEFAULT_ENDPOINT;
	return `usage:${params.provider}:${account}:${fingerprint}:${baseUrl}`;
}

function resolveCacheExpiry(now: number, limits: UsageLimit[]): number {
	const earliestReset = limits
		.map((limit) => limit.window?.resetsAt)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
		.reduce((min, value) => (min === undefined ? value : Math.min(min, value)), undefined as number | undefined);
	if (!earliestReset) return now + DEFAULT_CACHE_TTL_MS;
	return Math.min(earliestReset, now + DEFAULT_CACHE_TTL_MS);
}

function formatDate(value: Date): string {
	const pad = (input: number) => String(input).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}+${pad(value.getHours())}:${pad(
		value.getMinutes(),
	)}:${pad(value.getSeconds())}`;
}

function buildModelUsageUrl(baseUrl: string, now: Date): string {
	const start = new Date(now.getTime() - SEVEN_DAYS_MS);
	const startTime = formatDate(start);
	const endTime = formatDate(now);
	return `${baseUrl}${MODEL_USAGE_PATH}?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
}

async function fetchZaiUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
	if (params.provider !== "zai") return null;
	const credential = params.credential;
	if (credential.type !== "api_key" || !credential.apiKey) return null;

	const cacheKey = buildCacheKey(params);
	const cachedEntry = await ctx.cache.get(cacheKey);
	const now = ctx.now();
	if (cachedEntry && cachedEntry.expiresAt > now) return cachedEntry.value;

	const baseUrl = normalizeZaiBaseUrl(params.baseUrl);
	const url = `${baseUrl}${QUOTA_PATH}`;
	const headers: Record<string, string> = {
		Authorization: credential.apiKey,
		"Content-Type": "application/json",
		"User-Agent": "OpenCode-Status-Plugin/1.0",
	};

	let payload: ZaiQuotaPayload | null = null;
	try {
		const response = await ctx.fetch(url, {
			headers,
			signal: params.signal,
		});
		if (!response.ok) {
			ctx.logger?.warn("ZAI usage fetch failed", { status: response.status, statusText: response.statusText });
			return null;
		}
		payload = (await response.json()) as ZaiQuotaPayload;
	} catch (error) {
		ctx.logger?.warn("ZAI usage fetch error", { error: String(error) });
		return null;
	}

	if (!payload) return null;
	if (payload.success !== true) {
		ctx.logger?.warn("ZAI usage response invalid", { code: payload.code, message: payload.msg });
		return null;
	}

	const limitsPayload = Array.isArray(payload.data?.limits) ? payload.data?.limits : [];
	const limits: UsageLimit[] = [];

	for (const rawLimit of limitsPayload) {
		const parsed = parseLimitItem(rawLimit);
		if (!parsed) continue;
		if (parsed.type === "TOKENS_LIMIT") {
			const amount = buildUsageAmount({
				used: parsed.currentValue,
				limit: parsed.usage,
				remaining: parsed.remaining,
				percentage: parsed.percentage,
				unit: "tokens",
			});
			const window = buildUsageWindow("quota", "Quota", parsed.nextResetTime, now);
			limits.push({
				id: "zai:tokens",
				label: "ZAI Token Quota",
				scope: {
					provider: params.provider,
					windowId: window?.id ?? "quota",
					shared: true,
				},
				window,
				amount,
				status: getUsageStatus(amount.usedFraction),
			});
		}
		if (parsed.type === "TIME_LIMIT") {
			const window = buildUsageWindow("quota", "Quota", undefined, now);
			const amount = buildUsageAmount({
				used: parsed.currentValue,
				limit: parsed.usage,
				remaining: parsed.remaining,
				percentage: parsed.percentage,
				unit: "requests",
			});
			limits.push({
				id: "zai:requests",
				label: "ZAI Request Quota",
				scope: {
					provider: params.provider,
					windowId: "quota",
					shared: true,
				},
				window,
				amount,
				status: getUsageStatus(amount.usedFraction),
			});
		}
	}

	if (limits.length === 0) return null;

	const report: UsageReport = {
		provider: params.provider,
		fetchedAt: now,
		limits,
		metadata: {
			endpoint: url,
			accountId: credential.accountId,
			email: credential.email,
		},
		raw: payload,
	};

	const expiresAt = resolveCacheExpiry(now, limits);
	await ctx.cache.set(cacheKey, { value: report, expiresAt });

	const modelUsageUrl = buildModelUsageUrl(baseUrl, new Date(now));
	try {
		const response = await ctx.fetch(modelUsageUrl, {
			headers,
			signal: params.signal,
		});
		if (response.ok) {
			const modelUsagePayload = (await response.json()) as unknown;
			if (isRecord(modelUsagePayload)) {
				report.metadata = {
					...report.metadata,
					modelUsage: modelUsagePayload,
				};
			}
		}
	} catch (error) {
		ctx.logger?.debug("ZAI model usage fetch failed", { error: String(error) });
	}

	return report;
}

export const zaiUsageProvider: UsageProvider = {
	id: "zai",
	fetchUsage: fetchZaiUsage,
	supports: (params) => params.provider === "zai" && params.credential.type === "api_key",
};
