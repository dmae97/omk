import { type Component, Container, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import { theme } from "../theme/theme.ts";

export type OmkControlPanelMode = "pin" | "hide" | "compact" | "wide";

export interface OmkControlLayoutOptions {
	dashboardWidth: number;
	minWidth: number;
	gutterWidth?: number;
	onActiveChange?: (active: boolean) => void;
}

function fitPaneLine(line: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export interface OmkControlLayoutMetrics {
	separator: string;
	separatorWidth: number;
	gutterWidth: number;
	railWidth: number;
	mainWidth: number;
	useSplit: boolean;
}

export class OmkControlLayout extends Container {
	private dashboard: Component;
	private dashboardWidth: number;
	private minWidth: number;
	private gutterWidth: number;
	private onActiveChange: ((active: boolean) => void) | undefined;
	private active: boolean | undefined;
	private panelMode: OmkControlPanelMode = "pin";

	constructor(dashboard: Component, options: OmkControlLayoutOptions) {
		super();
		this.dashboard = dashboard;
		this.dashboardWidth = options.dashboardWidth;
		this.minWidth = options.minWidth;
		this.gutterWidth = Math.max(0, options.gutterWidth ?? 1);
		this.onActiveChange = options.onActiveChange;
	}

	setDashboard(dashboard: Component): void {
		this.dashboard = dashboard;
		this.invalidate();
	}

	getPanelMode(): OmkControlPanelMode {
		return this.panelMode;
	}

	setPanelMode(mode: OmkControlPanelMode): void {
		this.panelMode = mode;
		this.invalidate();
	}

	render(width: number, height?: number): string[] {
		const layout = this.getLayoutMetrics(width);
		this.setActive(layout.useSplit);

		if (!layout.useSplit) {
			return super.render(width, height);
		}

		const mainLines: string[] = [];
		for (const child of this.children) {
			mainLines.push(...child.render(layout.mainWidth, height));
		}

		const visibleHeight = height !== undefined ? Math.max(1, height) : undefined;
		const dashboardLines = this.dashboard.render(layout.railWidth, visibleHeight);
		const dashboardLineCount =
			visibleHeight === undefined ? dashboardLines.length : Math.min(dashboardLines.length, visibleHeight);
		const lineCount = Math.max(mainLines.length, dashboardLineCount);
		const viewportTop = visibleHeight === undefined ? 0 : Math.max(0, lineCount - visibleHeight);
		const result: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			const mainLine = fitPaneLine(mainLines[i] ?? "", layout.mainWidth);
			const dashboardIndex = visibleHeight === undefined ? i : i - viewportTop;
			const dashboardSource =
				dashboardIndex >= 0 && (visibleHeight === undefined || dashboardIndex < visibleHeight)
					? (dashboardLines[dashboardIndex] ?? "")
					: "";
			const dashboardLine = fitPaneLine(dashboardSource, layout.railWidth);
			result.push(mainLine + " ".repeat(layout.gutterWidth) + layout.separator + dashboardLine);
		}
		return result;
	}

	getMainWidth(width: number): number {
		const layout = this.getLayoutMetrics(width);
		return layout.useSplit ? layout.mainWidth : width;
	}

	getLayoutMetrics(width: number): OmkControlLayoutMetrics {
		const separator = theme.fg("borderMuted", "│");
		const separatorWidth = visibleWidth(separator);
		const gutterWidth = this.gutterWidth;
		const maxRailWidth = this.panelMode === "compact" ? 34 : this.dashboardWidth;
		const minRailWidth = this.panelMode === "compact" ? 30 : Math.max(30, Math.floor(width * 0.24));
		const railWidth = Math.min(maxRailWidth, Math.max(minRailWidth, Math.floor(width * 0.38)));
		const mainWidth = width - railWidth - separatorWidth - gutterWidth;
		const useSplit = this.panelMode !== "hide" && width >= this.minWidth && mainWidth >= 40;
		return { separator, separatorWidth, gutterWidth, railWidth, mainWidth, useSplit };
	}

	private setActive(active: boolean): void {
		if (this.active === active) return;
		this.active = active;
		this.onActiveChange?.(active);
	}
}
