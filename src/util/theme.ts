/**
 * OMK Brand Theme — oh-my-kimi CLI color system
 * Extracted from kimicat.png brand palette
 * HUD-ready: gradients, gauges, panels, sparkles ✨
 */

import { totalmem, freemem, loadavg, cpus } from "os";
import { OMK_SIMPLE_ASCII_ART } from "../kimi/simple-art.js";
import type { HudTheme } from "../hud/types.js";

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

// ── Brand palette (from kimicat.png) ────────────────────────
// "Onii-chan~ hai, naniga suki? Chocomint yori mo anata~ 💜"
const P = {
  purple: { r: 123, g: 91, b: 245 },   // #7B5BF5  Kimicat's eyes & logo
  lightPurple: { r: 167, g: 139, b: 250 }, // #A78BFA  soft highlights
  darkPurple: { r: 91, g: 33, b: 182 },    // #5B21B6  deep shadows
  pink: { r: 236, g: 72, b: 153 },         // #EC4899  hearts & cheeks
  hotPink: { r: 236, g: 72, b: 153 },      // #EC4899  accent
  mint: { r: 20, g: 184, b: 166 },         // #14B8A6  chocomint!
  darkMint: { r: 13, g: 148, b: 136 },     // #0D9488  mint shadow
  orange: { r: 251, g: 146, b: 60 },       // #FB923C  warning
  red: { r: 248, g: 113, b: 113 },         // #F87171  error
  blue: { r: 96, g: 165, b: 250 },         // #60A5FA  info
  cream: { r: 243, g: 232, b: 255 },       // #F3E8FF  bright text
  dark: { r: 36, g: 28, b: 50 },           // #241C32  hoodie black
  gray: { r: 148, g: 163, b: 184 },        // #94A3B8  muted
  skin: { r: 249, g: 211, b: 197 },        // #F9D3C5  warm skin tone
};

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
  cyan: (s: string) => esc(rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  cream: (s: string) => esc(rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),
  gray: (s: string) => esc(rgb(P.gray.r, P.gray.g, P.gray.b)) + s + esc("0"),
  skin: (s: string) => esc(rgb(P.skin.r, P.skin.g, P.skin.b)) + s + esc("0"),
  phosphor: (s: string) => esc(rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  phosphorDim: (s: string) => esc("2;" + rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  metricsRed: (s: string) => esc(rgb(P.red.r, P.red.g, P.red.b)) + s + esc("0"),

  // Combos
  purpleBold: (s: string) => esc("1;" + rgb(P.purple.r, P.purple.g, P.purple.b)) + s + esc("0"),
  pinkBold: (s: string) => esc("1;" + rgb(P.pink.r, P.pink.g, P.pink.b)) + s + esc("0"),
  mintBold: (s: string) => esc("1;" + rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),
  blueBold: (s: string) => esc("1;" + rgb(P.blue.r, P.blue.g, P.blue.b)) + s + esc("0"),
  creamBold: (s: string) => esc("1;" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),
  phosphorBold: (s: string) => esc("1;" + rgb(P.mint.r, P.mint.g, P.mint.b)) + s + esc("0"),

  // Backgrounds
  bgPurple: (s: string) => esc(bgRgb(P.purple.r, P.purple.g, P.purple.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgPink: (s: string) => esc(bgRgb(P.pink.r, P.pink.g, P.pink.b) + ";" + rgb(255, 255, 255)) + s + esc("0"),
  bgDark: (s: string) => esc(bgRgb(P.dark.r, P.dark.g, P.dark.b) + ";" + rgb(P.cream.r, P.cream.g, P.cream.b)) + s + esc("0"),

  // Parallel UI extras
  orangeBold: (s: string) => esc("1;" + rgb(P.orange.r, P.orange.g, P.orange.b)) + s + esc("0"),
  redBold: (s: string) => esc("1;" + rgb(P.red.r, P.red.g, P.red.b)) + s + esc("0"),
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
    style.purple("╔" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╗"),
    style.purple("║") + "  " + style.pinkBold(text) + "  " + style.purple("║"),
    style.purple("╚" + "═".repeat(2) + "✦" + "═".repeat(text.length + 2) + "✦" + "═".repeat(2) + "╝"),
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
  const safeTitle = title ? sanitizeTerminalText(title) : undefined;
  const termWidth = process.stdout.columns || 80;
  const rawInner = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    safeTitle ? stripAnsi(safeTitle).length + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const top = safeTitle
    ? style.purple("╔" + "═".repeat(2) + " " + safeTitle + " " + "═".repeat(Math.max(0, width - stripAnsi(safeTitle).length - 6)) + "╗")
    : style.purple("╔" + "═".repeat(width) + "╗");
  const bottom = style.purple("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => style.purple("║ ") + padEndAnsi(l, innerWidth) + style.purple(" ║"));
  return [top, ...body, bottom].join("\n");
}

// ── HUD primitives ───────────────────────────────────────────

/** Generate a gradient text from purple to pink */
export function gradient(text: string): string {
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
    const r = Math.round(P.purple.r + (P.pink.r - P.purple.r) * t);
    const g = Math.round(P.purple.g + (P.pink.g - P.purple.g) * t);
    const b = Math.round(P.purple.b + (P.pink.b - P.purple.b) * t);
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

  let barColor = rgb(P.mint.r, P.mint.g, P.mint.b);
  if (ratio > 0.7) barColor = rgb(P.orange.r, P.orange.g, P.orange.b);
  if (ratio > 0.9) barColor = rgb(P.red.r, P.red.g, P.red.b);

  const bar = esc(barColor) + "█".repeat(filled) + esc("0") + style.gray("░".repeat(empty));
  const pct = style.creamBold(`${Math.round(ratio * 100)}%`.padStart(4));
  return `  ${style.gray(label.padStart(10))} ${bar} ${pct}`;
}

/** Render a multi-line panel with a title */
export function panel(lines: string[], title?: string): string {
  const safeTitle = title ? sanitizeTerminalText(title) : undefined;
  const innerWidth = Math.max(...lines.map((l) => stripAnsi(l).length), safeTitle ? stripAnsi(safeTitle).length + 4 : 0);
  const width = innerWidth + 4;
  const top = safeTitle
    ? style.darkPurple("┏" + "━".repeat(2) + " " + style.pinkBold(safeTitle) + " " + "━".repeat(Math.max(0, width - stripAnsi(safeTitle).length - 6)) + "┓")
    : style.darkPurple("┏" + "━".repeat(width) + "┓");
  const bottom = style.darkPurple("┗" + "━".repeat(width) + "┛");
  const body = lines.map((l) =>
    style.darkPurple("┃ ") + padEndAnsi(l, innerWidth) + style.darkPurple(" ┃")
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

/** Single stat line: label + value + optional unit */
export function stat(label: string, value: string, unit = ""): string {
  return "  " + style.gray(label + ":") + " " + style.mintBold(value) + style.gray(unit);
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

export function stripBrokenAnsi(value: string): string {
  return value.replace(/(?<!\x1B)\[(?:\d{1,3}(?:;\d{1,3})*)m/g, "");
}

export function sanitizeTerminalText(value: string): string {
  return stripBrokenAnsi(value)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/^::code-comment\{.*?\}[ \t]*\r?\n?/gm, "");
}

// ── Kimicat Emoji Kit ───────────────────────────────────────
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

export function kimicatStatusChips(): string {
  const chips = [
    style.purpleBold("[AI-native]"),
    style.blue("[agent-first]"),
    style.mintBold("[plan-first]"),
    style.orange("[safe]"),
    style.lightPurple("[open]"),
  ];
  return chips.join(" ");
}

export function kimicatCliHero(footer?: string): string {
  const heroLines = [
    gradient("✦ OMK ✦"),
    style.creamBold("Open Multi-agent Kit."),
    style.gray("Provider-neutral runtime for AI coding teams."),
    "",
    ...OMK_SIMPLE_ASCII_ART.split("\n").map((line) => style.lightPurple(line)),
    "",
    kimicatStatusChips(),
  ];

  if (footer) {
    heroLines.push("", style.gray(footer));
  }

  return box(heroLines, "OMK — Open Multi-agent Kit");
}

/** @deprecated use kimicatCliHero */
export const omkCliHero = kimicatCliHero;

// ── Kimicat Custom Banner ───────────────────────────────────
export function kimicatMetaBox(meta?: { directory?: string; session?: string; model?: string }): string {
  const metaLines: string[] = [];
  if (meta?.directory) metaLines.push(label("Directory", meta.directory));
  if (meta?.session) metaLines.push(label("Session", meta.session));
  if (meta?.model) metaLines.push(label("Model", meta.model));

  if (metaLines.length === 0) return "";
  return box(metaLines, "Session Info") + "\n";
}

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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "").trim();
  const m = normalized.match(/^(?:[0-9a-fA-F]{3}){1,2}$/);
  if (!m) return null;
  const full = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function colorFromHex(hex: string | undefined, fallback: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  return hexToRgb(hex ?? "") ?? fallback;
}

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

export function kimicatBanner(
  meta?: { directory?: string; session?: string; model?: string },
  footer?: string,
  theme?: OmkThemeConfig
): string {
  if (theme?.banner?.enabled === false) return "";

  // No custom theme → delegate to existing branded implementation
  if (!theme || (!theme.banner && !theme.colors)) {
    const parts: string[] = [kimicatCliHero(footer)];
    const metaBox = kimicatMetaBox(meta);
    if (metaBox) parts.push(metaBox);
    return parts.join("\n");
  }

  const title = theme.banner?.title ?? "OMK";
  const subtitle = theme.banner?.subtitle ?? "Provider-neutral runtime for AI coding teams.";
  const styleName = theme.banner?.style ?? "default";
  const art = theme.banner?.asciiArt ?? OMK_SIMPLE_ASCII_ART;
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
    mutedFn("The orchestration layer that turns provider runtimes into a powerful coding team."),
    "",
    ...art.split("\n").map((line) => primaryFn(line)),
    "",
    kimicatStatusChips(),
  ];

  if (footer) heroLines.push("", mutedFn(footer));

  const result: string[] = ["", themedBox(heroLines, styleName === "hero" ? title : undefined, primary, accent), ""];

  if (theme.metaBox !== false) {
    const metaBox = buildThemedMetaBox(meta, primary, text, muted);
    if (metaBox) result.push(metaBox);
  }

  return result.join("\n");
}

/** @deprecated use omkBanner */
export const omkBanner = kimicatBanner;

export const hudTheme: HudTheme = {
  style,
  status,
  panel,
  gauge,
  stat,
  matrixHeader: sparkleHeader,
  gradient,
  separator,
  padEndAnsi,
  sanitizeTerminalText,
  getSystemUsage,
};

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
