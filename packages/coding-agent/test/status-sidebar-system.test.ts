import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import {
	memoryPressureColor,
	sidebarSystemRows,
	systemMemory,
} from "../src/modes/interactive/components/status-sidebar-system.ts";
import { buildControlPlaneViewModel } from "../src/modes/interactive/control-plane-view-model.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("omk-paper-dark"));

function metrics(used: number | null, total: number | null): ReadonlyFooterDataProvider {
	return {
		getSystemMemoryUsedBytes: () => used,
		getSystemMemoryTotalBytes: () => total,
		getCpuPercent: () => 2,
	} as ReadonlyFooterDataProvider;
}

describe("sidebar host resources", () => {
	it.each([
		[null, null],
		[0, 0],
		[NaN, 100],
		[10, Infinity],
		[-1, 100],
		[101, 100],
	])("keeps invalid memory samples %s/%s unavailable", (used, total) => {
		expect(systemMemory(metrics(used, total))).toEqual({ percent: null, caption: "unavailable" });
	});

	it("accepts measured zero rather than treating it as missing", () => {
		expect(systemMemory(metrics(0, 1024))).toEqual({ percent: 0, caption: "0B / 1K" });
	});

	it.each([34, 40, 48])("fits %i columns and floors host percent independently from process CPU", (width) => {
		const resource = buildControlPlaneViewModel({
			systemCpuPercent: 84.99,
			memoryRssBytes: 512 * 1024 ** 2,
		}).resources;
		const lines = sidebarSystemRows(width, metrics(89.99, 100), resource);
		const text = lines.map(stripAnsi).join("\n");
		expect(text).toMatch(/CPU.*84%/);
		expect(text).toMatch(/RAM.*89%/);
		expect(text).toContain("omk  cpu 2% rss 512M");
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	});

	it("uses the resource governor CPU threshold, not process CPU, for the host state", () => {
		const resource = buildControlPlaneViewModel({ systemCpuPercent: 90, busyCpuPercent: 85 }).resources;
		expect(resource.state).toBe("degraded");
		expect(memoryPressureColor(null)).toBe("muted");
		expect(memoryPressureColor(84.99)).toBe("text");
		expect(memoryPressureColor(85)).toBe("warning");
		expect(memoryPressureColor(95)).toBe("error");
	});
});
