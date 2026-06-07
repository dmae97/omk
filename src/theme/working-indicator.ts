/**
 * OMK Theme — Working Indicator
 *
 * Gradient-animated "working..." status line that shows current
 * activity with color-cycling gradient effect. Integrates with
 * theme motion settings (spinner type, rain).
 */

import { P } from "../brand/palette.js";
import { esc, rgb, sanitizeTerminalText, visibleTerminalWidth } from "./ansi.js";
import { style } from "./colors.js";

export type WorkingSpinner = "braille" | "scanline" | "dots" | "matrix";

export interface WorkingPhase {
  /** Current work phase label (e.g., "planning", "executing", "reviewing") */
  phase: string;
  /** What's being done right now (e.g., "routing agent tasks", "running parallel workers") */
  detail: string;
  /** Tick counter for animation (increment each frame) */
  tick: number;
}

const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SCANLINE_SPINNER = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂", "▁", " "];
const DOTS_SPINNER = ["·  ", "·· ", "···", " ··", "  ·", "   "];
const MATRIX_CHARS = "ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789";

function getSpinnerFrame(spinner: WorkingSpinner, tick: number): string {
  switch (spinner) {
    case "braille":
      return BRAILLE_SPINNER[tick % BRAILLE_SPINNER.length] ?? "⠋";
    case "scanline":
      return SCANLINE_SPINNER[tick % SCANLINE_SPINNER.length] ?? "▄";
    case "dots":
      return DOTS_SPINNER[tick % DOTS_SPINNER.length] ?? "·";
    case "matrix":
      return MATRIX_CHARS[tick % MATRIX_CHARS.length] ?? "0";
    default:
      return BRAILLE_SPINNER[tick % BRAILLE_SPINNER.length] ?? "⠋";
  }
}

/**
 * Build a gradient color for a character at a given position,
 * cycling through the OMK neon palette based on tick offset.
 *
 * The gradient sweeps through: blue → purple → pink → orange → mint
 * and shifts each frame (tick-based offset) to create a flowing glow.
 */
function gradientChar(
  char: string,
  index: number,
  total: number,
  tickOffset: number,
): string {
  const stops = [P.blue, P.purple, P.pink, P.orange, P.mint];

  if (total <= 1) {
    const stopIdx = tickOffset % stops.length;
    const c = stops[stopIdx] ?? P.mint;
    return esc(rgb(c.r, c.g, c.b)) + char + esc("0");
  }

  // Normalized position [0, 1] with frame-based shift
  const shiftedT = (index / (total - 1) + tickOffset * 0.07) % 1.0;
  const segment = shiftedT * (stops.length - 1);
  const startIdx = Math.min(stops.length - 2, Math.floor(segment));
  const endIdx = Math.min(stops.length - 1, startIdx + 1);
  const localT = segment - startIdx;

  const start = stops[startIdx] ?? P.blue;
  const end = stops[endIdx] ?? P.mint;

  const r = Math.round(start.r + (end.r - start.r) * localT);
  const g = Math.round(start.g + (end.g - start.g) * localT);
  const b = Math.round(start.b + (end.b - start.b) * localT);

  return esc(rgb(r, g, b)) + char + esc("0");
}

/**
 * Render a single gradient sweep across a text label.
 * The gradient cycles through neon colors with a flowing motion effect.
 */
function gradientFlow(text: string, tick: number): string {
  const chars = [...sanitizeTerminalText(text)];
  return chars.map((ch, i) => gradientChar(ch, i, chars.length, tick)).join("");
}

/**
 * Render the working indicator line.
 *
 * Shows: `[spinner] working... ▸ gradient(phase) · detail`
 * The "working..." prefix gets a flowing gradient, the phase gets
 * a bold gradient sweep, and the detail is muted.
 *
 * @param phase - Current work phase info
 * @param spinner - Spinner animation type
 * @returns Rendered ANSI line
 */
export function renderWorkingIndicator(
  phase: WorkingPhase | null,
  spinner: WorkingSpinner = "braille",
): string {
  if (!phase) {
    // Idle state — subtle dim indicator
    return (
      style.gray("  ") +
      style.dim + "idle" + style.reset +
      style.gray(" · ") +
      style.dim + "awaiting route" + style.reset
    );
  }

  const spinnerChar = getSpinnerFrame(spinner, phase.tick);
  const spinnerStyled = style.mintBold(spinnerChar);

  const prefix = gradientFlow("working", phase.tick);
  const connector = style.gray(" ▸ ");
  const phaseText = gradientFlow(phase.phase, phase.tick + 3);
  const detailText = style.phosphorDim(" · " + sanitizeTerminalText(phase.detail));

  return (
    style.gray("  ") +
    spinnerStyled +
    " " +
    prefix +
    connector +
    phaseText +
    detailText
  );
}

/**
 * Render a more compact single-line working indicator suitable
 * for status lines with limited width.
 */
export function renderCompactWorking(
  phase: WorkingPhase | null,
  spinner: WorkingSpinner = "braille",
  maxWidth = 40,
): string {
  if (!phase) {
    return style.dim + "○ idle" + style.reset;
  }

  const spinnerChar = getSpinnerFrame(spinner, phase.tick);
  const phaseShort = sanitizeTerminalText(phase.phase).slice(0, 12);
  const phaseStyled = style.phosphorBold(phaseShort);

  let result = style.mintBold(spinnerChar) + " " + gradientFlow(phaseShort, phase.tick);
  if (visibleTerminalWidth(result) > maxWidth) {
    result = style.mintBold(spinnerChar) + " " + phaseStyled;
  }
  return result;
}

/**
 * Render a multi-line working panel with gradient header,
 * phase description, elapsed time, and spinner.
 */
export function renderWorkingPanel(
  phase: WorkingPhase | null,
  spinner: WorkingSpinner = "braille",
  elapsedSeconds = 0,
): string {
  if (!phase) {
    return "";
  }

  const spinnerChar = getSpinnerFrame(spinner, phase.tick);
  const phaseGradient = gradientFlow(phase.phase.toUpperCase(), phase.tick);
  const detail = sanitizeTerminalText(phase.detail);
  const elapsed = formatElapsedCompact(elapsedSeconds);

  const lines = [
    gradientFlow("working...", phase.tick) + " " + style.mintBold(spinnerChar),
    phaseGradient,
    style.phosphorDim(detail),
    style.gray(`elapsed ${elapsed}`),
  ];

  // Build a tight phosphor-bordered panel
  const width = Math.max(...lines.map((l) => visibleTerminalWidth(l))) + 2;
  const top = style.phosphorDim("┌─" + "─".repeat(width) + "─┐");
  const bottom = style.phosphorDim("└─" + "─".repeat(width) + "─┘");
  const body = lines.map(
    (l) => style.phosphorDim("│ ") + l + " ".repeat(Math.max(0, width - visibleTerminalWidth(l))) + style.phosphorDim(" │"),
  );

  return [top, ...body, bottom].join("\n");
}

function formatElapsedCompact(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
