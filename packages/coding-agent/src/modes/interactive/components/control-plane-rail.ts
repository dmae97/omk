import { singleLineDisplayText } from "../../../utils/display-text.ts";
import {
	type AuthorityCell,
	authorityStyle,
	authorityText,
	type ContextView,
	type ControlPlaneViewModel,
} from "../control-plane-view-model.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { boxTextLine, labelCell, semanticBoxTextLine, sidebarRule } from "./control-panel-box.ts";
import { formatBytes, formatTokens } from "./footer.ts";

/**
 * Where a rail renders. The startup deck column is part of the header, which scrolls into
 * immutable terminal scrollback: any change there after it leaves the viewport forces a full
 * repaint, so the header shows only turn-stable rows at a fixed height. The control-pane overlay
 * is anchored to the viewport and adds the live rows (queue, failure card, host CPU, RSS).
 */
export type RailSurface = "header" | "overlay";

/**
 * Descriptive (non-authority) inputs of the rail sections. `ControlPanelStatusSnapshot`
 * satisfies this structurally, so this module never imports the layout module.
 */
export interface ControlRailDescriptors {
	readonly modelId?: string;
	readonly modelProvider?: string;
	readonly thinkingLevel?: string;
	readonly headroomStatus?: string;
	readonly optimizerPolicy?: string;
	readonly mcpCount?: number;
	readonly skillCount?: number;
}

// Per-section label gutters sized to each section's longest label ("effects"/"verdict", "model", "cpu").
const STATUS_COLUMN = 7;
const CONTEXT_COLUMN = 5;
const RESOURCES_COLUMN = 3;
const CONTEXT_METER_CELLS = 12;

/** A status row: glyph + text from the view model, colour only from `authorityStyle`. */
function authorityRow(
	width: number,
	label: string,
	column: number,
	cell: AuthorityCell,
	text: string = authorityText(cell),
): string {
	return semanticBoxTextLine(width, label, text, "start", column, authorityStyle(cell.state).color);
}

/**
 * Percent figure truncated toward zero at display precision, so a shown number never reaches a
 * threshold before the state does (69.96% reads 69.9%, never 70.0%).
 */
function floorPercent(percent: number, decimals: 0 | 1): string {
	return decimals === 0 ? String(Math.floor(percent)) : (Math.floor(percent * 10) / 10).toFixed(1);
}

/**
 * RUN state on every surface. The queue changes mid-turn and the failure card changes the rail height,
 * so only the overlay shows them.
 */
export function runRailLines(vm: ControlPlaneViewModel, width: number, surface: RailSurface): string[] {
	const { run } = vm;
	const lines = [sidebarRule(width, "RUN"), authorityRow(width, "state", STATUS_COLUMN, run)];
	if (surface === "header") return lines;
	lines.push(
		semanticBoxTextLine(width, "queue", run.queued === null ? "?" : String(run.queued), "start", STATUS_COLUMN),
	);
	const failure = run.failure;
	if (failure === null) return lines;
	return [
		...lines,
		semanticBoxTextLine(width, "cause", failure.causeCode, "middle", STATUS_COLUMN),
		semanticBoxTextLine(width, "phase", failure.phase, "start", STATUS_COLUMN),
		semanticBoxTextLine(width, "effects", failure.sideEffects, "start", STATUS_COLUMN),
		semanticBoxTextLine(width, "retry", failure.retry, "start", STATUS_COLUMN),
		semanticBoxTextLine(width, "next", failure.nextAction, "start", STATUS_COLUMN),
	];
}

/** The only evidence row in the rail. */
export function verifyRailLines(vm: ControlPlaneViewModel, width: number): string[] {
	return [sidebarRule(width, "VERIFY"), authorityRow(width, "verdict", STATUS_COLUMN, vm.verify)];
}

export function contextRailLines(
	vm: ControlPlaneViewModel,
	descriptors: ControlRailDescriptors,
	width: number,
): string[] {
	const { context } = vm;
	const optimizer = descriptors.headroomStatus ?? descriptors.optimizerPolicy ?? "unknown";
	return [
		sidebarRule(width, "CONTEXT"),
		semanticBoxTextLine(width, "model", modelLabel(descriptors), "end", CONTEXT_COLUMN),
		semanticBoxTextLine(width, "think", descriptors.thinkingLevel ?? "off", "start", CONTEXT_COLUMN),
		authorityRow(width, "ctx", CONTEXT_COLUMN, context, `${authorityText(context)} ${contextUsageLabel(context)}`),
		boxTextLine(width, `${labelCell("meter", CONTEXT_COLUMN)} ${contextMeter(context)}`),
		semanticBoxTextLine(width, "opt", optimizer, "end", CONTEXT_COLUMN),
	];
}

/** Governor mode and inventory on every surface; host CPU and process RSS move every metrics tick (overlay only). */
export function resourceRailLines(
	vm: ControlPlaneViewModel,
	descriptors: ControlRailDescriptors,
	width: number,
	surface: RailSurface,
): string[] {
	const { resources } = vm;
	// Configured inventory counts, not health: rendered in the neutral text colour.
	const inventory = `MCP:${descriptors.mcpCount ?? "?"} skills:${descriptors.skillCount ?? "?"}`;
	const stable = [
		semanticBoxTextLine(width, "gov", resources.governorMode ?? "?", "start", RESOURCES_COLUMN),
		semanticBoxTextLine(width, "ext", inventory, "start", RESOURCES_COLUMN),
	];
	if (surface === "header") return [sidebarRule(width, "RESOURCES"), ...stable];
	const cpu = resources.systemCpuPercent === null ? "" : ` ${floorPercent(resources.systemCpuPercent, 0)}%`;
	const rss = resources.memoryRssBytes === null ? "?" : formatBytes(resources.memoryRssBytes);
	return [
		sidebarRule(width, "RESOURCES"),
		authorityRow(width, "cpu", RESOURCES_COLUMN, resources, `${authorityText(resources)}${cpu}`),
		semanticBoxTextLine(width, "rss", rss, "start", RESOURCES_COLUMN),
		...stable,
	];
}

// Header tokens: the hero strip, the compact line and the expanded metadata render these beside or
// instead of the rail, so they share its sanitizing and its single authority mapping.

/** `VERIFY glyph verdict` for header lines; the verdict carries its authority colour and glyph. */
export function verifyToken(vm: ControlPlaneViewModel, labelColor: ThemeColor, uppercase = false): string {
	const text = authorityText(vm.verify);
	const value = theme.fg(authorityStyle(vm.verify.state).color, uppercase ? text.toUpperCase() : text);
	return `${theme.fg(labelColor, "VERIFY")} ${value}`;
}

/** `provider/model` as one printable line: model ids come from provider catalogs and user config. */
export function modelLabel(descriptors: ControlRailDescriptors): string {
	const id = singleLineDisplayText(descriptors.modelId ?? "");
	if (!id) return "no-model";
	const provider = singleLineDisplayText(descriptors.modelProvider ?? "");
	return provider ? `${provider}/${id}` : id;
}

/** Hero MODEL label `model[:think]`, reduced to one printable line like every model-derived value. */
export function heroModelLabel(descriptors: ControlRailDescriptors): string {
	const model = singleLineDisplayText(descriptors.modelId ?? "");
	const think = singleLineDisplayText(descriptors.thinkingLevel ?? "off");
	if (!model) return "no-model";
	return think && think !== "off" ? `${model}:${think}` : model;
}

/**
 * `THEME <NAME>`: terminal setup, not authority state, so a neutral colour.
 * Custom themes load from user files, so the theme name is sanitized like any file-system text.
 */
export function themeToken(labelColor: ThemeColor): string {
	const themeName = singleLineDisplayText(theme.name ?? "?")
		.replace(/^omk-/, "")
		.toUpperCase();
	return `${theme.fg(labelColor, "THEME")} ${theme.fg("text", themeName)}`;
}

/** `THEME <NAME>` and `ANSI <ON|OFF>`: the hero meta row's terminal setup. */
export function terminalSetupTokens(ansiColorState: string | undefined, labelColor: ThemeColor): string[] {
	return [
		themeToken(labelColor),
		`${theme.fg(labelColor, "ANSI")} ${theme.fg("text", (ansiColorState ?? "?").toUpperCase())}`,
	];
}

function contextUsageLabel(context: ContextView): string {
	const percent = context.percent === null ? "?" : `${floorPercent(context.percent, 1)}%`;
	const window = context.windowTokens > 0 ? formatTokens(context.windowTokens) : "?";
	return `${percent}/${window}`;
}

/** 12-cell usage bar; fill and figure share the context authority colour. */
function contextMeter(context: ContextView): string {
	const color = authorityStyle(context.state).color;
	const percent = context.percent;
	const filled = percent === null ? 0 : Math.round((percent / 100) * CONTEXT_METER_CELLS);
	const figure = percent === null ? "??%" : `${floorPercent(percent, 0)}%`;
	const bar = `${theme.fg(color, "█".repeat(filled))}${theme.fg("borderMuted", "░".repeat(CONTEXT_METER_CELLS - filled))}`;
	return `${bar} ${theme.fg(color, figure)}`;
}
