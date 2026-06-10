/**
 * OMK Theme — Layout primitives (headers, panels, boxes, gauges)
 * Extracted from util/theme.ts to break God Module coupling
 */

import { P, BRAND_HEX, setBrandPaletteTheme } from "../brand/palette.js";
import { getActiveBrandHudStatus, getActiveBrandThemeName } from "../brand/theme-compiled.js";
import { esc, rgb, stripAnsi, sanitizeTerminalText, visibleTerminalWidth } from "./ansi.js";
import { style } from "./colors.js";
import { renderOmkSparkleText } from "../ui/omk-sigil.js";

export function header(text: string): string {
  return [
    "",
    style.phosphorDim("╔" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╗"),
    style.phosphorDim("║") + "  " + style.phosphorBold(text) + "  " + style.phosphorDim("║"),
    style.phosphorDim("╚" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╝"),
    "",
  ].join("\n");
}

export function subheader(text: string): string {
  return style.purpleBold("▸ " + text);
}

export function separator(width = 50): string {
  return style.gray("─".repeat(width));
}

export function bullet(text: string, color: "purple" | "pink" | "mint" | "blue" | "skin" = "purple"): string {
  const colors = { purple: style.purple, pink: style.pink, mint: style.mint, blue: style.blue, skin: style.skin };
  return "  " + colors[color]("◆") + " " + text;
}

export function label(key: string, value: string): string {
  return "  " + style.gray(sanitizeTerminalText(key) + ":") + " " + style.cream(sanitizeTerminalText(value));
}

export function box(lines: string[], title?: string): string {
  const termWidth = process.stdout.columns || 80;
  const rawTitle = title ? sanitizeTerminalText(title) : "";
  const rawTitleWidth = rawTitle ? visibleTerminalWidth(rawTitle) : 0;
  // Strip each line once and reuse its visible width for both the inner-width
  // calculation and right-padding. This removes the redundant second strip that
  // padEndAnsi() performed internally. Output bytes are identical:
  // padEndAnsi(l, innerWidth) === l + " ".repeat(max(0, innerWidth - strip(l))).
  const measured = lines.map((l) => ({ line: l, width: stripAnsi(l).length }));
  const rawInner = Math.max(
    ...measured.map((m) => m.width),
    rawTitle ? rawTitleWidth + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const titleText = rawTitle ? style.phosphorBold(rawTitle) : "";
  const top = rawTitle
    ? style.phosphorDim("╔" + "═".repeat(2) + " ") + titleText + style.phosphorDim(" " + "═".repeat(Math.max(0, width - rawTitleWidth - 6)) + "╗")
    : style.phosphorDim("╔" + "═".repeat(width) + "╗");
  const bottom = style.phosphorDim("╚" + "═".repeat(width) + "╝");
  const body = measured.map(({ line, width: w }) =>
    style.phosphorDim("║ ") + line + " ".repeat(Math.max(0, innerWidth - w)) + style.phosphorDim(" ║")
  );
  return [top, ...body, bottom].join("\n");
}

/** Generate OMK neon gradient text */
export function gradient(text: string): string {
  const chars = [...sanitizeTerminalText(text)];
  const stops = [P.blue, P.purple, P.pink, P.orange, P.mint];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const segment = t * (stops.length - 1);
    const startIndex = Math.min(stops.length - 2, Math.floor(segment));
    const endIndex = Math.min(stops.length - 1, startIndex + 1);
    const localT = segment - startIndex;
    const start = stops[startIndex] ?? P.blue;
    const end = stops[endIndex] ?? P.mint;
    const r = Math.round(start.r + (end.r - start.r) * localT);
    const g = Math.round(start.g + (end.g - start.g) * localT);
    const b = Math.round(start.b + (end.b - start.b) * localT);
    result.push(esc(rgb(r, g, b)) + chars[i] + esc("0"));
  }
  return result.join("");
}

/** Render a horizontal gauge bar */
export function gauge(
  label: string,
  value: number,
  max: number,
  width = 24
): string {
  const ratio = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let barColor = rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b);
  if (ratio > 0.7) barColor = rgb(P.metricsAmber.r, P.metricsAmber.g, P.metricsAmber.b);
  if (ratio > 0.9) barColor = rgb(P.metricsRed.r, P.metricsRed.g, P.metricsRed.b);

  const bar = esc(barColor) + "█".repeat(filled) + esc("0") + style.phosphorDim("░".repeat(empty));
  const pct = style.phosphorBold(`${Math.round(ratio * 100)}%`.padStart(4));
  return `  ${style.gray(label.padStart(10))} ${bar} ${pct}`;
}

/** Matrix green bordered panel with phosphor glow */
export function panel(lines: string[], title?: string): string {
  const termWidth = process.stdout.columns || 80;
  const rawTitle = title ? sanitizeTerminalText(title) : "";
  const rawTitleWidth = rawTitle ? visibleTerminalWidth(rawTitle) : 0;
  // Same single-strip optimization as box(): measure each line once and reuse
  // the visible width for inner-width + padding (byte-identical to padEndAnsi).
  const measured = lines.map((l) => ({ line: l, width: stripAnsi(l).length }));
  const rawInner = Math.max(...measured.map((m) => m.width), rawTitle ? rawTitleWidth + 4 : 0);
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const titleText = rawTitle ? gradient(rawTitle) : "";
  const top = rawTitle
    ? style.phosphorDim("┏" + "━".repeat(2) + " ") + titleText + style.phosphorDim(" " + "━".repeat(Math.max(0, width - rawTitleWidth - 6)) + "┓")
    : style.phosphorDim("┏" + "━".repeat(width) + "┓");
  const bottom = style.phosphorDim("┗" + "━".repeat(width) + "┛");
  const body = measured.map(({ line, width: w }) =>
    style.phosphorDim("┃ ") + line + " ".repeat(Math.max(0, innerWidth - w)) + style.phosphorDim(" ┃")
  );
  return [top, ...body, bottom].join("\n");
}

/** Control-room header */
export function sparkleHeader(text: string): string {
  const deco = "◈ ◆ ◈";
  const total = text.length + deco.length + 4;
  const line = "═".repeat(Math.min(total, 60));
  return [
    "",
    style.lightPurple(line),
    "  " + style.pinkBold(text) + "  " + style.purple(deco),
    style.lightPurple(line),
    "",
  ].join("\n");
}

/** Matrix-style OMK header */
export function matrixHeader(text: string): string {
  const safeText = sanitizeTerminalText(text);
  return [
    "",
    style.phosphorBold(safeText),
    style.phosphorDim("═".repeat(Math.min(visibleTerminalWidth(safeText), 56))),
    "",
  ].join("\n");
}

/** Compact HUD masthead for root entry and non-interactive HUD command output. */
export function omkHudHeader(runId?: string): string {
  if (process.env.OMK_THEME !== undefined) {
    setBrandPaletteTheme(process.env.OMK_THEME);
  }
  const safeRun = runId ? sanitizeTerminalText(runId).slice(0, 28) : "latest run";
  const signalRule = gradient("═◇═".repeat(18).slice(0, 54));
  const chromeLine = getActiveBrandThemeName() === "rust-forge"
    ? style.phosphorBold(getActiveBrandHudStatus()) + style.gray(" · ") + style.mintBold("ROUTE VERIFY") + style.gray(" · ") + style.pinkBold("CONTROL LOOP")
    : style.phosphorBold("NEON GRID ONLINE") + style.gray(" · ") + style.mintBold("GREEN RAIN SIGNAL") + style.gray(" · ") + style.pinkBold("METRICS WALL");
  return [
    "",
    renderOmkSparkleText("◢█ OMK//CONTROL █◣", {
      colors: [
        BRAND_HEX.cyan,
        BRAND_HEX.sparkleWhite,
        BRAND_HEX.sparkleGold,
        BRAND_HEX.magenta,
        BRAND_HEX.mint,
      ],
    }),
    chromeLine,
    style.gray("Models execute. OMK routes, verifies, measures, and controls."),
    style.gray("goal-scoped MCP · skills · hooks · evidence · worktrees · replay · memory"),
    style.gray(`run: ${safeRun}`),
    signalRule,
    "",
  ].join("\n");
}

/** Single stat line: label + value + optional unit */
export function stat(label: string, value: string, unit = ""): string {
  return "  " + style.phosphorDim(label + ":") + " " + style.phosphorBold(value) + style.phosphorDim(unit);
}
