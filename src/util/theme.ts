/**
 * OMK Brand Theme — Open Multi-agent Kit CLI color system
 * HUD-ready: gradients, gauges, panels, sparkles ✨
 */

import { totalmem, freemem, loadavg, cpus } from "os";
import { P, hexToRgb, colorFromHex } from "../brand/palette.js";
import { OMK_MATRIX_ASCII_ART } from "../brand/omk-matrix-art.js";

// ── True-color ANSI helpers ──────────────────────────────────
const colorEnabled = process.env.FORCE_COLOR === "1"
  || process.env.FORCE_COLOR === "true"
  || (
    process.env.NO_COLOR === undefined
    && process.env.TERM !== "dumb"
    && Boolean(process.stdout.isTTY)
  );
const esc = (codes: string) => colorEnabled ? `\x1b[${codes}m` : "";
const rgb = (r: number, g: number, b: number) => `38;2;${r};${g};${b}`;
const bgRgb = (r: number, g: number, b: number) => `48;2;${r};${g};${b}`;

// ── Style builders ───────────────────────────────────────────
export const style = {
  reset: esc("0"),
  bold: esc("1"),
  dim: esc("2"),
  italic: esc("3"),
  underline: esc("4"),

  // Brand colors
  purple: (s: string) => esc(rgb(P.purple.r, P.purple.g, P.purple.b)) + s + esc("0"),
  lightPurple: (s: string) => esc(rgb(P.lightPurple.r, P.lightPurple.g, P.lightPurple.b)) + s + esc("0"),
  darkPurple: (s: string) => esc(rgb(P.darkPurple.r, P.darkPurple.g, P.darkPurple.b)) + s + esc("0"),
  pink: (s: string) => esc(rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  hotPink: (s: string) => esc(rgb(P.hotPink.r, P.hotPink.g, P.hotPink.b)) + s + esc("0"),
  mint: (s: string) => esc(rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  darkMint: (s: string) => esc(rgb(P.darkMint.r, P.darkMint.g, P.darkMint.b)) + s + esc("0"),
  orange: (s: string) => esc(rgb(P.orange.r, P.orange.g, P.orange.b)) + s + esc("0"),
  red: (s: string) => esc(rgb(P.red.r, P.red.g, P.red.b)) + s + esc("0"),
  blue: (s: string) => esc(rgb(P.blue.r, P.blue.g, P.blue.b)) + s + esc("0"),
  cream: (s: string) => esc(rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),
  gray: (s: string) => esc(rgb(P.gray.r, P.gray.g, P.gray.b)) + s + esc("0"),
  skin: (s: string) => esc(rgb(P.skin.r, P.skin.g, P.skin.b)) + s + esc("0"),
  matrixGreen: (s: string) => esc(rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b)) + s + esc("0"),
  matrixDark: (s: string) => esc(rgb(P.matrixDark.r, P.matrixDark.g, P.matrixDark.b)) + s + esc("0"),

  // Combos
  purpleBold: (s: string) => esc("1;" + rgb(P.purple.r, P.purple.g, P.purple.b)) + s + esc("0"),
  pinkBold: (s: string) => esc("1;" + rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  mintBold: (s: string) => esc("1;" + rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  blueBold: (s: string) => esc("1;" + rgb(P.blue.r, P.blue.g, P.blue.b)) + s + esc("0"),
  creamBold: (s: string) => esc("1;" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),

  // Backgrounds
  bgPurple: (s: string) => esc(bgRgb(P.purple.r, P.purple.g, P.purple.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgPink: (s: string) => esc(bgRgb(P.pink.r, P.pink.g, P.pink.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgDark: (s: string) => esc(bgRgb(P.dark.r, P.dark.g, P.dark.b) + ";" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),

  // Parallel UI extras
  orangeBold: (s: string) => esc("1;" + rgb(P.orange.r, P.orange.g, P.orange.b)) + s + esc("0"),
  redBold: (s: string) => esc("1;" + rgb(P.red.r, P.red.g, P.red.b)) + s + esc("0"),

  // Matrix theme
  phosphor: (s: string) => esc(rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b)) + s + esc("0"),
  phosphorBold: (s: string) => esc("1;" + rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b)) + s + esc("0"),
  phosphorDim: (s: string) => esc("2;" + rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b)) + s + esc("0"),
  matrixBlack: (s: string) => esc(rgb(0, 0, 0)) + s + esc("0"),
  bgMatrix: (s: string) => esc(bgRgb(0, 8, 0) + ";" + rgb(P.matrixGreen.r, P.matrixGreen.g, P.matrixGreen.b)) + s + esc("0"),

  // Metrics
  cyan: (s: string) => esc(rgb(P.metricsCyan.r, P.metricsCyan.g, P.metricsCyan.b)) + s + esc("0"),
  cyanBold: (s: string) => esc("1;" + rgb(P.metricsCyan.r, P.metricsCyan.g, P.metricsCyan.b)) + s + esc("0"),
  navy: (s: string) => esc(rgb(P.metricsNavy.r, P.metricsNavy.g, P.metricsNavy.b)) + s + esc("0"),
  slate: (s: string) => esc(rgb(P.metricsSlate.r, P.metricsSlate.g, P.metricsSlate.b)) + s + esc("0"),
  silver: (s: string) => esc(rgb(P.metricsSilver.r, P.metricsSilver.g, P.metricsSilver.b)) + s + esc("0"),
  white: (s: string) => esc(rgb(P.metricsWhite.r, P.metricsWhite.g, P.metricsWhite.b)) + s + esc("0"),
  whiteBold: (s: string) => esc("1;" + rgb(P.metricsWhite.r, P.metricsWhite.g, P.metricsWhite.b)) + s + esc("0"),
  amber: (s: string) => esc(rgb(P.metricsAmber.r, P.metricsAmber.g, P.metricsAmber.b)) + s + esc("0"),
  green: (s: string) => esc(rgb(P.metricsGreen.r, P.metricsGreen.g, P.metricsGreen.b)) + s + esc("0"),
  greenBold: (s: string) => esc("1;" + rgb(P.metricsGreen.r, P.metricsGreen.g, P.metricsGreen.b)) + s + esc("0"),
  metricsRed: (s: string) => esc(rgb(P.metricsRed.r, P.metricsRed.g, P.metricsRed.b)) + s + esc("0"),
  metricsBlue: (s: string) => esc(rgb(P.metricsBlue.r, P.metricsBlue.g, P.metricsBlue.b)) + s + esc("0"),
  violet: (s: string) => esc(rgb(P.metricsViolet.r, P.metricsViolet.g, P.metricsViolet.b)) + s + esc("0"),

  bgNavy: (s: string) => esc(bgRgb(P.metricsNavy.r, P.metricsNavy.g, P.metricsNavy.b) + ";" + rgb(P.metricsWhite.r, P.metricsWhite.g, P.metricsWhite.b)) + s + esc("0"),
  bgSlate: (s: string) => esc(bgRgb(P.metricsSlate.r, P.metricsSlate.g, P.metricsSlate.b) + ";" + rgb(P.metricsSilver.r, P.metricsSilver.g, P.metricsSilver.b)) + s + esc("0"),

  amberBold: (s: string) => esc("1;" + rgb(P.metricsAmber.r, P.metricsAmber.g, P.metricsAmber.b)) + s + esc("0"),
  metricsRedBold: (s: string) => esc("1;" + rgb(P.metricsRed.r, P.metricsRed.g, P.metricsRed.b)) + s + esc("0"),
};

// ── Semantic helpers ─────────────────────────────────────────
export const status = {
  ok: (s: string) => style.mintBold("✔ " + s),
  warn: (s: string) => style.orange("⚠ " + s),
  fail: (s: string) => style.red("✖ " + s),
  info: (s: string) => style.purple("ℹ " + s),
  success: (s: string) => style.mint("✅ " + s),
  error: (s: string) => style.red("❌ " + s),
};

// ── Layout primitives ────────────────────────────────────────
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
  const rawInner = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    title ? stripAnsi(title).length + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const top = title
    ? style.phosphorDim("╔" + "═".repeat(2) + " " + style.phosphorBold(title) + " " + "═".repeat(Math.max(0, width - stripAnsi(title).length - 6)) + "╗")
    : style.phosphorDim("╔" + "═".repeat(width) + "╗");
  const bottom = style.phosphorDim("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => style.phosphorDim("║ ") + padEndAnsi(l, innerWidth) + style.phosphorDim(" ║"));
  return [top, ...body, bottom].join("\n");
}

// ── HUD primitives ───────────────────────────────────────────

/** Generate Matrix green text */
export function gradient(text: string): string {
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const r = Math.round(0 + (P.matrixGreen.r - 0) * t * 0.7);
    const g = Math.round(50 + (P.matrixGreen.g - 50) * t);
    const b = Math.round(0 + (P.matrixGreen.b - 0) * t * 0.7);
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
  const innerWidth = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);
  const width = innerWidth + 4;
  const titleText = title ? gradient(title) : "";
  const top = title
    ? style.phosphorDim("┏" + "━".repeat(2) + " ") + titleText + style.phosphorDim(" " + "━".repeat(Math.max(0, width - stripAnsi(title).length - 6)) + "┓")
    : style.phosphorDim("┏" + "━".repeat(width) + "┓");
  const bottom = style.phosphorDim("┗" + "━".repeat(width) + "┛");
  const body = lines.map((l) =>
    style.phosphorDim("┃ ") + padEndAnsi(l, innerWidth) + style.phosphorDim(" ┃")
  );
  return [top, ...body, bottom].join("\n");
}

/** Sparkle header with stars */
export function sparkleHeader(text: string): string {
  const deco = "✨ 💜 ✨";
  const total = text.length + deco.length + 4;
  const line = "~".repeat(Math.min(total, 60));
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
  return [
    "",
    style.phosphorBold(text),
    style.phosphorDim("═".repeat(Math.min(visibleTerminalWidth(text), 56))),
    "",
  ].join("\n");
}

/** Single stat line: label + value + optional unit */
export function stat(label: string, value: string, unit = ""): string {
  return "  " + style.phosphorDim(label + ":") + " " + style.phosphorBold(value) + style.phosphorDim(unit);
}

// ── Metrics Theme Layout ──────────────────────────────────────

export function metricsPanel(lines: string[], title?: string): string {
  const innerWidth = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);
  const width = innerWidth + 4;
  const top = title
    ? style.slate("╭" + "─".repeat(2) + " " + style.cyanBold(title) + " " + "─".repeat(Math.max(0, width - stripAnsi(title).length - 4)) + "╮")
    : style.slate("╭" + "─".repeat(width) + "╮");
  const bottom = style.slate("╰" + "─".repeat(width) + "╯");
  const body = lines.map((l) =>
    style.slate("│ ") + padEndAnsi(l, innerWidth) + style.slate(" │")
  );
  return [top, ...body, bottom].join("\n");
}

export function metricsGauge(
  label: string,
  value: number,
  max: number,
  width = 24
): string {

  const ratio = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let barColor = "38;2;34;197;94";
  if (ratio > 0.7) barColor = "38;2;245;158;11";
  if (ratio > 0.9) barColor = "38;2;239;68;68";

  const bar = esc(barColor) + "█".repeat(filled) + esc("0") + style.silver("░".repeat(empty));
  const pct = style.whiteBold(`${Math.round(ratio * 100)}%`.padStart(4));
  return `  ${style.silver(label.padStart(10))} ${bar} ${pct}`;
}

export function metricsGradient(text: string): string {

  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const r = Math.round(P.metricsCyan.r + (P.metricsViolet.r - P.metricsCyan.r) * t);
    const g = Math.round(P.metricsCyan.g + (P.metricsViolet.g - P.metricsCyan.g) * t);
    const b = Math.round(P.metricsCyan.b + (P.metricsViolet.b - P.metricsCyan.b) * t);
    result.push(esc("38;2;" + r + ";" + g + ";" + b + "m") + chars[i] + esc("0"));
  }
  return result.join("");
}

export function metricsHeader(text: string): string {

  return [
    "",
    style.slate("╭" + "─".repeat(2) + "✦" + "─".repeat(text.length + 2) + "✦" + "─".repeat(2) + "╮"),
    style.slate("│") + "  " + style.cyanBold(text) + "  " + style.slate("│"),
    style.slate("╰" + "─".repeat(2) + "✦" + "─".repeat(text.length + 2) + "✦" + "─".repeat(2) + "╯"),
    "",
  ].join("\n");
}

export function metricsStat(label: string, value: string, unit = ""): string {

  return "  " + style.silver(label + ":") + " " + style.cyanBold(value) + style.silver(unit);
}

export function metricsMatrixHeader(text: string): string {

  return [
    "",
    style.cyanBold("╔══ " + text + " ═══════════════════════════════════════════════╗"),
    style.cyan("║  ✦ OMK Metrics · real-time dashboard"),
    style.slate("╚" + "═".repeat(Math.min(visibleTerminalWidth(text) + 20, 66)) + "╝"),
    "",
  ].join("\n");
}

/** Get system usage snapshot */
export function getSystemUsage(): {
  cpuPercent: number;
  memUsedGB: number;
  memTotalGB: number;
  memPercent: number;
  loadAvg: number[];
  heapUsedMB: number;
  heapTotalMB: number;
  heapExternalMB: number;
  eventLoopLagMs: number;
  uptimeSeconds: number;
} {
  const memTotal = totalmem();
  const memFree = freemem();
  const memUsed = memTotal - memFree;

  // Very rough CPU estimate using loadavg vs core count
  const cores = cpus().length;
  const load1 = loadavg()[0];
  const cpuPercent = Math.min(Math.round((load1 / cores) * 100), 100);

  // Process memory detail
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1048576);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1048576);
  const heapExternalMB = Math.round(memUsage.external / 1048576);

  // Event loop lag estimate (sync, coarse)
  const lagStart = process.hrtime.bigint();
  const lagEnd = process.hrtime.bigint();
  const eventLoopLagMs = Number(lagEnd - lagStart) / 1_000_000;

  return {
    cpuPercent,
    memUsedGB: Math.round((memUsed / 1024 / 1024 / 1024) * 10) / 10,
    memTotalGB: Math.round((memTotal / 1024 / 1024 / 1024) * 10) / 10,
    memPercent: Math.round((memUsed / memTotal) * 100),
    loadAvg: loadavg(),
    heapUsedMB,
    heapTotalMB,
    heapExternalMB,
    eventLoopLagMs,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

// ── Utility ──────────────────────────────────────────────────
function stripAnsi(str: string): string {
  return sanitizeTerminalText(str);
}

export function padEndAnsi(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - stripAnsi(str).length));
}

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/^::code-comment\{.*?\}[ \t]*\r?\n?/gm, "");
}

export function visibleTerminalWidth(text: string): number {
  return sanitizeTerminalText(text).length;
}

// ── Brand Emoji Kit ───────────────────────────────────────
export const emoji = {
  shell: "🐚",
  code: "💜",
  search: "🔍",
  download: "📥",
  package: "📦",
  sparkles: "✨",
  heart: "🩷",
  star: "🌟",
  magic: "🪄",
  cat: "🐱",
  cookie: "🍪",
  leaf: "🌿",
  candy: "🍬",
  flower: "🌸",
  moon: "🌙",
  cloud: "☁️",
  fire: "🔥",
  zap: "⚡",
  checklist: "☑️",
  wand: "✨",
};

export function omkStatusChips(): string {
  const chips = [
    style.purpleBold("[provider-neutral]"),
    style.blue("[agent-first]"),
    style.mintBold("[plan-first]"),
    style.orange("[safe]"),
    style.lightPurple("[open]"),
  ];
  return chips.join(" ");
}

export function omkCliHero(footer?: string): string {
  const heroLines = [
    gradient("✦ OMK ✦"),
    style.phosphorBold("Open Multi-agent Kit."),
    style.phosphor("Provider-neutral runtime for AI coding teams."),
    style.phosphorDim("DAG scheduling · evidence gates · worktree isolation · replay · memory"),
    "",
    ...OMK_MATRIX_ASCII_ART.split("\n").map((line) => style.matrixGreen(line)),
    "",
    omkStatusChips(),
  ];

  if (footer) {
    heroLines.push("", style.gray(footer));
  }

  return box(heroLines, "OMK — Open Multi-agent Kit");
}

/** @deprecated use omkCliHero */
export const kimicatCliHero = omkCliHero;
/** @deprecated use omkStatusChips */
export const kimicatStatusChips = omkStatusChips;

// ── OMK Custom Banner ───────────────────────────────────────
export function omkMetaBox(meta?: { directory?: string; session?: string; model?: string }): string {
  const metaLines: string[] = [];
  if (meta?.directory) metaLines.push(label("Directory", meta.directory));
  if (meta?.session) metaLines.push(label("Session", meta.session));
  if (meta?.model) metaLines.push(label("Model", meta.model));

  if (metaLines.length === 0) return "";
  return box(metaLines, "Session Info") + "\n";
}

/** @deprecated use omkMetaBox */
export const kimicatMetaBox = omkMetaBox;

// ── Theme Customization ─────────────────────────────────────

export interface OmkThemeConfig {
  banner?: {
    title?: string;
    subtitle?: string;
    style?: "default" | "minimal" | "box" | "hero";
    asciiArt?: string;
    enabled?: boolean;
  };
  colors?: {
    primary?: string;
    accent?: string;
    success?: string;
    warning?: string;
    danger?: string;
    info?: string;
    muted?: string;
    text?: string;
    background?: string;
  };
  metaBox?: boolean;
}

export { P, hexToRgb, colorFromHex };

export async function loadThemeConfig(): Promise<OmkThemeConfig | null> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");
  const { getProjectRoot, pathExists } = await import("./fs.js");
  const themePath = join(getProjectRoot(), ".omk", "theme.json");
  if (!(await pathExists(themePath))) return null;
  try {
    const content = await readFile(themePath, "utf-8");
    return JSON.parse(content) as OmkThemeConfig;
  } catch {
    return null;
  }
}

function themedGradient(text: string, startHex: string | undefined, endHex: string | undefined): string {
  const start = colorFromHex(startHex, P.purple);
  const end = colorFromHex(endHex, P.pink);
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const r = Math.round(start.r + (end.r - start.r) * t);
    const g = Math.round(start.g + (end.g - start.g) * t);
    const b = Math.round(start.b + (end.b - start.b) * t);
    result.push(esc(rgb(r, g, b)) + chars[i] + esc("0"));
  }
  return result.join("");
}

function themedBox(
  lines: string[],
  title: string | undefined,
  primary: { r: number; g: number; b: number },
  _accent: { r: number; g: number; b: number }
): string {
  const primaryFn = (s: string) => esc(rgb(primary.r, primary.g, primary.b)) + s + esc("0");
  const termWidth = process.stdout.columns || 80;
  const rawInner = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    title ? stripAnsi(title).length + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const top = title
    ? primaryFn("╔" + "═".repeat(2) + " " + title + " " + "═".repeat(Math.max(0, width - stripAnsi(title).length - 6)) + "╗")
    : primaryFn("╔" + "═".repeat(width) + "╗");
  const bottom = primaryFn("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => primaryFn("║ ") + padEndAnsi(l, innerWidth) + primaryFn(" ║"));
  return [top, ...body, bottom].join("\n");
}

function buildThemedMetaBox(
  meta: { directory?: string; session?: string; model?: string } | undefined,
  primary: { r: number; g: number; b: number },
  text: { r: number; g: number; b: number },
  muted: { r: number; g: number; b: number }
): string {
  if (!meta) return "";
  const metaLines: string[] = [];
  const textFn = (s: string) => esc(rgb(text.r, text.g, text.b)) + s + esc("0");
  const mutedFn = (s: string) => esc(rgb(muted.r, muted.g, muted.b)) + s + esc("0");
  if (meta.directory) metaLines.push("  " + mutedFn("Directory:") + " " + textFn(meta.directory));
  if (meta.session) metaLines.push("  " + mutedFn("Session:") + " " + textFn(meta.session));
  if (meta.model) metaLines.push("  " + mutedFn("Model:") + " " + textFn(meta.model));
  if (metaLines.length === 0) return "";

  const innerWidth = Math.max(...metaLines.map((l) => stripAnsi(l).length));
  const width = innerWidth + 4;
  const top = esc(rgb(primary.r, primary.g, primary.b)) + "╔" + "═".repeat(width) + "╗" + esc("0");
  const bottom = esc(rgb(primary.r, primary.g, primary.b)) + "╚" + "═".repeat(width) + "╝" + esc("0");
  const body = metaLines.map((l) => esc(rgb(primary.r, primary.g, primary.b)) + "║ " + padEndAnsi(l, innerWidth) + " ║" + esc("0"));
  return [top, ...body, bottom].join("\n") + "\n";
}

export function omkBanner(
  meta?: { directory?: string; session?: string; model?: string },
  footer?: string,
  theme?: OmkThemeConfig
): string {
  if (theme?.banner?.enabled === false) return "";

  // No custom theme → delegate to existing branded implementation
  if (!theme || (!theme.banner && !theme.colors)) {
    const parts: string[] = [omkCliHero(footer)];
    const metaBox = omkMetaBox(meta);
    if (metaBox) parts.push(metaBox);
    return parts.join("\n");
  }

  const title = theme.banner?.title ?? "OMK";
  const subtitle = theme.banner?.subtitle ?? "Open Multi-agent Kit.";
  const styleName = theme.banner?.style ?? "default";
  const art = theme.banner?.asciiArt ?? "";
  const primary = colorFromHex(theme.colors?.primary, P.purple);
  const accent = colorFromHex(theme.colors?.accent, P.pink);
  const muted = colorFromHex(theme.colors?.muted, P.gray);
  const text = colorFromHex(theme.colors?.text, P.cream);

  const primaryFn = (s: string) => esc(rgb(primary.r, primary.g, primary.b)) + s + esc("0");
  const accentFn = (s: string) => esc(rgb(accent.r, accent.g, accent.b)) + s + esc("0");
  const mutedFn = (s: string) => esc(rgb(muted.r, muted.g, muted.b)) + s + esc("0");

  if (styleName === "minimal") {
    const parts: string[] = ["", primaryFn("▸ " + title) + " " + mutedFn(subtitle)];
    if (footer) parts.push(mutedFn(footer));
    if (theme.metaBox !== false && meta) {
      const m = meta.directory ? `dir:${meta.directory}` : "";
      const s = meta.session ? `session:${meta.session}` : "";
      const mo = meta.model ? `model:${meta.model}` : "";
      const metaStr = [m, s, mo].filter(Boolean).join(" │ ");
      if (metaStr) parts.push(mutedFn(metaStr));
    }
    parts.push("");
    return parts.join("\n");
  }

  const heroLines: string[] = [
    themedGradient("✦ " + title + " ✦", theme.colors?.primary, theme.colors?.accent),
    accentFn(subtitle),
    mutedFn("Provider-neutral runtime for AI coding teams."),
  ];

  if (art) {
    heroLines.push("", ...art.split("\n").map((line) => primaryFn(line)), "");
  } else {
    heroLines.push("");
  }

  heroLines.push(omkStatusChips());

  if (footer) heroLines.push("", mutedFn(footer));

  const result: string[] = ["", themedBox(heroLines, styleName === "hero" ? title : undefined, primary, accent), ""];

  if (theme.metaBox !== false) {
    const metaBox = buildThemedMetaBox(meta, primary, text, muted);
    if (metaBox) result.push(metaBox);
  }

  return result.join("\n");
}

/** @deprecated use omkBanner */
export const kimicatBanner = omkBanner;

// ── Parallel Execution UI Kit ────────────────────────────────

const ROLE_COLORS: Record<string, (s: string) => string> = {
  orchestrator: style.purple,
  coordinator: style.purple,
  planner: style.blue,
  explorer: style.blue,
  coder: style.mint,
  reviewer: style.pink,
  qa: style.orange,
  architect: style.lightPurple,
  router: style.cream,
  default: style.gray,
};

export function roleColor(role: string): (s: string) => string {
  return ROLE_COLORS[role] ?? ROLE_COLORS.default;
}

export function parallelStatusBadge(nodeStatus: string, role: string): string {
  const color = roleColor(role);
  const badgeBg = nodeStatus === "running" ? style.bgPurple
    : nodeStatus === "done" ? style.bgDark
    : nodeStatus === "failed" ? style.bgPink
    : style.gray;
  const icon = nodeStatus === "running" ? "▶"
    : nodeStatus === "done" ? "✓"
    : nodeStatus === "failed" ? "✕"
    : nodeStatus === "blocked" ? "■"
    : "□";
  return badgeBg(` ${icon} ${nodeStatus.toUpperCase()} `) + " " + color(`[${role}]`);
}

export function workerLabel(id: string, role: string): string {
  const color = roleColor(role);
  return color(`${role}`) + style.gray(":") + " " + style.creamBold(id);
}

export function safetyChip(policy: string): string {
  if (policy === "yolo") return style.mintBold("[SAFETY:YOLO]") + " " + style.gray("auto-allow with hook guards");
  if (policy === "auto") return style.orangeBold("[SAFETY:AUTO]") + " " + style.gray("safe tools auto, destructive ask");
  if (policy === "interactive") return style.pinkBold("[SAFETY:INTERACTIVE]") + " " + style.gray("human approval required");
  if (policy === "block") return style.redBold("[SAFETY:BLOCK]") + " " + style.gray("all blocked");
  return style.gray(`[SAFETY:${policy}]`);
}

export function ensembleQuorumBar(successWeight: number, totalWeight: number, quorumWeight: number, width = 20): string {
  const ratio = totalWeight > 0 ? Math.min(1, successWeight / totalWeight) : 0;
  const quorumRatio = totalWeight > 0 ? Math.min(1, quorumWeight / totalWeight) : 0;
  const filled = Math.round(ratio * width);
  const quorumPos = Math.round(quorumRatio * width);
  const bar: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === quorumPos) {
      bar.push(style.creamBold("|"));
    } else if (i < filled) {
      bar.push(style.mint("█"));
    } else {
      bar.push(style.gray("░"));
    }
  }

  const pct = style.creamBold(`${Math.round(ratio * 100)}%`);
  return `  ${style.gray("quorum")} ${bar.join("")} ${pct} ${style.gray(`(need ${quorumWeight.toFixed(1)})`)}`;
}

export function workerOutputBox(lines: string[], workerId: string, role: string): string {
  const color = roleColor(role);
  const title = `${workerId} (${role})`;
  const prefix = color(`┃ `);
  const innerWidth = Math.max(...lines.map((l) => stripAnsi(l).length), stripAnsi(title).length + 4);
  const top = color(`┏━ ${style.pinkBold(title)} ${"━".repeat(Math.max(0, innerWidth - stripAnsi(title).length - 4))}┓`);
  const bottom = color(`┗${"━".repeat(innerWidth + 2)}┛`);
  const body = lines.map((l) => prefix + padEndAnsi(l, innerWidth) + color(" ┃"));
  return [top, ...body, bottom].join("\n");
}

export function approvalPromptBox(toolName: string, nodeId: string): string {
  return box([
    style.pinkBold(`⚠️  Approval required for ${toolName}`),
    style.gray(`Requested by node: ${nodeId}`),
    "",
    style.cream("Allow this operation? (y/n/describe):")
  ], "Safety Gate");
}

export function orangeBold(s: string): string {
  return esc("1;" + rgb(P.orange.r, P.orange.g, P.orange.b)) + s + esc("0");
}
