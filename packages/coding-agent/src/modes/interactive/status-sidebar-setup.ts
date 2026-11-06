import type { TUI } from "omk-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { FooterDataProvider } from "../../core/footer-data-provider.ts";
import { STATUS_SIDEBAR_GUTTER_GAP, StatusSidebarComponent, statusSidebarWidth } from "./components/status-sidebar.ts";
import { HybridStatusPanel } from "./hybrid-status-panel.ts";
import type { RNodePanelInput } from "./rnode/rnode-panel.ts";
import type { StatusPanelActivitySnapshot } from "./status-panel-activity.ts";
import { statusPanelModel } from "./status-panel-model.ts";

type StatusSidebarSetup = {
	ui: TUI;
	getSession: () => AgentSession;
	footerData: FooterDataProvider;
	readActivity?: () => StatusPanelActivitySnapshot;
	/** Bound `/rnode` run; both the OpenTUI panel and the native fallback rail render it. */
	rnode?: () => RNodePanelInput;
	visible: (width: number, height: number) => boolean;
};

/** Mount the pinned status rail without changing visibility policy. */
export function setupStatusSidebar(options: StatusSidebarSetup) {
	const { ui, getSession, footerData, visible } = options;
	const sidebar = new StatusSidebarComponent(
		getSession,
		footerData,
		() => getSession().autoCompactionEnabled,
		() => ui.terminal.rows,
		{ requestRender: () => ui.requestRender(), rnode: options.rnode },
	);
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
	return { sidebar, statusPanel };
}
