import { describe, expect, it, vi } from "vitest";
import { getSubscriptionUsageSource, loadSubscriptionUsage } from "../src/core/provider-usage.ts";
import { fetchAntigravityUsage, parseAntigravityUsageSnapshot } from "../src/core/provider-usage-antigravity.ts";
import type { FetchLike, SubscriptionUsageSnapshot } from "../src/core/provider-usage-types.ts";

const RESET = "2026-11-24T14:07:59Z";

function healthFixture(): unknown {
	return {
		status: "ok",
		counts: { total: 1, available: 1 },
		accounts: [
			{
				email: "private@example.com",
				status: "ok",
				models: {
					"gemini-3.8-flash-low": { remainingFraction: 0.9, resetTime: RESET },
					"gemini-4-neon-xhigh": { remainingFraction: 0.25, resetTime: RESET },
					"claude-opus-5-5-high": { remainingFraction: 0.1, resetTime: RESET },
				},
			},
		],
	};
}

function session(provider: string, apiKey = "test") {
	return {
		state: { model: { provider, id: "gemini-4-neon-xhigh" } },
		modelRegistry: {
			isUsingOAuthProvider: () => false,
			getProviderAuthStatus: () => ({ configured: true, source: "stored" as const }),
			getApiKeyForProvider: async () => apiKey,
		},
	};
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), { status: 200, ...init });
}

describe("Antigravity usage", () => {
	it("maps active Gemini quotas without exposing account identifiers", () => {
		const snapshot = parseAntigravityUsageSnapshot(healthFixture(), "gemini-4-neon-xhigh");
		expect(snapshot).toEqual({
			message: "1/1 accounts",
			windows: [
				{ label: "gemini-4-neon-xhigh", usedPercent: 75, resetsAt: Date.parse(RESET) / 1000 },
				{ label: "gemini-3.8-flash-low", usedPercent: 10, resetsAt: Date.parse(RESET) / 1000 },
			],
		});
		expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
	});

	it("registers both proxy providers against the same quota group", () => {
		expect(getSubscriptionUsageSource("antigravity")?.label).toBe("ANTIGRAVITY");
		expect(getSubscriptionUsageSource("google-proxy")?.label).toBe("ANTIGRAVITY");
	});

	it("loads the local health quota through the usage pipeline", async () => {
		const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(healthFixture()));
		const snapshot = (await loadSubscriptionUsage(
			session("google-proxy") as never,
			fetchMock,
		)) as SubscriptionUsageSnapshot;
		expect(snapshot.label).toBe("ANTIGRAVITY");
		expect(snapshot.windows.map((window) => window.usedPercent)).toEqual([75, 10]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:8080/health");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test");
	});

	it("reports unavailable for HTTP failures", async () => {
		const snapshot = await fetchAntigravityUsage(
			"ANTIGRAVITY",
			"test",
			(async () => new Response("down", { status: 503 })) as FetchLike,
		);
		expect(snapshot).toEqual({ label: "ANTIGRAVITY", windows: [], message: "usage unavailable" });
	});
});
