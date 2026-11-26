import { clampPercent, usageText } from "./provider-usage-text.ts";
import type { FetchLike, SubscriptionUsageSnapshot } from "./provider-usage-types.ts";

const HEALTH_URL = "http://localhost:8080/health";
const MAX_USAGE_RESPONSE_BYTES = 1024 * 1024;

type QuotaWindow = { usedPercent: number; resetsAt?: number };

export function parseAntigravityUsageSnapshot(
	value: unknown,
	activeModelId?: string,
): Pick<SubscriptionUsageSnapshot, "windows" | "message"> | undefined {
	const root = record(value);
	if (!root || !Array.isArray(root.accounts)) return undefined;
	const counts = record(root.counts);
	const total = finiteNumber(counts?.total) ?? root.accounts.length;
	const available =
		finiteNumber(counts?.available) ?? root.accounts.filter((account) => record(account)?.status === "ok").length;
	const byModel = new Map<string, QuotaWindow>();

	for (const rawAccount of root.accounts) {
		const account = record(rawAccount);
		if (account?.status !== "ok") continue;
		const models = record(account.models);
		if (!models) continue;
		for (const [modelId, rawQuota] of Object.entries(models)) {
			if (!modelId.startsWith("gemini-")) continue;
			const quota = record(rawQuota);
			const remaining = finiteNumber(quota?.remainingFraction);
			if (remaining === undefined || remaining < 0 || remaining > 1) continue;
			const candidate: QuotaWindow = {
				usedPercent: clampPercent((1 - remaining) * 100),
				...(epochSeconds(quota?.resetTime) === undefined ? {} : { resetsAt: epochSeconds(quota?.resetTime) }),
			};
			const previous = byModel.get(modelId);
			if (!previous || candidate.usedPercent > previous.usedPercent) byModel.set(modelId, candidate);
		}
	}

	const windows = [...byModel.entries()]
		.sort(([leftId, left], [rightId, right]) =>
			leftId === activeModelId
				? -1
				: rightId === activeModelId
					? 1
					: right.usedPercent - left.usedPercent || leftId.localeCompare(rightId),
		)
		.slice(0, 4)
		.map(([label, window]) => ({ label, ...window }));
	const message = usageText(`${available}/${total} accounts`);
	return { windows, ...(message === undefined ? {} : { message }) };
}

export async function fetchAntigravityUsage(
	label: string,
	apiKey: string,
	fetchImpl: FetchLike,
	activeModelId?: string,
): Promise<SubscriptionUsageSnapshot> {
	const unavailable = (): SubscriptionUsageSnapshot => ({ label, windows: [], message: "usage unavailable" });
	try {
		const response = await fetchImpl(HEALTH_URL, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": "omk" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return unavailable();
		const declaredBytes = Number(response.headers?.get("content-length"));
		if (Number.isFinite(declaredBytes) && declaredBytes > MAX_USAGE_RESPONSE_BYTES) return unavailable();
		const body = await response.text();
		if (body.length > MAX_USAGE_RESPONSE_BYTES) return unavailable();
		const snapshot = parseAntigravityUsageSnapshot(JSON.parse(body), activeModelId);
		if (!snapshot || snapshot.windows.length === 0) return unavailable();
		return { label, ...snapshot };
	} catch {
		return unavailable();
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function finiteNumber(value: unknown): number | undefined {
	const number =
		typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : undefined;
}

function epochSeconds(value: unknown): number | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed / 1000 : undefined;
}
