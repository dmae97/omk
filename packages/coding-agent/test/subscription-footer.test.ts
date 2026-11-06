import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import { StatusSidebarComponent } from "../src/modes/interactive/components/status-sidebar.ts";

describe("subscription footer connection", () => {
	it("shares native usage with a hidden rail and returns detached values", async () => {
		let configured = true;
		const current = {
			state: { model: { provider: "anthropic" } },
			settingsManager: { getSubscriptionUsageProviders: () => undefined },
			modelRegistry: {
				isUsingOAuthProvider: (provider: string) => configured && provider === "anthropic",
				getProviderAuthStatus: () => ({ configured: false }),
			},
		} as unknown as AgentSession;
		const footer = new FooterDataProvider("/tmp");
		const fetcher = vi.fn(async () => ({ label: "CLAUDE", windows: [{ label: "5H", usedPercent: 35 }] }));
		const repaint = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => current,
			footer,
			() => false,
			() => 44,
			{
				fetchSubscriptionUsage: fetcher,
				requestRender: repaint,
			},
		);
		try {
			expect(sidebar.getSubscriptionUsage()[0]?.message).toContain("loading");
			sidebar.getSubscriptionUsage();
			await vi.waitFor(() => expect(repaint).toHaveBeenCalled());
			const result = sidebar.getSubscriptionUsage();
			expect(result[0]?.windows[0]?.usedPercent).toBe(35);
			expect(fetcher).toHaveBeenCalledTimes(1);
			Reflect.set(result[0]?.windows[0] ?? {}, "usedPercent", 99);
			expect(sidebar.getSubscriptionUsage()[0]?.windows[0]?.usedPercent).toBe(35);
			configured = false;
			expect(sidebar.getSubscriptionUsage()).toEqual([]);
		} finally {
			footer.dispose();
		}
	});
});
