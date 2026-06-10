/**
 * OMK brand -- theme-compiled color source (theme contract T5b).
 *
 * Single bridge between canonical omk.theme.v1 documents and the brand
 * palette/UI layers. Brand chrome defaults to night-city for byte parity, and
 * can be switched at process edges to rust-forge without changing import shapes.
 *
 * Imports target the concrete src/cli/theme modules (render-table,
 * terminal-capability, oklab-quantize) rather than the barrel to avoid a
 * module cycle through theme-registry -> theme/colors -> brand/palette.
 */

import { compileTheme } from "../cli/theme/render-table.js";
import type { CompiledTheme, OmkThemeV1 } from "../cli/theme/render-table.js";
import { detectColorTier } from "../cli/theme/terminal-capability.js";
import type { ColorTier } from "../cli/theme/terminal-capability.js";
import { hexToRgb255, normalizeHex } from "../cli/theme/oklab-quantize.js";
import nightCityThemeJson from "./night-city.theme.json" with { type: "json" };
import rustForgeThemeJson from "./rust-forge.theme.json" with { type: "json" };

/** Plain 0-255 RGB triple used across the brand palette public API. */
export interface BrandRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Primitive names the legacy brand palette requires from night-city. */
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

export type RustForgePrimitive =
  | "iron"
  | "coal"
  | "forge"
  | "anvil"
  | "rust"
  | "molten"
  | "copper"
  | "ember"
  | "oxide"
  | "quench"
  | "verdigris"
  | "crimson"
  | "steel"
  | "scale"
  | "ash"
  | "slag"
  | "bone";

export type BrandThemeName = "night-city" | "rust-forge";

const REQUIRED_NIGHT_CITY_PRIMITIVES: readonly NightCityPrimitive[] = [
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

const REQUIRED_RUST_FORGE_PRIMITIVES: readonly RustForgePrimitive[] = [
  "iron",
  "coal",
  "forge",
  "anvil",
  "rust",
  "molten",
  "copper",
  "ember",
  "oxide",
  "quench",
  "verdigris",
  "crimson",
  "steel",
  "scale",
  "ash",
  "slag",
  "bone",
];

function assertThemeDocument(
  doc: unknown,
  expectedName: BrandThemeName,
  requiredPrimitives: readonly string[],
): OmkThemeV1 {
  if (typeof doc !== "object" || doc === null) {
    throw new Error(`brand theme-compiled: ${expectedName} theme snapshot is not an object`);
  }
  const candidate = doc as {
    schemaVersion?: unknown;
    name?: unknown;
    primitives?: unknown;
    semantics?: unknown;
    fallback16?: unknown;
  };
  if (candidate.schemaVersion !== "omk.theme.v1") {
    throw new Error(
      `brand theme-compiled: expected schemaVersion "omk.theme.v1", got "${String(candidate.schemaVersion)}"`,
    );
  }
  if (candidate.name !== expectedName) {
    throw new Error(
      `brand theme-compiled: expected theme name "${expectedName}", got "${String(candidate.name)}"`,
    );
  }
  if (typeof candidate.primitives !== "object" || candidate.primitives === null) {
    throw new Error(`brand theme-compiled: ${expectedName} theme snapshot has no primitives map`);
  }
  if (typeof candidate.semantics !== "object" || candidate.semantics === null) {
    throw new Error(`brand theme-compiled: ${expectedName} theme snapshot has no semantics map`);
  }
  if (typeof candidate.fallback16 !== "object" || candidate.fallback16 === null) {
    throw new Error(`brand theme-compiled: ${expectedName} theme snapshot has no fallback16 map`);
  }
  const primitives = candidate.primitives as Record<string, unknown>;
  for (const name of requiredPrimitives) {
    if (typeof primitives[name] !== "string") {
      throw new Error(`brand theme-compiled: ${expectedName} theme snapshot is missing primitive "${name}"`);
    }
  }
  return doc as OmkThemeV1;
}

/** Validated night-city theme document (build-time snapshot of themes/). */
export const NIGHT_CITY_THEME: OmkThemeV1 = assertThemeDocument(
  nightCityThemeJson,
  "night-city",
  REQUIRED_NIGHT_CITY_PRIMITIVES,
);

/** Validated rust-forge theme document (build-time snapshot of themes/). */
export const RUST_FORGE_THEME: OmkThemeV1 = assertThemeDocument(
  rustForgeThemeJson,
  "rust-forge",
  REQUIRED_RUST_FORGE_PRIMITIVES,
);

const BRAND_THEME_BY_NAME: Readonly<Record<BrandThemeName, OmkThemeV1>> = {
  "night-city": NIGHT_CITY_THEME,
  "rust-forge": RUST_FORGE_THEME,
};

let activeBrandThemeName: BrandThemeName = "night-city";

export function resolveBrandThemeName(name: string | undefined): BrandThemeName {
  const normalized = name?.trim().toLowerCase();
  if (
    normalized === "rust-forge" ||
    normalized === "rust" ||
    normalized === "cargo" ||
    normalized === "oxide" ||
    normalized === "forge" ||
    normalized === "oxidized-forge" ||
    normalized === "oxidized" ||
    normalized === "rust-native"
  ) {
    return "rust-forge";
  }
  return "night-city";
}

export function setActiveBrandTheme(name: string | undefined): BrandThemeName {
  activeBrandThemeName = resolveBrandThemeName(name);
  return activeBrandThemeName;
}

export function getActiveBrandThemeName(): BrandThemeName {
  return activeBrandThemeName;
}

export function getActiveBrandTheme(): OmkThemeV1 {
  return BRAND_THEME_BY_NAME[activeBrandThemeName];
}

function hexByRole(theme: OmkThemeV1, role: string): string {
  const semantic = theme.semantics[role];
  if (semantic === undefined) {
    throw new Error(`brand theme-compiled: theme "${theme.name}" has no semantic role "${role}"`);
  }
  const raw = theme.primitives[semantic.color];
  if (raw === undefined) {
    throw new Error(
      `brand theme-compiled: theme "${theme.name}" semantic "${role}" references missing primitive "${semantic.color}"`,
    );
  }
  return normalizeHex(raw);
}

export function activeThemeHexByRole(role: string): string {
  return hexByRole(getActiveBrandTheme(), role);
}

export function brandThemeHexByRole(name: BrandThemeName, role: string): string {
  return hexByRole(BRAND_THEME_BY_NAME[name], role);
}

export function brandThemeRgbByRole(name: BrandThemeName, role: string): BrandRgb {
  const [r, g, b] = hexToRgb255(brandThemeHexByRole(name, role));
  return { r, g, b };
}

export function activeThemeRgbByRole(role: string): BrandRgb {
  const [r, g, b] = hexToRgb255(activeThemeHexByRole(role));
  return { r, g, b };
}

const PRIMITIVE_ROLE_ALIASES: Readonly<Partial<Record<NightCityPrimitive, string>>> = {
  cyan: "route.active",
  mint: "evidence.pass",
  magenta: "control.accent",
  purple: "control.accent",
  amber: "route.fallback",
  red: "telemetry.error",
  cream: "control.fg",
  muted: "dag.lane.queued",
  gray: "control.dim",
  dark: "control.bg",
};

export function activeThemeHexByPrimitive(primitive: string): string {
  const theme = getActiveBrandTheme();
  const raw = theme.primitives[primitive];
  if (raw !== undefined) return normalizeHex(raw);

  if (primitive === "surface") {
    const surfacePrimitive = theme.backgrounds[1] ?? theme.backgrounds[0];
    const surface = surfacePrimitive ? theme.primitives[surfacePrimitive] : undefined;
    return surface === undefined ? activeThemeHexByRole("control.bg") : normalizeHex(surface);
  }

  const role = PRIMITIVE_ROLE_ALIASES[primitive as NightCityPrimitive];
  if (role !== undefined) return activeThemeHexByRole(role);

  throw new Error(`brand theme-compiled: theme "${theme.name}" has no primitive "${primitive}"`);
}

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

const compiledByThemeAndTier = new Map<string, CompiledTheme>();

/**
 * Compiled active brand render table for the requested (default: detected)
 * degradation tier. The cache key includes both theme name and tier.
 */
export function getCompiledBrandTheme(tier: ColorTier = detectColorTier()): CompiledTheme {
  const theme = getActiveBrandTheme();
  const cacheKey = `${theme.name}:${tier}`;
  const cached = compiledByThemeAndTier.get(cacheKey);
  if (cached !== undefined) return cached;
  const compiled = compileTheme(theme, tier);
  compiledByThemeAndTier.set(cacheKey, compiled);
  return compiled;
}

/** Paint text with an active-brand semantic token at the detected color tier. */
export function brandPaint(role: string, text: string): string {
  return getCompiledBrandTheme().paint(role, text);
}

export function getActiveBrandChromeLabel(): string {
  return activeBrandThemeName === "rust-forge" ? "Oxidized Forge" : "Night City";
}

export function getActiveBrandCockpitSubtitle(): string {
  return activeBrandThemeName === "rust-forge"
    ? "OXIDIZED FORGE · ROUTE · VERIFY · CONTROL"
    : "NEON GRID · GREEN RAIN · METRICS WALL";
}

export function getActiveBrandCockpitDetail(): string {
  return activeBrandThemeName === "rust-forge"
    ? "forge heat · anvil evidence · quench safety · OMK control"
    : "route · verify · loop · control · evidence gated";
}

export function getActiveBrandHudStatus(): string {
  return activeBrandThemeName === "rust-forge" ? "OXIDIZED FORGE ONLINE" : "NEON GRID ONLINE";
}

export function getActiveBrandConsoleLine(): string {
  return activeBrandThemeName === "rust-forge"
    ? "Oxidized Forge Console // OMK independent control // heat anvil quench"
    : "Night City Ops Console // cyberpunk metrics wall";
}

/**
 * Unconditional truecolor SGR open sequence for a brand RGB value, produced
 * through the theme compiler (single SGR factory -- no escape literals here).
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
