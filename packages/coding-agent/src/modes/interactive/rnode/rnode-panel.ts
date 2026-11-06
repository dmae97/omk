import { truncateToWidth } from "omk-tui";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { boxTextLine, semanticBoxTextLine, sidebarRule } from "../components/control-panel-box.ts";
import { type AuthorityCell, authorityStyle, authorityText } from "../control-plane-view-model.ts";
import { theme } from "../theme/theme.ts";
import type { RNodeCell, RNodeViewModel } from "./rnode-model.ts";

/** A bound run with no installed snapshot yet: the first read is pending or failed. */
export interface RNodePending {
	readonly runId: string;
	readonly feed: AuthorityCell;
}

export type RNodePanelInput = RNodeViewModel | RNodePending | undefined;

export interface RNodePanelOptions {
	readonly width: number;
	readonly maxRows: number;
}

// Longest header label is "proof"; node status text is padded to "? prior gen" plus one space.
const LABEL_COLUMN = 5;
const STATUS_CELLS = 12;

function authorityRow(width: number, label: string, cell: AuthorityCell): string {
	return semanticBoxTextLine(
		width,
		label,
		authorityText(cell),
		"start",
		LABEL_COLUMN,
		authorityStyle(cell.state).color,
	);
}

function nodeRow(width: number, node: RNodeCell): string {
	const status = authorityText(node).padEnd(STATUS_CELLS);
	const id = singleLineDisplayText(node.id);
	const deps = node.dependsOn.length > 0 ? `  ← ${node.dependsOn.map(singleLineDisplayText).join(", ")}` : "";
	// Inner frame width minus the status cells; an over-long id or dependency list ends in an ellipsis.
	const rest = truncateToWidth(`${id}  a${node.attempt}${deps}`, Math.max(0, width - 4 - STATUS_CELLS), "…");
	return boxTextLine(width, `${theme.fg(authorityStyle(node.state).color, status)}${rest}`);
}

function headerRows(view: RNodePanelInput, width: number): string[] {
	const rule = sidebarRule(width, "R·NODE");
	if (view === undefined) {
		return [rule, authorityRow(width, "run", { state: "unknown", label: "no run graph source" })];
	}
	if (!("layers" in view)) {
		return [
			rule,
			semanticBoxTextLine(width, "run", view.runId, "middle", LABEL_COLUMN),
			authorityRow(width, "feed", view.feed),
		];
	}
	const run = `${view.runId} · rev ${view.revision} · gen ${view.generation}`;
	return [
		rule,
		semanticBoxTextLine(width, "run", run, "middle", LABEL_COLUMN),
		authorityRow(width, "proof", view.proof),
		authorityRow(width, "feed", view.feed),
		// One row per outcome axis so the longest values (`reconciliation_required`) fit a 38-column pane.
		semanticBoxTextLine(width, "exec", view.axes.slice(0, 2).join("/"), "start", LABEL_COLUMN, "muted"),
		...["vrfy", "app", "pub"].map((label, index) =>
			semanticBoxTextLine(width, label, view.axes[index + 2] ?? "?", "start", LABEL_COLUMN, "muted"),
		),
	];
}

/**
 * Viewport-anchored surfaces only: the graph changes mid-turn, so it never belongs in the
 * scrollback header. Rows past `maxRows` collapse into a `+N more` count of hidden nodes.
 */
export function renderRNodePanel(view: RNodePanelInput, options: RNodePanelOptions): string[] {
	const { width, maxRows } = options;
	const header = headerRows(view, width);
	if (header.length >= maxRows) return header.slice(0, Math.max(0, maxRows));
	const layers = view !== undefined && "layers" in view ? view.layers : [];
	const body = layers.flatMap((layer) => [
		{ line: sidebarRule(width, layer.depth === null ? "UNORDERED" : `L${layer.depth}`), nodes: 0 },
		...layer.nodes.map((node) => ({ line: nodeRow(width, node), nodes: 1 })),
	]);
	const room = maxRows - header.length;
	if (body.length <= room) return [...header, ...body.map((row) => row.line)];
	let cut = room - 1;
	// A layer rule with none of its nodes below it says nothing, so it moves past the cut.
	while (cut > 0 && body[cut - 1]?.nodes === 0) cut--;
	const shown = body.slice(0, cut);
	const hidden = body.slice(cut).reduce((sum, row) => sum + row.nodes, 0);
	return [...header, ...shown.map((row) => row.line), boxTextLine(width, `+${hidden} more`, "dim")];
}
