import type { TUI } from "omk-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { FooterDataProvider } from "../../core/footer-data-provider.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { statusPaneLayout } from "./components/status-pane-layout.ts";
import { STATUS_SIDEBAR_GUTTER_GAP, StatusSidebarComponent, statusSidebarWidth } from "./components/status-sidebar.ts";
import { HybridStatusPanel } from "./hybrid-status-panel.ts";
import { pinnedRailNotice } from "./layout-class.ts";
import type { RNodePanelInput } from "./rnode/rnode-panel.ts";
import type { StatusPanelActivitySnapshot } from "./status-panel-activity.ts";
import { statusPanelModel } from "./status-panel-model.ts";
import { TmuxStatusRail } from "./tmux-status-rail.ts";

type StatusSidebarSetup = {
	ui: TUI;
	getSession: () => AgentSession;
	footerData: FooterDataProvider;
	/** Starts the optional tmux pane right away when the rail is pinned. */
	pinned: boolean;
	readActivity?: () => StatusPanelActivitySnapshot;
	/** Bound `/rnode` run; both the OpenTUI panel and the native fallback rail render it. */
	rnode?: () => RNodePanelInput;
	visible: (width: number, height: number) => boolean;
};

/** Mount the pinned status rail and its optional tmux owner without changing visibility policy. */
export function setupStatusSidebar(options: StatusSidebarSetup) {
	const { ui, getSession, footerData, pinned, visible } = options;
	const sidebar = new StatusSidebarComponent(
		getSession,
		footerData,
		() => getSession().autoCompactionEnabled,
		() => ui.terminal.rows,
		{ requestRender: () => ui.requestRender(), rnode: options.rnode },
	);
	// Extension footers read usage through the rail's reader, so they never start a second poller.
	footerData.getSubscriptionUsage = () => sidebar.getSubscriptionUsage();
	// OpenTUI is the default pinned rail since 2.0; `0` opts out. Unsupported runtimes fall back to `sidebar`.
	const statusPanel =
		process.env.OMK_OPENTUI_STATUS_RAIL !== "0"
			? new HybridStatusPanel(
					(expanded) =>
						statusPanelModel(
							getSession(),
							footerData,
							sidebar.getSubscriptionUsage(),
							expanded,
							options.readActivity?.(),
							options.rnode?.(),
						),
					sidebar,
					() => ui.terminal.rows,
					() => ui.requestRender(),
				)
			: undefined;
	// Opt-in inside tmux: the native rail moves to its own pane; split failures keep the in-process rail.
	let tmuxRail: TmuxStatusRail | undefined;
	if (process.env.OMK_TMUX_STATUS_RAIL === "1" && process.env.TMUX_PANE) {
		tmuxRail = new TmuxStatusRail((width) => statusPaneLayout(sidebar.render(width), width), {
			pane: process.env.TMUX_PANE,
			onClose: () => ui.requestRender(),
		});
		if (pinned) tmuxRail.start();
	}
	ui.showOverlay(statusPanel ?? sidebar, {
		anchor: "top-right",
		width: statusSidebarWidth,
		maxHeight: "100%",
		nonCapturing: true,
		visible,
	});
	// Keep the overlay and reserved content width on the same visibility policy.
	ui.setRightGutter((width, height) =>
		visible(width, height) ? statusSidebarWidth(width) + STATUS_SIDEBAR_GUTTER_GAP : 0,
	);
	return { sidebar, tmuxRail, statusPanel };
}

export function toggleStatusSidebarState(
	pinned: boolean,
	hasCustomFooter: boolean,
	settings: SettingsManager,
	tmuxRail: TmuxStatusRail | undefined,
	ui: TUI,
	showStatus: (msg: string) => void,
): boolean {
	const next = !pinned;
	settings.setPinStatusSidebar(next);
	if (next && !hasCustomFooter) tmuxRail?.start();
	else tmuxRail?.stop();
	if (next && !tmuxRail?.active) {
		const notice = pinnedRailNotice(ui.terminal.columns, ui.terminal.rows);
		if (notice) showStatus(notice);
	}
	ui.requestRender();
	return next;
}
