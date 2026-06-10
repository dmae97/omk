/**
 * OMK Tabbed Panel — wraps multiple right-rail panels
 * with tab switching via keyboard or API.
 *
 * Tabs:
 *   [1] CONTROL  — OMK://CONTROL dashboard (status, runtime, skills, etc.)
 *   [2] HISTORY  — work log (assistant msgs, tool calls, bash, user prompts)
 */

import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";
import { type OmkControlDashboardActivity, OmkControlDashboardComponent } from "./omk-control-dashboard.ts";
import { OmkHistoryPanel } from "./omk-history-panel.ts";

export type OmkTabId = "control" | "history";

interface TabDef {
	id: OmkTabId;
	label: string;
	hotkey: string;
}

const TABS: TabDef[] = [
	{ id: "control", label: "CONTROL", hotkey: "1" },
	{ id: "history", label: "HISTORY", hotkey: "2" },
];

const TAB_MIN_WIDTH = 28;

function fitToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class OmkTabbedPanel implements Component {
	private activeTab: OmkTabId = "control";
	private controlDashboard: OmkControlDashboardComponent;
	private historyPanel: OmkHistoryPanel;
	private session: AgentSession;

	constructor(
		session: AgentSession,
		footerData: ReadonlyFooterDataProvider,
		getActivity: () => OmkControlDashboardActivity,
	) {
		this.session = session;
		this.controlDashboard = new OmkControlDashboardComponent(session, footerData, getActivity);
		this.historyPanel = new OmkHistoryPanel();
	}

	getActiveTab(): OmkTabId {
		return this.activeTab;
	}

	switchTab(tab: OmkTabId): void {
		if (this.activeTab !== tab) {
			this.activeTab = tab;
			this.invalidate();
		}
	}

	nextTab(): void {
		const idx = TABS.findIndex((t) => t.id === this.activeTab);
		const next = TABS[(idx + 1) % TABS.length] ?? TABS[0]!;
		this.switchTab(next.id);
	}

	setSession(session: AgentSession): void {
		this.session = session;
		this.controlDashboard.setSession(session);
	}

	invalidate(): void {
		this.controlDashboard.invalidate();
	}

	scrollUp(): void {
		if (this.activeTab === "history") {
			this.historyPanel.scrollUp();
		}
	}

	scrollDown(): void {
		if (this.activeTab === "history") {
			this.historyPanel.scrollDown();
		}
	}

	render(width: number, height?: number): string[] {
		if (width < TAB_MIN_WIDTH) return [];

		const w = Math.max(TAB_MIN_WIDTH, width);
		const lines: string[] = [];

		// Tab bar
		lines.push(this.renderTabBar(w));

		if (this.activeTab === "control") {
			const dashboardHeight = height !== undefined ? Math.max(1, height - 1) : undefined;
			lines.push(...this.controlDashboard.render(w, dashboardHeight));
		} else {
			this.historyPanel.feedSession(this.session);
			const historyHeight = height !== undefined ? Math.max(1, height - 1) : undefined;
			lines.push(...this.historyPanel.render(w, historyHeight));
		}

		return lines;
	}

	private renderTabBar(width: number): string {
		const tabWidth = Math.floor((width - 4) / TABS.length);
		const parts: string[] = [];
		for (const tab of TABS) {
			const isActive = tab.id === this.activeTab;
			const label = ` ${tab.hotkey}:${tab.label} `;
			const padded = fitToWidth(label, tabWidth);
			parts.push(isActive ? theme.bold(theme.fg("accent", padded)) : theme.fg("dim", padded));
		}
		const remaining = width - parts.reduce((sum, p) => sum + visibleWidth(p), 0) - 2;
		return (
			theme.fg("borderAccent", "╭") +
			parts.join(theme.fg("border", "│")) +
			" ".repeat(Math.max(0, remaining)) +
			theme.fg("borderAccent", "╮")
		);
	}
}
