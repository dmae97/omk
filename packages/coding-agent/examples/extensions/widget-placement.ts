import type { ExtensionAPI } from "open-multi-agent-kit";

export default function widgetPlacementExtension(omk: ExtensionAPI) {
	omk.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("widget-above", ["Above editor widget"]);
		ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });
	});
}
