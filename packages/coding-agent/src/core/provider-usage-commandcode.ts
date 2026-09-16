/**
 * Command Code Provider API usage: maps `/alpha` billing + rolling windows onto
 * the status-rail meters. Auth is the stored Command Code API key from
 * `models.json` / auth storage; this module never reads cookies or env itself.
 */

import { clampPercent, usageText } from "./provider-usage-text.ts";
import type { FetchLike, SubscriptionUsageSnapshot, SubscriptionUsageWindow } from "./provider-usage-types.ts";

const COMMAND_CODE_ORIGIN = "https://api.commandcode.ai";
const MAX_USAGE_RESPONSE_BYTES = 1024 * 1024;
const PLAN_NAMES: Readonly<Record<string, string>> = {
	"individual-go": "Go",
	"individual-goat": "GOAT",
	"individual-pro": "Pro",
	"individual-max": "Max",
	"individual-ultra": "Ultra",
	go: "Go",
	goat: "GOAT",
	pro: "Pro",
	max: "Max",
};

export function parseCommandCodeUsageSnapshot(value: unknown): Pick<SubscriptionUsageSnapshot, "windows" | "message"> {
	const root = record(value);
	const creditsNode = record(root?.credits);
	const credits = record(creditsNode?.credits) ?? creditsNode;
	const windowLimits = record(root?.windowLimits) ?? record(creditsNode?.windowLimits);
	const summary = record(root?.summary);
	const subscription = record(record(root?.subscription)?.data) ?? record(root?.subscription);
	const windows: SubscriptionUsageWindow[] = [];
	const fiveHour = creditWindow("5H", record(windowLimits?.fiveHour));
	const weekly = creditWindow("7D", record(windowLimits?.weekly));
	if (fiveHour) windows.push(fiveHour);
	if (weekly) windows.push(weekly);
	const monthly = monthlyWindow(credits, summary, subscription);
	if (monthly) windows.push(monthly);
	const message = planMessage(subscription);
	if (windows.length === 0 && message === undefined) return { windows: [], message: "usage unavailable" };
	return { windows, ...(message === undefined ? {} : { message }) };
}

export async function fetchCommandCodeUsage(
	label: string,
	apiKey: string,
	fetchImpl: FetchLike,
): Promise<SubscriptionUsageSnapshot> {
	const unavailable = (): SubscriptionUsageSnapshot => ({ label, windows: [], message: "usage unavailable" });
	const whoami = await fetchQuotaJson(fetchImpl, `${COMMAND_CODE_ORIGIN}/alpha/whoami`, apiKey);
	const account = parseWhoami(whoami);
	if (!account) return unavailable();

	const orgQuery = account.orgId ? `?orgId=${encodeURIComponent(account.orgId)}` : "";
	const [creditsPayload, subscriptionPayload] = await Promise.all([
		fetchQuotaJson(fetchImpl, `${COMMAND_CODE_ORIGIN}/alpha/billing/credits${orgQuery}`, apiKey),
		fetchQuotaJson(fetchImpl, `${COMMAND_CODE_ORIGIN}/alpha/billing/subscriptions${orgQuery}`, apiKey),
	]);
	const periodStart = periodQuery(record(record(subscriptionPayload)?.data)?.currentPeriodStart);
	const summaryQuery = new URLSearchParams();
	if (account.orgId) summaryQuery.set("orgId", account.orgId);
	if (periodStart) summaryQuery.set("since", periodStart);
	const summaryPath = summaryQuery.size > 0 ? `?${summaryQuery.toString()}` : "";
	const summaryPayload = await fetchQuotaJson(
		fetchImpl,
		`${COMMAND_CODE_ORIGIN}/alpha/usage/summary${summaryPath}`,
		apiKey,
	);
	const { windows, message } = parseCommandCodeUsageSnapshot({
		credits: creditsPayload,
		windowLimits: record(creditsPayload)?.windowLimits,
		summary: summaryPayload,
		subscription: subscriptionPayload,
	});
	if (windows.length > 0) return { label, windows, ...(message === undefined ? {} : { message }) };
	return { label, windows: [], message: message ?? "usage unavailable" };
}

async function fetchQuotaJson(fetchImpl: FetchLike, url: string, apiKey: string): Promise<unknown> {
	const response = await fetchImpl(url, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
			"User-Agent": "omk",
		},
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) return undefined;
	const declaredBytes = Number(response.headers?.get("content-length"));
	if (Number.isFinite(declaredBytes) && declaredBytes > MAX_USAGE_RESPONSE_BYTES) return undefined;
	if (!response.body || typeof response.body.getReader !== "function") {
		return await response.json();
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > MAX_USAGE_RESPONSE_BYTES) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(body)) as unknown;
	} catch {
		return undefined;
	}
}

function parseWhoami(value: unknown): { readonly orgId?: string } | undefined {
	const payload = record(value);
	if (!payload) return undefined;
	const org = record(payload.org);
	const user = record(payload.user);
	const login =
		stringValue(org?.login) ?? stringValue(user?.userName) ?? stringValue(user?.name) ?? stringValue(user?.keyName);
	if (!login) return undefined;
	const orgId = stringValue(org?.id);
	return orgId === undefined ? {} : { orgId };
}

function creditWindow(label: string, entry: Record<string, unknown> | undefined): SubscriptionUsageWindow | undefined {
	if (!entry) return undefined;
	const used = finiteNumber(entry.used);
	const cap = finiteNumber(entry.cap);
	if (used === undefined || cap === undefined || cap <= 0 || (used === 0 && cap === 0)) return undefined;
	const resetsAt = epochSeconds(entry.resetAt);
	return {
		label,
		usedPercent: clampPercent((used / cap) * 100),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function monthlyWindow(
	credits: Record<string, unknown> | undefined,
	summary: Record<string, unknown> | undefined,
	subscription: Record<string, unknown> | undefined,
): SubscriptionUsageWindow | undefined {
	const monthly = finiteNumber(credits?.monthlyCredits);
	const purchased = finiteNumber(credits?.purchasedCredits);
	const free = finiteNumber(credits?.freeCredits);
	if (monthly === undefined && purchased === undefined && free === undefined) return undefined;
	const remaining = (monthly ?? 0) + (purchased ?? 0) + (free ?? 0);
	const spent = finiteNumber(summary?.totalCost);
	if (spent === undefined) return undefined;
	const pool = remaining + spent;
	if (pool <= 0) return undefined;
	const resetsAt = epochSeconds(subscription?.currentPeriodEnd);
	return {
		label: "MO",
		usedPercent: clampPercent((spent / pool) * 100),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function planMessage(subscription: Record<string, unknown> | undefined): string | undefined {
	const planId = stringValue(subscription?.planId);
	if (!planId) return undefined;
	return usageText(PLAN_NAMES[planId] ?? planId.replace(/[_-]+/g, " "));
}

function periodQuery(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	const seconds = epochSeconds(value);
	if (seconds === undefined) return undefined;
	return new Date(seconds * 1000).toISOString();
}

function epochSeconds(value: unknown): number | undefined {
	if (value === null) return undefined;
	const numeric = finiteNumber(value);
	if (numeric !== undefined) return numeric > 1_000_000_000_000 ? numeric / 1000 : numeric;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed / 1000 : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	const number =
		typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
