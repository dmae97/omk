import type { OpenTui, OpenTuiNode, OpenTuiRenderer } from "./opentui-core.ts";
import type { FooterPanelModel, FooterSpan } from "./opentui-footer-model.ts";

/** Footer rows laid out by OpenTUI flexbox: left runs at the start, right runs at the end. */
export function buildFooterScene(
	openTui: OpenTui,
	renderer: OpenTuiRenderer,
	model: FooterPanelModel,
	width: number,
	height: number,
): OpenTuiNode {
	const { BoxRenderable, TextRenderable } = openTui;
	const root = new BoxRenderable(renderer, { width, height, flexDirection: "column" });
	let id = 0;
	const group = (spans: readonly FooterSpan[], shrink: number) => {
		const box = new BoxRenderable(renderer, {
			height: 1,
			flexDirection: "row",
			flexShrink: shrink,
			overflow: "hidden",
		});
		for (const span of spans)
			box.add(
				new TextRenderable(renderer, {
					id: `footer-${++id}`,
					content: span.text,
					fg: span.color ?? model.text,
					attributes: span.bold ? openTui.boldAttribute : 0,
					height: 1,
					flexShrink: 0,
					wrapMode: "none",
				}),
			);
		return box;
	};
	for (const line of model.lines.slice(0, height)) {
		const row = new BoxRenderable(renderer, {
			width: "100%",
			height: 1,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
		});
		// The left side keeps its full width; the right side is clipped first, as in the native footer.
		row.add(group(line.left, 0));
		if (line.right.length > 0) row.add(group(line.right, 1));
		root.add(row);
	}
	return root;
}
