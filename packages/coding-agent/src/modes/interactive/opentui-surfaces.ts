import type { Component, TUI } from "omk-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { FooterDataProvider } from "../../core/footer-data-provider.ts";
import type { FooterComponent } from "./components/footer.ts";
import { HybridStatusPanel } from "./hybrid-status-panel.ts";
import { type FooterPanelModel, footerPanelModel } from "./opentui-footer-model.ts";
import type { RNodePanelInput } from "./rnode/rnode-panel.ts";
import type { StatusPanelActivitySnapshot } from "./status-panel-activity.ts";
import { statusPanelModel } from "./status-panel-model.ts";
import { getResolvedThemeColors } from "./theme/theme.ts";

export type { FooterPanelModel, HybridStatusPanel };

/** Same switch as the pinned rail: `OMK_OPENTUI_STATUS_RAIL=0` keeps every surface native. */
const enabled = () => process.env.OMK_OPENTUI_STATUS_RAIL !== "0";

/** The built-in footer: native code computes every segment, OpenTUI lays out and paints the rows. */
export function hybridFooter(footer: FooterComponent, ui: TUI): HybridStatusPanel<FooterPanelModel> | undefined {
	if (!enabled()) return undefined;
	return new HybridStatusPanel<FooterPanelModel>(
		(_expanded, width) => footerPanelModel(footer.renderParts(width), getResolvedThemeColors().text),
		footer,
		() => ui.terminal.rows,
		() => ui.requestRender(),
		{ kind: "footer", height: (model) => model.lines.length },
	);
}

type ControlPaneSources = {
	getSession: () => AgentSession;
	footerData: FooterDataProvider;
	readActivity: () => StatusPanelActivitySnapshot;
	rnode: () => RNodePanelInput | undefined;
};

/** The Ctrl+O control pane overlay. It only shows while tools are expanded, so it renders the detailed view. */
export function hybridControlPane(
	native: Component,
	ui: TUI,
	sources: ControlPaneSources,
): HybridStatusPanel | undefined {
	if (!enabled()) return undefined;
	return new HybridStatusPanel(
		() =>
			statusPanelModel(
				sources.getSession(),
				sources.footerData,
				sources.footerData.getSubscriptionUsage?.() ?? [],
				true,
				sources.readActivity(),
				sources.rnode(),
			),
		native,
		() => ui.terminal.rows,
		() => ui.requestRender(),
	);
}
