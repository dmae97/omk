import { describe, expect, it } from "vitest";
import { createEventBus } from "../../../../packages/coding-agent/src/index.ts";
import { createSubscriptionUsagePanel, type SubscriptionUsageData } from "../src/subscription-usage.ts";
import { createSidebarPanelRegistry } from "../vendor/src/sidebar-panels.ts";

describe("native subscription usage presentation", () => {
	it("publishes host quota windows and reset times without reading credentials or polling a provider", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const data = {
			getSubscriptionUsage: () => [
				{ label: "CODEX", windows: [{ label: "5H", usedPercent: 35, resetsAt: 3600 }] },
				{ label: "META", windows: [], message: "no observed usage yet" },
			],
		};
		const panel = createSubscriptionUsagePanel({ events }, data, () => 0);
		panel.refresh();
		const quota = registry.get("omk:subscription-usage");
		expect(quota?.title).toBe("QUOTA");
		expect(quota?.keyValues).toContainEqual({ label: "CODEX 5H", value: "35% / 1h", valueRole: "primary" });
		expect(quota?.rows.some((row) => row.text.includes("no observed usage yet"))).toBe(true);
		expect(panel.summary(80)).toContain("CODEX 5H 35%");
		panel.dispose();
		expect(registry.get("omk:subscription-usage")).toBeUndefined();
		registry.dispose();
	});
	it("shows an empty state instead of an error when the host has no usage source", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const panel = createSubscriptionUsagePanel({ events }, {});
		panel.refresh();
		expect(JSON.stringify(registry.get("omk:subscription-usage")?.rows)).toContain(
			"No subscription usage source on this host",
		);
		expect(panel.summary(80)).toBe("");
		panel.dispose();
		const undefinedSnapshots = createSubscriptionUsagePanel({ events }, { getSubscriptionUsage: () => undefined });
		undefinedSnapshots.refresh();
		expect(registry.get("omk:subscription-usage")?.rows.map((row) => row.text)).toEqual([
			"No subscription usage source on this host",
		]);
		expect(registry.get("omk:subscription-usage")?.keyValues).toBeUndefined();
		expect(undefinedSnapshots.summary(80)).toBe("");
		undefinedSnapshots.dispose();
		const noProviders = createSubscriptionUsagePanel({ events }, { getSubscriptionUsage: () => [] });
		noProviders.refresh();
		expect(JSON.stringify(registry.get("omk:subscription-usage")?.rows)).toContain(
			"No configured subscription providers",
		);
		expect(noProviders.summary(80)).toBe("");
		noProviders.dispose();
		registry.dispose();
	});
	it("preserves the host receiver and clears stale quota when its source disappears", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const data: {
			snapshots: ReturnType<NonNullable<SubscriptionUsageData["getSubscriptionUsage"]>>;
		} & SubscriptionUsageData = {
			snapshots: [{ label: "CODEX", windows: [{ label: "5H", usedPercent: 35 }] }],
			getSubscriptionUsage() {
				return this.snapshots;
			},
		};
		const panel = createSubscriptionUsagePanel({ events }, data);
		panel.refresh();
		expect(panel.summary(80)).toBe("CODEX 5H 35%");
		data.snapshots = undefined;
		panel.refresh();
		expect(panel.summary(80)).toBe("");
		expect(registry.get("omk:subscription-usage")?.keyValues).toBeUndefined();
		expect(registry.get("omk:subscription-usage")?.rows.map((row) => row.text)).toEqual([
			"No subscription usage source on this host",
		]);
		data.snapshots = [{ label: "CODEX", windows: [], message: "provider offline" }];
		panel.refresh();
		expect(panel.summary(80)).toBe("CODEX provider offline");
		data.snapshots = [];
		panel.refresh();
		expect(panel.summary(80)).toBe("");
		expect(registry.get("omk:subscription-usage")?.rows.map((row) => row.text)).toEqual([
			"No configured subscription providers",
		]);
		panel.dispose();
		registry.dispose();
	});

	it("recovers from a failed host reader without retaining its diagnostic", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		let failing = true;
		const panel = createSubscriptionUsagePanel(
			{ events },
			{
				getSubscriptionUsage() {
					if (failing) throw new Error("PRIVATE_DETAIL");
					return undefined;
				},
			},
		);
		panel.refresh();
		expect(panel.summary(80)).toBe("Quota: usage unavailable");
		failing = false;
		panel.refresh();
		expect(panel.summary(80)).toBe("");
		expect(registry.get("omk:subscription-usage")?.rows.map((row) => row.text)).toEqual([
			"No subscription usage source on this host",
		]);
		expect(JSON.stringify(registry.get("omk:subscription-usage"))).not.toContain("PRIVATE_DETAIL");
		panel.dispose();
		registry.dispose();
	});

	it("keeps invalid numbers unavailable", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const invalid = createSubscriptionUsagePanel(
			{ events },
			{
				getSubscriptionUsage: () => [
					{
						label: "TEST\n\u001b[31m",
						windows: [
							{ label: "5H", usedPercent: NaN },
							{ label: "7D", usedPercent: Infinity },
						],
					},
				],
			},
		);
		invalid.refresh();
		expect(invalid.summary(80)).not.toContain("0%");
		expect(invalid.summary(80)).not.toContain("\u001b");
		expect(invalid.summary(80)).toContain("unavailable");
		invalid.dispose();
		registry.dispose();
	});
	it("clears removed providers, replays discovery and does not refresh a retired footer", () => {
		const events = createEventBus();
		let calls = 0,
			visible = true;
		const data = {
			getSubscriptionUsage: () => {
				calls++;
				return visible ? [{ label: "CLAUDE", windows: [{ label: "7D", usedPercent: 95 }] }] : [];
			},
		} satisfies SubscriptionUsageData;
		const panel = createSubscriptionUsagePanel({ events }, data);
		panel.refresh();
		const registry = createSidebarPanelRegistry({ events });
		expect(registry.get("omk:subscription-usage")?.keyValues?.[0]?.valueRole).toBe("error");
		visible = false;
		panel.refresh();
		expect(panel.summary(80)).toBe("");
		expect(registry.get("omk:subscription-usage")?.rows.some((row) => row.text.includes("CLAUDE"))).toBe(false);
		panel.dispose();
		const before = calls;
		panel.refresh();
		expect(calls).toBe(before);
		registry.dispose();
	});
	it("bounds large snapshots and retains diagnostics beside valid windows", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const panel = createSubscriptionUsagePanel(
			{ events },
			{
				getSubscriptionUsage: () => [
					{
						label: "PROVIDER".repeat(30),
						windows: Array.from({ length: 30 }, (_, i) => ({ label: `${i}H`, usedPercent: 75 })),
						message: "partial observation",
					},
				],
			},
		);
		panel.refresh();
		const quota = registry.get("omk:subscription-usage");
		expect(quota).toBeDefined();
		expect(quota?.rows.length).toBeLessThanOrEqual(24);
		expect(quota?.keyValues?.at(-1)?.label).toBe("More");
		panel.dispose();
		registry.dispose();
	});
	it("contains failed host readers without leaking their error text", () => {
		const events = createEventBus();
		const panel = createSubscriptionUsagePanel(
			{ events },
			{
				getSubscriptionUsage: () => {
					throw new Error("PRIVATE_DETAIL");
				},
			},
		);
		expect(() => panel.refresh()).not.toThrow();
		expect(panel.summary(80)).toContain("usage unavailable");
		expect(panel.summary(80)).not.toContain("PRIVATE_DETAIL");
		panel.dispose();
	});
	it.each<[number, string]>([
		[0, "now"],
		[60, "1m"],
		[3600, "1h"],
		[3660, "1h1m"],
		[86400, "1d"],
		[90000, "1d1h"],
		[Number.NaN, ""],
		[-1, ""],
	])("formats observed reset time %s and preserves actual zero", (resetsAt, expected) => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const panel = createSubscriptionUsagePanel(
			{ events },
			{ getSubscriptionUsage: () => [{ label: "CODEX", windows: [{ label: "5H", usedPercent: 0, resetsAt }] }] },
			() => 0,
		);
		panel.refresh();
		expect(registry.get("omk:subscription-usage")?.keyValues?.[0]?.value).toBe(`0%${expected ? ` / ${expected}` : ""}`);
		panel.dispose();
		panel.dispose();
		registry.dispose();
	});
	it("keeps window messages visible and avoids unchanged publication loops", () => {
		const events = createEventBus();
		const registry = createSidebarPanelRegistry({ events });
		const panel = createSubscriptionUsagePanel(
			{ events },
			{
				getSubscriptionUsage: () => [
					{ label: "TEST", windows: [{ label: "7D", usedPercent: 80 }], message: "partial observation" },
				],
			},
		);
		let updates = 0;
		const off = events.on("pi-atelier:sidebar-panels", () => {
			updates++;
		});
		panel.refresh();
		panel.refresh();
		expect(updates).toBe(1);
		expect(registry.get("omk:subscription-usage")?.keyValues).toContainEqual({
			label: "TEST",
			value: "partial observation",
			valueRole: "muted",
		});
		expect(registry.get("omk:subscription-usage")?.keyValues?.[0]?.valueRole).toBe("warning");
		panel.dispose();
		off();
		registry.dispose();
	});
});
