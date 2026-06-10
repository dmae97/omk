/**
 * OMK brand — theme-compiled color source (theme contract T5b).
 *
 * Single bridge between the canonical omk.theme.v1 document and the brand
 * palette/UI layers. All brand color values derive from the night-city theme
 * document instead of hardcoded hex/SGR literals:
 *   - `src/brand/night-city.theme.json` is a build-time snapshot of
 *     `themes/night-city.theme.json` (tsc copies it into dist; the snapshot is
 *     drift-guarded by test/brand-theme.test.mjs).
 *   - SGR sequences are produced exclusively through the theme compiler
 *     (`compileTheme`) so no raw escape literals live in brand sources.
 *
 * Imports target the concrete src/cli/theme modules (render-table,
 * terminal-capability, oklab-quantize) rather than the barrel to avoid a
 * module cycle through theme-registry → theme/colors → brand/palette.
 */

import { compileTheme } from "../cli/theme/render-table.js";
import type { CompiledTheme, OmkThemeV1 } from "../cli/theme/render-table.js";
import { detectColorTier } from "../cli/theme/terminal-capability.js";
import type { ColorTier } from "../cli/theme/terminal-capability.js";
import { hexToRgb255, normalizeHex } from "../cli/theme/oklab-quantize.js";
import nightCityThemeJson from "./night-city.theme.json" with { type: "json" };

/** Plain 0-255 RGB triple used across the brand palette public API. */
export interface BrandRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Primitive names the brand palette requires from the night-city document. */
export type NightCityPrimitive =
  | "dark"
  | "surface"
  | "cyan"
  | "mint"
  | "magenta"
  | "purple"
  | "amber"
  | "red"
  | "cream"
  | "muted"
  | "gray";

const REQUIRED_PRIMITIVES: readonly NightCityPrimitive[] = [
  "dark",
  "surface",
  "cyan",
  "mint",
  "magenta",
  "purple",
  "amber",
  "red",
  "cream",
  "muted",
  "gray",
];

function assertThemeDocument(doc: unknown): OmkThemeV1 {
  if (typeof doc !== "object" || doc === null) {
    throw new Error("brand theme-compiled: night-city theme snapshot is not an object");
  }
  const candidate = doc as {
    schemaVersion?: unknown;
    primitives?: unknown;
    semantics?: unknown;
    fallback16?: unknown;
  };
  if (candidate.schemaVersion !== "omk.theme.v1") {
    throw new Error(
      `brand theme-compiled: expected schemaVersion "omk.theme.v1", got "${String(candidate.schemaVersion)}"`,
    );
  }
  if (typeof candidate.primitives !== "object" || candidate.primitives === null) {
    throw new Error("brand theme-compiled: theme snapshot has no primitives map");
  }
  if (typeof candidate.semantics !== "object" || candidate.semantics === null) {
    throw new Error("brand theme-compiled: theme snapshot has no semantics map");
  }
  const primitives = candidate.primitives as Record<string, unknown>;
  for (const name of REQUIRED_PRIMITIVES) {
    if (typeof primitives[name] !== "string") {
      throw new Error(`brand theme-compiled: theme snapshot is missing primitive "${name}"`);
    }
  }
  return doc as OmkThemeV1;
}

/** Validated night-city theme document (build-time snapshot of themes/). */
export const NIGHT_CITY_THEME: OmkThemeV1 = assertThemeDocument(nightCityThemeJson);

/** Canonical normalized uppercase hex string for a night-city primitive. */
export function nightCityHex(primitive: NightCityPrimitive): string {
  const raw = NIGHT_CITY_THEME.primitives[primitive];
  if (raw === undefined) {
    throw new Error(`brand theme-compiled: unknown night-city primitive "${primitive}"`);
  }
  return normalizeHex(raw);
}

/** 0-255 RGB triple for a night-city primitive. */
export function nightCityRgb(primitive: NightCityPrimitive): BrandRgb {
  const [r, g, b] = hexToRgb255(nightCityHex(primitive));
  return { r, g, b };
}

function channelHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

/** Convert an RGB triple to canonical uppercase hex (no literal hex in source). */
export function rgbToHex(color: BrandRgb): string {
  return `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
}

const compiledByTier = new Map<ColorTier, CompiledTheme>();

/**
 * Compiled night-city render table for the requested (default: detected)
 * degradation tier. Semantic token → precomputed SGR via `tokens[role].sgr`,
 * canonical hex via `tokens[role].hex`, painting via `paint(role, text)`.
 */
export function getCompiledBrandTheme(tier: ColorTier = detectColorTier()): CompiledTheme {
  const cached = compiledByTier.get(tier);
  if (cached !== undefined) return cached;
  const compiled = compileTheme(NIGHT_CITY_THEME, tier);
  compiledByTier.set(tier, compiled);
  return compiled;
}

/** Paint text with a night-city semantic token at the detected color tier. */
export function brandPaint(role: string, text: string): string {
  return getCompiledBrandTheme().paint(role, text);
}

/**
 * Unconditional truecolor SGR open sequence for a brand RGB value, produced
 * through the theme compiler (single SGR factory — no escape literals here).
 * Brand theme constants intentionally stay truecolor for byte parity with the
 * legacy palette; tier-aware rendering should use `getCompiledBrandTheme()`.
 */
export function brandTruecolorSgr(color: BrandRgb): string {
  const inlineTheme: OmkThemeV1 = {
    schemaVersion: "omk.theme.v1",
    name: "omk-brand-inline",
    mode: "dark",
    primitives: { brand: rgbToHex(color) },
    backgrounds: [],
    semantics: { "brand.tone": { color: "brand", usage: "text" } },
    components: {},
    fallback16: { "brand.tone": "white" },
  };
  return compileTheme(inlineTheme, "truecolor").tokens["brand.tone"].sgr;
}
