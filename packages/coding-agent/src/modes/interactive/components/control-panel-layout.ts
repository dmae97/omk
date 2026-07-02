import { truncateToWidth, visibleWidth } from "omk-tui";
import type { PiPackageIntakeSummary } from "../../../core/pi-package-intake.ts";
import { nextActiveTodo, type TodoState, summary as todoSummary } from "../../../core/todo-state.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import {
	boxBottom,
	boxCenteredLine,
	boxTextLine,
	boxTop,
	centerLine,
	composeColumns,
	divider,
	fitLine,
	sidebarRule,
	textLine,
} from "./control-panel-box.ts";
import { SPARKLE_ROW_BOTTOM, SPARKLE_ROW_TOP, sparkleRow } from "./control-panel-sparkles.ts";

export const CONTROL_PANEL_ASCII_ART = [
	" ███████   ██       ██  ██    ██",
	"██     ██  ███     ███  ██   ██ ",
	"██     ██  ████   ████  ██  ██  ",
	"██     ██  ██ ██ ██ ██  █████   ",
	"██     ██  ██  ███  ██  ██  ██  ",
	"██     ██  ██   █   ██  ██   ██ ",
	" ███████   ██       ██  ██    ██",
];
const META_WIDTH = 31;
export const CONTROL_PANEL_OVERLAY_MIN_WIDTH = 112;
export const CONTROL_PANEL_DECK_MIN_WIDTH = CONTROL_PANEL_OVERLAY_MIN_WIDTH + 1;
export const CONTROL_PANEL_SIDEBAR_WIDTH = 38;
export const CONTROL_PANEL_GAP_WIDTH = 2;
const CONTEXT_METER_CELLS = 12;
const SPARKLINE_WIDTH = 16;
const SPARKLINE_GLYPHS = "▁▂▃▄▅▆▇█";

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
	readonly contextTokens?: number | null;
	readonly headroomStatus?: string;
	readonly optimizerPolicy?: string;
	readonly skillCount?: number;
	readonly mcpCount?: number;
	readonly packageIntake?: PiPackageIntakeSummary;
	readonly cwdLabel?: string;
	readonly gitBranch?: string | null;
	readonly todoState?: TodoState;
	readonly runtimeState?: string;
	readonly routeState?: string;
	readonly evidenceState?: string;
	readonly controlState?: string;
	readonly dagOrchestrationState?: string;
	readonly ansiColorState?: string;
	readonly startupState?: string;
	readonly linkState?: string;
	readonly sidebarState?: string;
}

export function renderControlPanelLayout(
	content: ControlPanelContent,
	expanded: boolean,
	width: number,
	bannerFrame?: string[],
	sparkleMs = 0,
): string[] {
	if (width <= 0) return [];
	return expanded
		? renderExpanded(content, width, bannerFrame, sparkleMs)
		: renderCompact(content, width, bannerFrame, sparkleMs);
}

export function renderControlPanelRightPane(content: ControlPanelContent, width: number): string[] {
	if (width <= 0) return [];
	return sidebarPanel(content, width);
}

function renderCompact(content: ControlPanelContent, width: number, bannerFrame?: string[], sparkleMs = 0): string[] {
	if (width >= CONTROL_PANEL_DECK_MIN_WIDTH) {
		const deck = renderDeck(content, width, bannerFrame, sparkleMs);
		if (deck.length > 0) return deck;
	}
	return [
		divider(width, "OMK//CONTROL PANEL", "accent"),
		statusLine(content, width),
		textLine(width, content.compactInstructions()),
		textLine(width, content.compactOnboarding(), "dim"),
	];
}

function renderDeck(content: ControlPanelContent, width: number, bannerFrame?: string[], sparkleMs = 0): string[] {
	const { leftWidth, sidebarWidth } = deckWidths(width);
	if (leftWidth < 72) return [];
	const lines = composeColumns(
		heroPanel(content, leftWidth, bannerFrame, sparkleMs),
		leftWidth,
		sidebarPanel(content, sidebarWidth),
		sidebarWidth,
		CONTROL_PANEL_GAP_WIDTH,
		width,
	);
	lines.push(controlStripLine(content, width));
	lines.push(centerLine(width, content.compactOnboarding(), "dim"));
	return lines;
}

function deckWidths(width: number): { leftWidth: number; sidebarWidth: number } {
	const sidebarWidth = Math.min(CONTROL_PANEL_SIDEBAR_WIDTH, Math.max(34, Math.floor(width * 0.28)));
	return { leftWidth: width - CONTROL_PANEL_GAP_WIDTH - sidebarWidth, sidebarWidth };
}

function heroPanel(content: ControlPanelContent, width: number, bannerFrame?: string[], sparkleMs = 0): string[] {
	const snapshot = statusSnapshot(content);
	const innerWidth = Math.max(0, width - 4);
	return [
		boxTop(width, `omk v${content.version} · OMK://CONTROL`),
		boxCenteredLine(width, theme.bold(theme.fg("accent", "OMK"))),
		boxCenteredLine(width, theme.fg("muted", "route · verify · loop · control")),
		boxTextLine(width, sparkleRow(innerWidth, SPARKLE_ROW_TOP, sparkleMs)),
		...(bannerFrame ?? CONTROL_PANEL_ASCII_ART).map((line, index) => {
			if (bannerFrame) return boxCenteredLine(width, line);
			const color: ThemeColor = index < 2 ? "mdCode" : index < 4 ? "accent" : index < 6 ? "success" : "warning";
			return boxCenteredLine(width, theme.fg(color, line));
		}),
		boxTextLine(width, sparkleRow(innerWidth, SPARKLE_ROW_BOTTOM, sparkleMs)),
		boxCenteredLine(
			width,
			`${theme.fg("warning", "●")} ${theme.bold("OMK")}  / ${theme.fg("success", heroModelLabel(snapshot))}`,
		),
		boxCenteredLine(
			width,
			`${theme.fg("mdCode", "◇")} omk-control · ${theme.fg("accent", "route")} · ${theme.fg("warning", "verify")} · ${theme.fg("success", "loop")} · ${theme.fg("mdCode", "control")}`,
		),
		boxBottom(width),
	];
}

function heroModelLabel(snapshot: ControlPanelStatusSnapshot): string {
	if (!snapshot.modelId) return "no-model";
	const think = snapshot.thinkingLevel;
	return think && think !== "off" ? `${snapshot.modelId}:${think}` : snapshot.modelId;
}

function sidebarPanel(content: ControlPanelContent, width: number): string[] {
	const snapshot = statusSnapshot(content);
	const headroomLabel = snapshot.headroomStatus ?? snapshot.optimizerPolicy ?? "unknown";
	const mcpCount = snapshot.mcpCount;
	const skillCount = snapshot.skillCount;
	const packageIntakeLabel = packageIntakeStatusLabel(snapshot.packageIntake);
	const contextMeter = contextMeterLabel(snapshot);
	const activitySparkline = activitySparklineLabel(snapshot);
	return [
		sidebarTabs(width),
		boxCenteredLine(width, theme.bold(theme.fg("accent", "OMK://CONTROL"))),
		boxCenteredLine(width, theme.bold(theme.fg("warning", "CYBERPUNK OPS CORE"))),
		boxCenteredLine(width, `${theme.fg("mdCode", "MATRIX RAIN")} // ${theme.fg("success", "NEON GRID ONLINE")}`),
		boxCenteredLine(width, theme.fg("text", "NIGHT-CITY-MATRIX-V3")),
		sidebarRule(width, "STATUS", "accent"),
		boxTextLine(width, `${theme.fg("muted", "state:")} ${coloredStatus(snapshot.runtimeState ?? "unknown")}`),
		boxTextLine(width, `${theme.fg("muted", "route:")} ${coloredStatus(snapshot.routeState ?? "unknown")}`),
		boxTextLine(width, `${theme.fg("muted", "evidence:")} ${coloredStatus(snapshot.evidenceState ?? "unknown")}`),
		sidebarRule(width, "TODO", "accent"),
		...todoSidebarLines(snapshot.todoState, width),
		sidebarRule(width, "SESSION", "accent"),
		semanticBoxTextLine(width, "cwd", snapshot.cwdLabel ?? "?", "end"),
		semanticBoxTextLine(width, "git", snapshot.gitBranch ?? "?", "start"),
		sidebarRule(width, "MODEL / CTX", "accent"),
		semanticBoxTextLine(width, "model", modelStatusLabel(snapshot), "end"),
		semanticBoxTextLine(width, "think", snapshot.thinkingLevel ?? "off", "start"),
		boxTextLine(
			width,
			`${theme.fg("muted", "ctx:")} ${theme.fg(statusColor(snapshot.contextPercent === undefined || snapshot.contextPercent === null ? "unknown" : "ready"), contextStatusLabel(snapshot))}`,
		),
		boxTextLine(width, `${theme.fg("muted", "meter:")} ${contextMeter}`),
		boxTextLine(width, `${theme.fg("muted", "pulse:")} ${activitySparkline}`),
		sidebarRule(width, "RUNTIME / MCP / SKILLS", "accent"),
		semanticBoxTextLine(width, "headroom", headroomLabel, "end"),
		semanticBoxTextLine(width, "omk", snapshot.dagOrchestrationState ?? "unknown", "end"),
		semanticBoxTextLine(width, "sidebar", snapshot.sidebarState ?? "unknown", "start"),
		boxTextLine(width, `${theme.fg("muted", "res:")} MCP:${mcpCount ?? "?"} skills:${skillCount ?? "?"}`),
		semanticBoxTextLine(width, "pkg", packageIntakeLabel, "end"),
		sidebarRule(width, "CONTROL", "accent"),
		boxTextLine(width, `${theme.fg("muted", "route:")} ${coloredStatus(snapshot.routeState ?? "unknown")}`),
		boxTextLine(width, `${theme.fg("muted", "verify:")} ${coloredStatus(snapshot.evidenceState ?? "unknown")}`),
		boxTextLine(width, `${theme.fg("muted", "control:")} ${coloredStatus(snapshot.controlState ?? "unknown")}`),
		boxBottom(width, "accent"),
	];
}

function semanticBoxTextLine(
	width: number,
	label: string,
	value: string,
	preserve: "start" | "middle" | "end",
): string {
	const prefix = `${theme.fg("muted", `${label}:`)} `;
	const availableWidth = Math.max(0, width - 4 - visibleWidth(prefix));
	return boxTextLine(width, `${prefix}${semanticTruncate(value, availableWidth, preserve)}`);
}

function semanticTruncate(value: string, maxWidth: number, preserve: "start" | "middle" | "end"): string {
	if (visibleWidth(value) <= maxWidth) return value;
	if (maxWidth <= 0) return "";
	if (preserve === "start") return truncateToWidth(value, maxWidth, "…");
	const ellipsis = "…";
	const targetWidth = maxWidth - visibleWidth(ellipsis);
	if (targetWidth <= 0) return truncateToWidth(ellipsis, maxWidth, "");
	if (preserve === "middle") {
		const headWidth = Math.max(1, Math.floor(targetWidth / 2));
		const tailWidth = Math.max(1, targetWidth - headWidth);
		return `${takeStart(value, headWidth)}${ellipsis}${takeEnd(value, tailWidth)}`;
	}
	return `${ellipsis}${takeEnd(value, targetWidth)}`;
}

function takeStart(value: string, maxWidth: number): string {
	let prefix = "";
	for (const char of Array.from(value)) {
		if (visibleWidth(prefix + char) > maxWidth) break;
		prefix += char;
	}
	return prefix;
}

function takeEnd(value: string, maxWidth: number): string {
	let suffix = "";
	for (const char of Array.from(value).reverse()) {
		if (visibleWidth(char + suffix) > maxWidth) break;
		suffix = char + suffix;
	}
	return suffix;
}

function statusToken(label: string, value: string | undefined): string {
	const state = value ?? "unknown";
	return theme.fg(statusColor(state), `${label}:${state.toUpperCase()}`);
}

function coloredStatus(value: string): string {
	return theme.fg(statusColor(value), value);
}

function statusColor(value: string): ThemeColor {
	const normalized = value.toLowerCase();
	if (["ready", "on", "active", "available", "linked", "tracking", "pinned"].includes(normalized)) return "success";
	if (["degraded", "limited", "blocked", "off"].includes(normalized)) return "warning";
	return "muted";
}

function todoSidebarLines(state: TodoState | undefined, width: number): string[] {
	if (!state || state.items.length === 0) {
		return [
			boxTextLine(width, `${theme.fg("muted", "todo:")} empty`),
			boxTextLine(width, `${theme.fg("muted", "next:")} no active todos`),
		];
	}
	const counts = todoSummary(state);
	const next = nextActiveTodo(state);
	return [
		boxTextLine(width, `${theme.fg("muted", "todo:")} ${counts.done}/${counts.total} done`),
		semanticBoxTextLine(width, "next", next?.label ?? "complete", "middle"),
	];
}

function packageIntakeStatusLabel(summary: PiPackageIntakeSummary | undefined): string {
	if (!summary) return "ports:pending";
	const ready = summary.acceptedNative + summary.acceptedReference + summary.acceptedMeasurement;
	const review = summary.deferred + summary.reject;
	return `ports:${ready}/${summary.total} review:${review} block:${summary.hardForkBlocked}`;
}

function renderExpanded(content: ControlPanelContent, width: number, bannerFrame?: string[], sparkleMs = 0): string[] {
	if (width >= CONTROL_PANEL_DECK_MIN_WIDTH) {
		const { leftWidth, sidebarWidth } = deckWidths(width);
		const resourceLines = ["", ...content.onboarding().split("\n")];
		const rightRail = blankSidebarRail(sidebarWidth, resourceLines.length);
		const lines = [...renderDeck(content, width, bannerFrame, sparkleMs)];
		lines.push(...composeColumns(resourceLines, leftWidth, rightRail, sidebarWidth, CONTROL_PANEL_GAP_WIDTH, width));
		return lines;
	}

	const lines = [divider(width, "OMK//CONTROL PANEL", "accent"), statusLine(content, width)];
	if (width >= 32) lines.push(...brandLines(content, width, bannerFrame));
	lines.push(divider(width, "SYSTEM MAP", "mdHeading"));
	for (const instruction of content.expandedInstructions().split("\n")) lines.push(textLine(width, instruction));
	lines.push(divider(width, "STARTUP LINK", "success"));
	for (const onboardingLine of content.onboarding().split("\n")) lines.push(textLine(width, onboardingLine, "dim"));
	lines.push(divider(width, "END", "borderMuted"));
	return lines;
}

function blankSidebarRail(width: number, lineCount: number): string[] {
	return Array.from({ length: lineCount }, () => boxTextLine(width, ""));
}

function statusSnapshot(content: ControlPanelContent): ControlPanelStatusSnapshot {
	return content.statusSnapshot?.() ?? {};
}

function modelStatusLabel(snapshot: ControlPanelStatusSnapshot): string {
	if (!snapshot.modelId) return "no-model";
	return snapshot.modelProvider ? `${snapshot.modelProvider}/${snapshot.modelId}` : snapshot.modelId;
}

function contextStatusLabel(snapshot: ControlPanelStatusSnapshot): string {
	const windowTokens = snapshot.contextWindowTokens ?? 0;
	const windowLabel = windowTokens > 0 ? formatTokens(windowTokens) : "?";
	return snapshot.contextPercent === null || snapshot.contextPercent === undefined
		? `?/${windowLabel}`
		: `${snapshot.contextPercent.toFixed(1)}%/${windowLabel}`;
}

function contextMeterLabel(snapshot: ControlPanelStatusSnapshot): string {
	const percent = normalizePercent(snapshot.contextPercent);
	if (percent === undefined) {
		return `${theme.fg("borderMuted", "░".repeat(CONTEXT_METER_CELLS))} ${theme.fg("muted", "??%")}`;
	}
	const filled = Math.max(0, Math.min(CONTEXT_METER_CELLS, Math.round((percent / 100) * CONTEXT_METER_CELLS)));
	const color: ThemeColor = percent >= 85 ? "warning" : percent >= 65 ? "mdCode" : "success";
	return `${theme.fg(color, "█".repeat(filled))}${theme.fg("borderMuted", "░".repeat(CONTEXT_METER_CELLS - filled))} ${theme.fg(color, `${Math.round(percent)}%`)}`;
}

function activitySparklineLabel(snapshot: ControlPanelStatusSnapshot): string {
	const seed = hashSnapshot(snapshot);
	const glyphs = Array.from(SPARKLINE_GLYPHS);
	const parts: string[] = [];
	for (let index = 0; index < SPARKLINE_WIDTH; index++) {
		const glyph = glyphs[(seed + index * 5 + index * index) % glyphs.length] ?? "▁";
		const color: ThemeColor = index % 5 === 0 ? "accent" : index % 3 === 0 ? "warning" : "success";
		parts.push(theme.fg(color, glyph));
	}
	return parts.join("");
}

function normalizePercent(value: number | null | undefined): number | undefined {
	if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
	if (value < 0) return 0;
	if (value > 100) return 100;
	return value;
}

function hashSnapshot(snapshot: ControlPanelStatusSnapshot): number {
	const source = [
		snapshot.modelProvider,
		snapshot.modelId,
		snapshot.contextPercent?.toFixed(1),
		snapshot.contextTokens,
		snapshot.contextWindowTokens,
		snapshot.cwdLabel,
		snapshot.gitBranch,
	].join("|");
	let hash = 2166136261;
	for (let index = 0; index < source.length; index++) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
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

function controlStripLine(content: ControlPanelContent, width: number): string {
	return centerLine(
		width,
		`${theme.bold(theme.fg("accent", "OMK://CONTROL READ"))} ${theme.fg("accent", "route/verify/loop/control")} · ${content.compactInstructions()}`,
	);
}

function brandLines(content: ControlPanelContent, width: number, bannerFrame?: string[]): string[] {
	const art = bannerFrame ?? CONTROL_PANEL_ASCII_ART;
	if (bannerFrame) return art.map((line) => textLine(width, line));
	const leftWidth = Math.max(...art.map((line) => visibleWidth(line)));
	const minWideWidth = visibleWidth("| ") + leftWidth + visibleWidth(" | ") + META_WIDTH;
	if (width < minWideWidth) return art.map((line) => textLine(width, theme.fg("accent", line)));
	const snapshot = statusSnapshot(content);
	return art.map((line, index) =>
		textLine(
			width,
			`${fitLine(theme.fg("accent", line), leftWidth)}${theme.fg("borderMuted", " | ")}${metadataLines(snapshot)[index] ?? ""}`,
		),
	);
}

function metadataLines(snapshot: ControlPanelStatusSnapshot): string[] {
	const rawThemeName = theme.name ?? "live";
	const themeName = (rawThemeName.startsWith("omk-") ? rawThemeName.slice(4) : rawThemeName).toUpperCase();
	return [
		`${theme.fg("mdCode", "PANEL")} ${coloredStatus(snapshot.runtimeState ?? "unknown")}`,
		`${theme.fg("mdCode", "THEME")} ${theme.fg("accent", themeName)}`,
		`${theme.fg("mdCode", "STARTUP")} ${coloredStatus(snapshot.startupState ?? "unknown")}`,
		`${theme.fg("mdCode", "LINK")} ${coloredStatus(snapshot.linkState ?? "unknown")}`,
	];
}

function statusLine(content: ControlPanelContent, width: number): string {
	const snapshot = statusSnapshot(content);
	const segments = [
		theme.bold(theme.fg("accent", `${content.appName.toUpperCase()} v${content.version}`)),
		statusToken("CORE", snapshot.runtimeState),
		statusToken("ANSI", snapshot.ansiColorState),
		statusToken("STARTUP", snapshot.startupState),
		statusToken("LINK", snapshot.linkState),
		theme.fg("muted", "THEME:LIVE"),
	];
	return textLine(width, segments.join(theme.fg("borderMuted", " | ")));
}
