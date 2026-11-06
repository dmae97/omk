import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { authorityStyle, type ResourceView } from "../control-plane-view-model.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { boxTextLine, meterBar, sidebarRule } from "./control-panel-box.ts";
import { formatBytes } from "./footer.ts";

export function systemMemory(footer: ReadonlyFooterDataProvider): { percent: number | null; caption: string } {
	const used = footer.getSystemMemoryUsedBytes();
	const total = footer.getSystemMemoryTotalBytes();
	if (
		used === null ||
		total === null ||
		!Number.isFinite(used) ||
		!Number.isFinite(total) ||
		total <= 0 ||
		used < 0 ||
		used > total
	) {
		return { percent: null, caption: "unavailable" };
	}
	return { percent: (used / total) * 100, caption: `${formatBytes(used)} / ${formatBytes(total)}` };
}

export function memoryPressureColor(percent: number | null): ThemeColor {
	return percent === null ? "muted" : percent >= 95 ? "error" : percent >= 85 ? "warning" : "text";
}

/** Whole-host meters and explicitly labelled process metrics reuse the existing sampler. */
export function sidebarSystemRows(width: number, footer: ReadonlyFooterDataProvider, resource: ResourceView): string[] {
	const memory = systemMemory(footer);
	const meter = (label: string, percent: number | null, color: ThemeColor) => {
		const cells = Math.max(0, Math.min(24, width - 13));
		const filled = percent === null ? 0 : Math.round((percent / 100) * cells);
		return boxTextLine(
			width,
			`${theme.fg("muted", `${label}  `)}${meterBar(filled, cells, color)} ${theme.fg(color, percent === null ? "?" : `${Math.floor(percent)}%`)}`,
		);
	};
	const cpu = footer.getCpuPercent();
	const rss = resource.memoryRssBytes;
	return [
		sidebarRule(width, "SYSTEM"),
		meter("CPU", resource.systemCpuPercent, authorityStyle(resource.state).color),
		meter("RAM", memory.percent, memoryPressureColor(memory.percent)),
		boxTextLine(width, `${theme.fg("muted", "used ")}${theme.fg("text", memory.caption)}`),
		boxTextLine(
			width,
			theme.fg(
				"muted",
				`omk  cpu ${cpu === null || !Number.isFinite(cpu) ? "?" : `${Math.floor(cpu)}%`} rss ${rss === null ? "?" : formatBytes(rss)}`,
			),
		),
	];
}
