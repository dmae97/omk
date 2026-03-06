import type {
	CredentialRankingStrategy,
	UsageAmount,
	UsageFetchContext,
	UsageFetchParams,
	UsageLimit,
	UsageProvider,
	UsageReport,
	UsageStatus,
	UsageWindow,
} from "../usage";
import { isRecord, toNumber } from "../utils";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/api/oauth";
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

const CLAUDE_HEADERS = {
	accept: "application/json, text/plain, */*",
	"accept-encoding": "gzip, compress, deflate, br",
	"anthropic-beta":
		"claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05",
	"content-type": "application/json",
	"user-agent": "claude-cli/2.1.63 (external, cli)",
	connection: "keep-alive",
} as const;

function normalizeClaudeBaseUrl(baseUrl?: string): string {
	if (!baseUrl || !baseUrl.trim()) return DEFAULT_ENDPOINT;
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	const lower = trimmed.toLowerCase();
	if (lower.endsWith("/api/oauth")) return trimmed;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return DEFAULT_ENDPOINT;
	}
	let path = url.pathname.replace(/\/+$/, "");
	if (path === "/") path = "";
	if (path.toLowerCase().endsWith("/v1")) {
		path = path.slice(0, -3);
	}
	if (!path) return `${url.origin}/api/oauth`;
	return `${url.origin}${path}/api/oauth`;
}

interface ClaudeUsageBucket {
	utilization?: number;
	resets_at?: string;
}

interface ParsedUsageBucket {
	utilization?: number;
	resetsAt?: number;
}

interface ClaudeUsageResponse {
	five_hour?: ClaudeUsageBucket | null;
	seven_day?: ClaudeUsageBucket | null;
	seven_day_opus?: ClaudeUsageBucket | null;
	seven_day_sonnet?: ClaudeUsageBucket | null;
}

type ClaudeUsagePayload = {
	payload: ClaudeUsageResponse;
	orgId?: string;
};

function parseIsoTime(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBucket(bucket: unknown): ParsedUsageBucket | undefined {
	if (!isRecord(bucket)) return undefined;
	const utilization = toNumber(bucket.utilization);
	const resetsAt = parseIsoTime(typeof bucket.resets_at === "string" ? bucket.resets_at : undefined);
	if (utilization === undefined && resetsAt === undefined) {
		return undefined;
	}
	return { utilization, resetsAt };
}

function getPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
	const value = payload[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractUsageIdentity(payload: ClaudeUsageResponse, orgId?: string): { accountId?: string; email?: string } {
	if (!isRecord(payload)) return { accountId: orgId };
	const accountId =
		getPayloadString(payload, "account_id") ??
		getPayloadString(payload, "accountId") ??
		getPayloadString(payload, "user_id") ??
		getPayloadString(payload, "userId") ??
		getPayloadString(payload, "org_id") ??
		getPayloadString(payload, "orgId") ??
		orgId;
	const email =
		getPayloadString(payload, "email") ??
		getPayloadString(payload, "user_email") ??
		getPayloadString(payload, "userEmail");
	return { accountId, email };
}

function hasUsageData(payload: ClaudeUsageResponse): boolean {
	return Boolean(payload.five_hour || payload.seven_day || payload.seven_day_opus || payload.seven_day_sonnet);
}

async function fetchUsagePayload(
	url: string,
	headers: Record<string, string>,
	ctx: UsageFetchContext,
	signal?: AbortSignal,
): Promise<ClaudeUsagePayload | null> {
	let lastPayload: ClaudeUsageResponse | null = null;
	let lastOrgId: string | undefined;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await ctx.fetch(url, { headers, signal });
			if (!response.ok) {
				ctx.logger?.warn("Claude usage fetch failed", { status: response.status, statusText: response.statusText });
				return null;
			}
			const payload = (await response.json()) as ClaudeUsageResponse;
			lastPayload = payload;
			const orgId = response.headers.get("anthropic-organization-id")?.trim() || undefined;
			lastOrgId = orgId ?? lastOrgId;
			if (payload && isRecord(payload) && hasUsageData(payload)) {
				return { payload, orgId };
			}
		} catch (error) {
			ctx.logger?.warn("Claude usage fetch error", { error: String(error) });
			return null;
		}

		if (attempt < MAX_RETRIES - 1) {
			await Bun.sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
		}
	}

	return lastPayload ? { payload: lastPayload, orgId: lastOrgId } : null;
}

interface ClaudeProfile {
	account?: {
		uuid?: string;
		email?: string;
	};
}

async function fetchProfile(
	baseUrl: string,
	headers: Record<string, string>,
	ctx: UsageFetchContext,
	signal?: AbortSignal,
): Promise<ClaudeProfile | null> {
	const url = `${baseUrl}/profile`;
	try {
		const response = await ctx.fetch(url, { headers, signal });
		if (!response.ok) return null;
		return (await response.json()) as ClaudeProfile;
	} catch {
		return null;
	}
}

async function resolveEmail(
	params: UsageFetchParams,
	ctx: UsageFetchContext,
	baseUrl: string,
	headers: Record<string, string>,
): Promise<string | undefined> {
	if (params.credential.email) return params.credential.email;

	const profile = await fetchProfile(baseUrl, headers, ctx, params.signal);
	return profile?.account?.email;
}

function buildUsageAmount(utilization: number | undefined): UsageAmount | undefined {
	if (utilization === undefined) return undefined;
	const clamped = Math.min(Math.max(utilization, 0), 100);
	const usedFraction = clamped / 100;
	return {
		used: clamped,
		limit: 100,
		remaining: Math.max(0, 100 - clamped),
		usedFraction,
		remainingFraction: Math.max(0, 1 - usedFraction),
		unit: "percent",
	};
}

function buildUsageStatus(usedFraction: number | undefined): UsageStatus | undefined {
	if (usedFraction === undefined) return undefined;
	if (usedFraction >= 1) return "exhausted";
	if (usedFraction >= 0.9) return "warning";
	return "ok";
}

function buildUsageLimit(args: {
	id: string;
	label: string;
	windowId: string;
	windowLabel: string;
	durationMs: number;
	bucket: ParsedUsageBucket | undefined;
	provider: "anthropic";
	tier?: string;
	shared?: boolean;
}): UsageLimit | null {
	if (!args.bucket) return null;
	const amount = buildUsageAmount(args.bucket.utilization);
	if (!amount) return null;
	const window: UsageWindow = {
		id: args.windowId,
		label: args.windowLabel,
		durationMs: args.durationMs,
		...(args.bucket.resetsAt !== undefined ? { resetsAt: args.bucket.resetsAt } : {}),
	};
	return {
		id: args.id,
		label: args.label,
		scope: {
			provider: args.provider,
			windowId: args.windowId,
			tier: args.tier,
			shared: args.shared,
		},
		window,
		amount,
		status: buildUsageStatus(amount.usedFraction),
	};
}

async function fetchClaudeUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
	if (params.provider !== "anthropic") return null;
	const credential = params.credential;
	if (credential.type !== "oauth" || !credential.accessToken) return null;

	const baseUrl = normalizeClaudeBaseUrl(params.baseUrl);
	const url = `${baseUrl}/usage`;
	const headers: Record<string, string> = {
		...CLAUDE_HEADERS,
		authorization: `Bearer ${credential.accessToken}`,
	};

	const payloadResult = await fetchUsagePayload(url, headers, ctx, params.signal);
	if (!payloadResult || !isRecord(payloadResult.payload)) return null;
	const { payload, orgId } = payloadResult;

	const fiveHour = parseBucket(payload.five_hour);
	const sevenDay = parseBucket(payload.seven_day);
	const sevenDayOpus = parseBucket(payload.seven_day_opus);
	const sevenDaySonnet = parseBucket(payload.seven_day_sonnet);

	const limits = [
		buildUsageLimit({
			id: "anthropic:5h",
			label: "Claude 5 Hour",
			windowId: "5h",
			windowLabel: "5 Hour",
			durationMs: FIVE_HOURS_MS,
			bucket: fiveHour,
			provider: "anthropic",
			shared: true,
		}),
		buildUsageLimit({
			id: "anthropic:7d",
			label: "Claude 7 Day",
			windowId: "7d",
			windowLabel: "7 Day",
			durationMs: SEVEN_DAYS_MS,
			bucket: sevenDay,
			provider: "anthropic",
			shared: true,
		}),
		buildUsageLimit({
			id: "anthropic:7d:opus",
			label: "Claude 7 Day (Opus)",
			windowId: "7d",
			windowLabel: "7 Day",
			durationMs: SEVEN_DAYS_MS,
			bucket: sevenDayOpus,
			provider: "anthropic",
			tier: "opus",
		}),
		buildUsageLimit({
			id: "anthropic:7d:sonnet",
			label: "Claude 7 Day (Sonnet)",
			windowId: "7d",
			windowLabel: "7 Day",
			durationMs: SEVEN_DAYS_MS,
			bucket: sevenDaySonnet,
			provider: "anthropic",
			tier: "sonnet",
		}),
	].filter((limit): limit is UsageLimit => limit !== null);

	if (limits.length === 0) return null;
	const identity = extractUsageIdentity(payload, orgId);
	const accountId = identity.accountId ?? credential.accountId;
	const email = identity.email ?? (await resolveEmail(params, ctx, baseUrl, headers));

	const report: UsageReport = {
		provider: params.provider,
		fetchedAt: Date.now(),
		limits,
		metadata: {
			accountId,
			email,
			endpoint: url,
		},
		raw: payload,
	};

	return report;
}

export const claudeUsageProvider: UsageProvider = {
	id: "anthropic",
	fetchUsage: fetchClaudeUsage,
	supports: params => params.provider === "anthropic" && params.credential.type === "oauth",
};

export const claudeRankingStrategy: CredentialRankingStrategy = {
	findWindowLimits(report) {
		const primary = report.limits.find(l => l.id === "anthropic:5h");
		const secondary = report.limits.find(l => l.id === "anthropic:7d");
		return { primary, secondary };
	},
	windowDefaults: { primaryMs: 5 * 60 * 60 * 1000, secondaryMs: 7 * 24 * 60 * 60 * 1000 },
};
