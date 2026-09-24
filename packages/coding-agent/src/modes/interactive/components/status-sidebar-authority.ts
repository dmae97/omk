import { truncateToWidth } from "omk-tui";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import {
	authorityStyle,
	authorityText,
	type ContextView,
	type ControlPlaneViewModel,
	type FailureCard,
} from "../control-plane-view-model.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { boxTextLine } from "./control-panel-box.ts";
import { formatTokens } from "./footer.ts";

/** Frame (`│ ` + ` │`) plus the 5-column label gutter shared with the `cwd  `/`git  ` rows. */
const ROW_CHROME = 4 + 5;
const METER_MIN_CELLS = 12;
const METER_MAX_CELLS = 24;

/**
 * `label value` row; the value is reduced to one printable line, then ellipsized to the rail width.
 * `nextAction` can be restored from the on-disk run journal, whose validator rejects NUL, empty or
 * over-long messages and credential-shaped literals, but not ESC, other controls or bidi overrides.
 */
function row(width: number, label: string, value: string, color: ThemeColor): string {
	const fitted = truncateToWidth(singleLineDisplayText(value), Math.max(0, width - ROW_CHROME), "…");
	return boxTextLine(width, `${theme.fg("muted", label)}${theme.fg(color, fitted)}`);
}

/** RUN and VERIFY (the sidebar's only evidence row): glyph + text from the view model, colour from `authorityStyle`. */
export function sidebarAuthorityRows(width: number, vm: ControlPlaneViewModel): string[] {
	return [
		row(width, "run  ", authorityText(vm.run), authorityStyle(vm.run.state).color),
		row(width, "vrfy ", authorityText(vm.verify), authorityStyle(vm.verify.state).color),
	];
}

/**
 * Failure essentials of a settled, non-completed turn. The pinned sidebar hides the
 * control-pane overlay, so it carries cause, retry policy, side effects and next action itself.
 */
export function sidebarFailureRows(width: number, failure: FailureCard | null): string[] {
	if (failure === null) return [];
	return [
		row(width, "why  ", failure.causeCode, "text"),
		row(width, "rtry ", `${failure.retry} · fx ${failure.sideEffects}`, "text"),
		row(width, "next ", failure.nextAction, "text"),
	];
}

/** `ctx  <glyph> <percent>/<window>` plus the usage meter, both painted in the context pressure colour. */
export function sidebarContextRows(width: number, context: ContextView, autoCompact: boolean): string[] {
	const style = authorityStyle(context.state);
	const windowText = `${formatTokens(context.windowTokens)}${autoCompact ? " (auto)" : ""}`;
	// Floored, so the figure never reads a threshold (70.0%) before the pressure state does.
	const usage =
		context.percent === null
			? `?/${windowText}`
			: `${(Math.floor(context.percent * 10) / 10).toFixed(1)}%/${windowText}`;
	return [row(width, "ctx  ", `${style.glyph} ${usage}`, style.color), boxTextLine(width, meter(context, width))];
}

function meter(context: ContextView, width: number): string {
	// Fill the rail: frame (4) + space + up to "100%" (4) stay reserved.
	const cells = Math.max(METER_MIN_CELLS, Math.min(METER_MAX_CELLS, width - 9));
	const color = authorityStyle(context.state).color;
	if (context.percent === null) {
		return `${theme.fg("borderMuted", "░".repeat(cells))} ${theme.fg(color, "??%")}`;
	}
	const clamped = Math.max(0, Math.min(100, context.percent));
	const filled = Math.round((clamped / 100) * cells);
	return `${theme.fg(color, "█".repeat(filled))}${theme.fg("borderMuted", "░".repeat(cells - filled))} ${theme.fg(color, `${Math.floor(clamped)}%`)}`;
}
