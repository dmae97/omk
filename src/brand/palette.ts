/**
 * OMK brand color palette — compiled from the night-city theme document
 * (theme contract T5b) plus conversion helpers.
 *
 * Night City colors come from src/brand/night-city.theme.json (snapshot of
 * themes/night-city.theme.json, drift-guarded in test/brand-theme.test.mjs).
 * Families without a theme document yet (matrix rain, rust forge, metrics
 * dashboard, sparkle accents) stay as numeric RGB constants until their own
 * omk.theme.v1 documents land — no hex or SGR literals live in this file.
 */

import { nightCityHex, nightCityRgb, rgbToHex } from "./theme-compiled.js";
import type { BrandRgb } from "./theme-compiled.js";

export type { BrandRgb } from "./theme-compiled.js";

const rgb = (r: number, g: number, b: number): BrandRgb => ({ r, g, b });

export const P = {
  // ── Night City theme primitives (theme-derived) ──
  purple: nightCityRgb("purple"),          // primitive "purple"  orchestration/control accent
  lightPurple: rgb(214, 108, 255),         // neon highlight (no theme primitive yet)
  darkPurple: rgb(64, 18, 133),            // deep control shadow (no theme primitive yet)
  pink: nightCityRgb("magenta"),           // primitive "magenta" control/focus accent
  hotPink: nightCityRgb("magenta"),        // primitive "magenta" hot accent (alias)
  mint: nightCityRgb("mint"),              // primitive "mint"    telemetry/success
  darkMint: rgb(0, 196, 153),              // telemetry shadow (no theme primitive yet)
  orange: nightCityRgb("amber"),           // primitive "amber"   warning/pending
  red: nightCityRgb("red"),                // primitive "red"     fault/danger
  blue: nightCityRgb("cyan"),              // primitive "cyan"    route/signal/info
  cream: nightCityRgb("cream"),            // primitive "cream"   bright console text
  dark: nightCityRgb("dark"),              // primitive "dark"    cockpit background
  gray: nightCityRgb("gray"),              // primitive "gray"    muted telemetry
  skin: rgb(255, 214, 102),                // metric gold (no theme primitive yet)
  gridLine: rgb(34, 50, 74),               // neon grid border / tmux pane border

  // ── Rust forge family (awaiting its own theme document) ──
  rustOrange: rgb(249, 115, 22),           // Rust/native toolchain accent
  rustOxide: rgb(124, 45, 18),             // Rust/native warning shadow
  rustEmber: rgb(255, 122, 24),            // forge sparkle ember
  rustCrimson: rgb(255, 49, 93),           // forge sparkle crimson
  cargoGreen: nightCityRgb("mint"),        // primitive "mint"    verified native check

  // ── Matrix family (awaiting its own theme document) ──
  matrixGreen: nightCityRgb("mint"),       // primitive "mint"    OMK signal phosphor
  matrixDark: rgb(8, 39, 31),              // success/signal background
  matrixRainGreen: rgb(0, 255, 65),        // iconic Matrix rain code green
  matrixDeepBg: rgb(0, 8, 0),              // matrix rain deep background
  matrixRainDim: rgb(0, 95, 25),           // matrix rain dark green
  matrixWarningAmber: nightCityRgb("amber"), // primitive "amber" matrix warning amber
  matrixErrorRed: rgb(255, 50, 50),        // matrix error red

  // ── Sparkle ramp accents (decorative highlight ramps) ──
  sparkleWhite: rgb(244, 255, 255),        // sparkle highlight tip
  sparkleGold: rgb(255, 209, 102),         // sparkle gold mid-tone

  // ── Metrics theme (professional dashboard, awaiting its own theme doc) ──
  metricsCyan: rgb(6, 182, 212),           // Metrics primary
  metricsTeal: rgb(20, 184, 166),          // Metrics secondary
  metricsNavy: rgb(10, 25, 41),            // Metrics bg dark
  metricsSlate: rgb(30, 41, 59),           // Metrics bg light
  metricsSilver: rgb(203, 213, 225),       // Metrics muted text
  metricsWhite: rgb(241, 245, 249),        // Metrics bright
  metricsAmber: rgb(245, 158, 11),         // Metrics warning
  metricsGreen: rgb(34, 197, 94),          // Metrics success
  metricsRed: rgb(239, 68, 68),            // Metrics error
  metricsBlue: rgb(59, 130, 246),          // Metrics info
  metricsViolet: rgb(139, 92, 246),        // Metrics highlight
} as const;

/**
 * Canonical uppercase hex strings for theme-derived brand colors. Use these
 * wherever a hex string is required (sparkle/gradient ramps, tmux options)
 * instead of hardcoding literals.
 */
export const BRAND_HEX = {
  dark: nightCityHex("dark"),
  surface: nightCityHex("surface"),
  cyan: nightCityHex("cyan"),
  mint: nightCityHex("mint"),
  magenta: nightCityHex("magenta"),
  purple: nightCityHex("purple"),
  amber: nightCityHex("amber"),
  red: nightCityHex("red"),
  cream: nightCityHex("cream"),
  muted: nightCityHex("muted"),
  gray: nightCityHex("gray"),
  gridLine: rgbToHex(P.gridLine),
  sparkleWhite: rgbToHex(P.sparkleWhite),
  sparkleGold: rgbToHex(P.sparkleGold),
  rustEmber: rgbToHex(P.rustEmber),
  rustCrimson: rgbToHex(P.rustCrimson),
} as const;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "").trim();
  const m = normalized.match(/^(?:[0-9a-fA-F]{3}){1,2}$/);
  if (!m) return null;
  const full = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function colorFromHex(
  hex: string | undefined,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  return hexToRgb(hex ?? "") ?? fallback;
}
