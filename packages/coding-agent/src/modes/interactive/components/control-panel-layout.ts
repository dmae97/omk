import { nextActiveTodo, type TodoState, summary as todoSummary } from "../../../core/todo-state.ts";
import { buildControlPlaneViewModel, type ControlPlaneViewModel } from "../control-plane-view-model.ts";
import { railFits } from "../layout-class.ts";
import { theme } from "../theme/theme.ts";
import {
	boxBottom,
	boxTextLine,
	boxTop,
	composeColumns,
	divider,
	fitLine,
	labelCell,
	padBoxColumn,
	semanticBoxTextLine,
	sidebarRule,
	textLine,
} from "./control-panel-box.ts";
import { compactLede, heroBodyLines, narrowBrandLines } from "./control-panel-brand.ts";
import {
	contextRailLines,
	modelLabel,
	type RailSurface,
	resourceRailLines,
	runRailLines,
	verifyRailLines,
	verifyToken,
} from "./control-plane-rail.ts";

export const CONTROL_PANEL_SIDEBAR_WIDTH = 38;
export const CONTROL_PANEL_GAP_WIDTH = 2;

export interface ControlPanelContent {
	appName: string;
	version: string;
	compactInstructions: () => string;
	expandedInstructions: () => string;
	compactOnboarding: () => string;
	onboarding: () => string;
	statusSnapshot?: () => ControlPanelStatusSnapshot;
}

export interface ControlPanelStatusSnapshot {
	readonly modelId?: string;
	readonly modelProvider?: string;
	readonly thinkingLevel?: string;
	readonly contextPercent?: number | null;
	readonly contextWindowTokens?: number;
	readonly headroomStatus?: string;
	readonly optimizerPolicy?: string;
	readonly skillCount?: number;
	readonly mcpCount?: number;
	readonly cwdLabel?: string;
	readonly gitBranch?: string | null;
	readonly todoState?: TodoState;
	readonly ansiColorState?: string;
	/** Sourced authority state. Absent => RUN/VERIFY/RESOURCES render unknown; CTX uses only the fields above. */
	readonly controlPlane?: ControlPlaneViewModel;
}

/**
 * `reveal` in [0, 1] is the ink-in progress of the opening wordmark (1 = final render). It never
 * changes the geometry: every reveal value yields the same line count and widths.
 */
export function renderControlPanelLayout(
	content: ControlPanelContent,
	expanded: boolean,
	width: number,
	reveal = 1,
): string[] {
	if (width <= 0) return [];
	// One snapshot per render call: building it reads the live session, so every helper shares it.
	const frame: DeckFrame = { content, snapshot: statusSnapshot(content), reveal };
	return expanded ? renderExpanded(frame, width) : renderCompact(frame, width);
}

/** One render call: the content, its single status snapshot, and the wordmark reveal. */
interface DeckFrame {
	readonly content: ControlPanelContent;
	readonly snapshot: ControlPanelStatusSnapshot;
	readonly reveal: number;
}

/** Label of the narrow layouts' opening divider: the product name, in ink rather than the accent. */
const OPENING_LABEL = "OMK · OPEN MULTI-AGENT KIT";

/** Viewport-anchored control-pane overlay: the one rail surface that may show live values. */
export function renderControlPanelRightPane(content: ControlPanelContent, width: number): string[] {
	if (width <= 0) return [];
	return sidebarPanel(statusSnapshot(content), width, "overlay");
}

function renderCompact(frame: DeckFrame, width: number): string[] {
	if (railFits(width)) {
		const deck = renderDeck(frame, width);
		if (deck.length > 0) return deck;
	}
	return [
		divider(width, theme.bold(OPENING_LABEL), "text", "top"),
		textLine(width, compactLede()),
		statusLine(frame, width),
		textLine(width, frame.content.compactInstructions()),
		textLine(width, frame.content.compactOnboarding(), "dim"),
		divider(width, "", "borderMuted", "bottom"),
	];
}

function renderDeck(frame: DeckFrame, width: number): string[] {
	const { leftWidth, sidebarWidth } = deckWidths(width);
	if (leftWidth < 72) return [];
	const hero = heroPanel(frame, leftWidth);
	// The deck belongs to the startup header, which scrolls into scrollback: its rail is the header surface.
	const rail = sidebarPanel(frame.snapshot, sidebarWidth, "header");
	// Both framed columns close on the same row so the deck reads as one block
	// instead of a short hero beside a long ragged rail.
	const deckHeight = Math.max(hero.length, rail.length);
	const lines = composeColumns(
		padBoxColumn(hero, deckHeight, leftWidth, "center"),
		leftWidth,
		padBoxColumn(rail, deckHeight, sidebarWidth),
		sidebarWidth,
		CONTROL_PANEL_GAP_WIDTH,
		width,
	);
	// Left-aligned under the deck, like the hero's copy; no centred brochure lines.
	lines.push(fitLine(`  ${frame.content.compactInstructions()}`, width));
	lines.push(fitLine(`  ${theme.fg("dim", frame.content.compactOnboarding())}`, width));
	return lines;
}

function deckWidths(width: number): { leftWidth: number; sidebarWidth: number } {
	const sidebarWidth = Math.min(CONTROL_PANEL_SIDEBAR_WIDTH, Math.max(34, Math.floor(width * 0.28)));
	return { leftWidth: width - CONTROL_PANEL_GAP_WIDTH - sidebarWidth, sidebarWidth };
}

function heroPanel({ content, snapshot, reveal }: DeckFrame, width: number): string[] {
	return [
		// The release gate reads this title template from this file.
		boxTop(width, `omk v${content.version} · OMK://CONTROL`),
		...heroBodyLines(snapshot, Math.max(0, width - 4), reveal).map((line) => boxTextLine(width, line)),
		boxBottom(width),
	];
}

/**
 * Label gutters are aligned per section rather than across the whole rail: a
 * global gutter would indent short labels so far that long values (todo text,
 * model ids) lose characters at rail widths of 34-38 columns.
 */
const RAIL_COLUMNS = { todo: 4, session: 3 } as const;

/**
 * Right control rail (deck column and overlay pane). Every status row comes from the
 * control-plane view model; this function adds only the tabs, identity, TODO and SESSION.
 * `surface` selects the rows: the header rail omits live rows and keeps a fixed height.
 */
function sidebarPanel(snapshot: ControlPanelStatusSnapshot, width: number, surface: RailSurface): string[] {
	const vm = controlPlaneView(snapshot);
	return [
		sidebarTabs(width),
		// Identity, not a signal: ink, left-aligned under the tabs.
		boxTextLine(width, theme.bold(theme.fg("text", "OMK://CONTROL"))),
		...runRailLines(vm, width, surface),
		...verifyRailLines(vm, width),
		...contextRailLines(vm, snapshot, width),
		...resourceRailLines(vm, snapshot, width, surface),
		sidebarRule(width, "TODO"),
		...todoSidebarLines(snapshot.todoState, width),
		sidebarRule(width, "SESSION"),
		semanticBoxTextLine(width, "cwd", snapshot.cwdLabel ?? "?", "end", RAIL_COLUMNS.session),
		semanticBoxTextLine(width, "git", snapshot.gitBranch ?? "?", "start", RAIL_COLUMNS.session),
		boxBottom(width),
	];
}

function todoSidebarLines(state: TodoState | undefined, width: number): string[] {
	if (!state || state.items.length === 0) {
		return [
			boxTextLine(width, `${labelCell("todo", RAIL_COLUMNS.todo)} ${theme.fg("dim", "empty")}`),
			boxTextLine(width, `${labelCell("next", RAIL_COLUMNS.todo)} ${theme.fg("dim", "no active todos")}`),
		];
	}
	const counts = todoSummary(state);
	const next = nextActiveTodo(state);
	return [
		boxTextLine(width, `${labelCell("todo", RAIL_COLUMNS.todo)} ${counts.done}/${counts.total} done`),
		semanticBoxTextLine(width, "next", next?.label ?? "complete", "middle", RAIL_COLUMNS.todo),
	];
}

function renderExpanded(frame: DeckFrame, width: number): string[] {
	const { content } = frame;
	if (railFits(width)) {
		const { leftWidth, sidebarWidth } = deckWidths(width);
		const resourceLines = ["", ...content.onboarding().split("\n")];
		const rightRail = blankSidebarRail(sidebarWidth, resourceLines.length);
		const lines = [...renderDeck(frame, width)];
		lines.push(...composeColumns(resourceLines, leftWidth, rightRail, sidebarWidth, CONTROL_PANEL_GAP_WIDTH, width));
		return lines;
	}

	const lines = [divider(width, theme.bold(OPENING_LABEL), "text", "top"), statusLine(frame, width)];
	if (width >= 32) lines.push(...narrowBrandLines(width - 4, frame.reveal).map((line) => textLine(width, line)));
	lines.push(divider(width, "SYSTEM MAP", "mdHeading"));
	for (const instruction of content.expandedInstructions().split("\n")) lines.push(textLine(width, instruction));
	lines.push(divider(width, "STARTUP LINK", "muted"));
	for (const onboardingLine of content.onboarding().split("\n")) lines.push(textLine(width, onboardingLine, "dim"));
	lines.push(divider(width, "", "borderMuted", "bottom"));
	return lines;
}

function blankSidebarRail(width: number, lineCount: number): string[] {
	return Array.from({ length: lineCount }, () => boxTextLine(width, ""));
}

function statusSnapshot(content: ControlPanelContent): ControlPanelStatusSnapshot {
	return content.statusSnapshot?.() ?? {};
}

/** Sourced authority view; without one, only context usage is sourced and every other cue renders unknown. */
function controlPlaneView(snapshot: ControlPanelStatusSnapshot): ControlPlaneViewModel {
	return (
		snapshot.controlPlane ??
		buildControlPlaneViewModel({
			contextPercent: snapshot.contextPercent,
			contextWindowTokens: snapshot.contextWindowTokens,
		})
	);
}

function sidebarTabs(width: number): string {
	return boxTextLine(
		width,
		fitLine(
			`${theme.bold(theme.fg("accent", "1:CONTROL"))}    ${theme.fg("muted", "2:HISTORY")}`,
			Math.max(0, width - 4),
		),
	);
}

/** Narrow (< md) status line: `OMK vX · VERIFY … · MODEL … · ANSI ON|OFF` (turn-stable values only). */
function statusLine({ content, snapshot }: DeckFrame, width: number): string {
	const segments = [
		theme.bold(theme.fg("text", `${content.appName.toUpperCase()} v${content.version}`)),
		verifyToken(controlPlaneView(snapshot), "muted", true),
		`${theme.fg("muted", "MODEL")} ${theme.fg("text", modelLabel(snapshot))}`,
		// Terminal colour setting, not an authority state: neutral colour.
		`${theme.fg("muted", "ANSI")} ${theme.fg("text", (snapshot.ansiColorState ?? "?").toUpperCase())}`,
	];
	return textLine(width, segments.join(theme.fg("dim", " · ")));
}
