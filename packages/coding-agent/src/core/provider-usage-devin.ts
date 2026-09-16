/**
 * Devin CLI subscription usage: maps the account `GetUserStatus` payload onto
 * the status-rail windows. The token is whatever `/login devin` stored or an
 * already-owned `DEVIN_API_KEY`; this module never reads the environment itself.
 */

import { type DevinUserStatus, getDevinUserStatus } from "omk-ai";
import { clampPercent, usageText } from "./provider-usage-text.ts";
import type { FetchLike, SubscriptionUsageSnapshot, SubscriptionUsageWindow } from "./provider-usage-types.ts";

/** CLI `BillingStrategy.QUOTA` — undated remaining percents are still a quota window. */
const DEVIN_BILLING_QUOTA = 2;

/**
 * Map a decoded `GetUserStatus` payload to rail windows. The server reports
 * remaining percents; the rail renders used percents. Matches the CLI `/usage`
 * surface: a percent window is shown when the plan does not hide it and the
 * wire dated the reset, or when the plan is explicitly quota-billed. Credit-
 * billed plans leave proto percents at 0; those are not exhausted windows.
 * A dated reset without a percent still reads as exhausted.
 */
export function parseDevinUsageSnapshot(
	status: DevinUserStatus,
): Pick<SubscriptionUsageSnapshot, "windows" | "message"> {
	const windows: SubscriptionUsageWindow[] = [];
	const quotaWindow = (
		label: string,
		hidden: boolean | undefined,
		remainingPercent: number | undefined,
		resetsAt: number | undefined,
	): SubscriptionUsageWindow | undefined => {
		if (hidden === true) return undefined;
		const dated = resetsAt !== undefined && resetsAt > 0;
		// CLI /usage: dated reset, or an explicit quota plan. Credit-billed proto zeros are not windows.
		if (!dated && status.billingStrategy !== DEVIN_BILLING_QUOTA) return undefined;
		if (!dated && remainingPercent === undefined) return undefined;
		return {
			label,
			usedPercent: clampPercent(100 - (remainingPercent ?? 0)),
			...(dated ? { resetsAt } : {}),
		};
	};
	const daily = quotaWindow("1D", status.hideDailyQuota, status.dailyQuotaRemainingPercent, status.dailyQuotaResetAt);
	const weekly = quotaWindow(
		"7D",
		status.hideWeeklyQuota,
		status.weeklyQuotaRemainingPercent,
		status.weeklyQuotaResetAt,
	);
	if (daily) windows.push(daily);
	if (weekly) windows.push(weekly);
	const message = devinUsageMessage(status);
	return { windows, ...(message === undefined ? {} : { message }) };
}

/** Plan name plus credit balances for plans whose quota windows are not reported. */
function devinUsageMessage(status: DevinUserStatus): string | undefined {
	const parts: string[] = [];
	const plan = usageText(status.planName);
	if (plan) parts.push(plan);
	const balances: readonly (readonly [string, number | undefined])[] = [
		["prompt", status.availablePromptCredits],
		["flow", status.availableFlowCredits],
		["flex", status.availableFlexCredits],
	];
	const credits: string[] = [];
	for (const [name, amount] of balances) {
		if (amount !== undefined) credits.push(`${amount} ${name}`);
	}
	if (credits.length > 0) parts.push(credits.join(" · "));
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

export async function fetchDevinUsage(
	label: string,
	apiKey: string,
	fetchImpl: FetchLike,
): Promise<SubscriptionUsageSnapshot> {
	const status = await getDevinUserStatus(apiKey, AbortSignal.timeout(10_000), fetchImpl);
	const { windows, message } = parseDevinUsageSnapshot(status);
	if (windows.length > 0) return { label, windows, ...(message === undefined ? {} : { message }) };
	return { label, windows: [], message: message ?? "usage unavailable" };
}
