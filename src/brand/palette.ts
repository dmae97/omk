/**
 * OMK brand color palette -- compiled from active omk.theme.v1 documents
 * (theme contract T5b) plus conversion helpers.
 *
 * P and BRAND_HEX keep their public object shapes, but shared brand slots are
 * updated in place when setBrandPaletteTheme() switches the live brand theme.
 * Night-city remains the default and preserves the legacy RGB/HEX bytes.
 */

import {
  activeThemeHexByPrimitive,
  activeThemeHexByRole,
  activeThemeRgbByRole,
  getActiveBrandThemeName,
  rgbToHex,
  setActiveBrandTheme,
} from "./theme-compiled.js";
import type { BrandRgb, BrandThemeName } from "./theme-compiled.js";

export type { BrandRgb, BrandThemeName } from "./theme-compiled.js";

const rgb = (r: number, g: number, b: number): BrandRgb => ({ r, g, b });

type MutableBrandRgb = { r: number; g: number; b: number };

function rgbByPrimitive(primitive: string): BrandRgb {
  const parsed = hexToRgb(activeThemeHexByPrimitive(primitive));
  if (parsed === null) {
    throw new Error(`brand palette: active primitive "${primitive}" did not resolve to RGB`);
  }
  return parsed;
}

function isRustForgeActive(): boolean {
  return getActiveBrandThemeName() === "rust-forge";
}

export function buildBrandPalette() {
  const rustForge = isRustForgeActive();
  return {
    // Shared brand slots driven by active theme semantics.
    purple: activeThemeRgbByRole("control.accent"),
    lightPurple: rustForge ? activeThemeRgbByRole("route.fallback") : rgb(214, 108, 255),
    darkPurple: rustForge ? rgbByPrimitive("forge") : rgb(64, 18, 133),
    pink: rgbByPrimitive("magenta"),
    hotPink: rgbByPrimitive("magenta"),
    mint: activeThemeRgbByRole("evidence.pass"),
    darkMint: rgb(0, 196, 153),
    orange: activeThemeRgbByRole("route.fallback"),
    red: activeThemeRgbByRole("telemetry.error"),
    blue: activeThemeRgbByRole("route.active"),
    cream: activeThemeRgbByRole("control.fg"),
    dark: activeThemeRgbByRole("control.bg"),
    gray: activeThemeRgbByRole("control.dim"),
    skin: rgb(255, 214, 102),
    gridLine: rustForge ? rgbByPrimitive("slag") : rgb(34, 50, 74),

    // Rust forge family. Defaults stay legacy for night-city parity.
    rustOrange: rustForge ? activeThemeRgbByRole("route.active") : rgb(249, 115, 22),
    rustOxide: rustForge ? activeThemeRgbByRole("route.fallback") : rgb(124, 45, 18),
    rustEmber: rustForge ? activeThemeRgbByRole("telemetry.warn") : rgb(255, 122, 24),
    rustCrimson: rustForge ? activeThemeRgbByRole("telemetry.error") : rgb(255, 49, 93),
    cargoGreen: activeThemeRgbByRole("evidence.pass"),

    // Matrix family: signal slots follow active success/warn semantics; rain constants stay iconic.
    matrixGreen: activeThemeRgbByRole("evidence.pass"),
    matrixDark: rgb(8, 39, 31),
    matrixRainGreen: rgb(0, 255, 65),
    matrixDeepBg: rgb(0, 8, 0),
    matrixRainDim: rgb(0, 95, 25),
    matrixWarningAmber: activeThemeRgbByRole("telemetry.warn"),
    matrixErrorRed: rgb(255, 50, 50),

    // Sparkle ramp accents (decorative highlight ramps).
    sparkleWhite: rgb(244, 255, 255),
    sparkleGold: rgb(255, 209, 102),

    // Metrics theme constants (professional dashboard specialty palette).
    metricsCyan: rgb(6, 182, 212),
    metricsTeal: rgb(20, 184, 166),
    metricsNavy: rgb(10, 25, 41),
    metricsSlate: rgb(30, 41, 59),
    metricsSilver: rgb(203, 213, 225),
    metricsWhite: rgb(241, 245, 249),
    metricsAmber: rgb(245, 158, 11),
    metricsGreen: rgb(34, 197, 94),
    metricsRed: rgb(239, 68, 68),
    metricsBlue: rgb(59, 130, 246),
    metricsViolet: rgb(139, 92, 246),
  };
}

export type BrandPalette = ReturnType<typeof buildBrandPalette>;

export function buildBrandHex(palette: BrandPalette) {
  return {
    dark: activeThemeHexByRole("control.bg"),
    surface: activeThemeHexByPrimitive("surface"),
    cyan: activeThemeHexByRole("route.active"),
    mint: activeThemeHexByRole("evidence.pass"),
    magenta: activeThemeHexByPrimitive("magenta"),
    purple: activeThemeHexByRole("control.accent"),
    amber: activeThemeHexByRole("route.fallback"),
    red: activeThemeHexByRole("telemetry.error"),
    cream: activeThemeHexByRole("control.fg"),
    muted: activeThemeHexByPrimitive("muted"),
    gray: activeThemeHexByRole("control.dim"),
    gridLine: rgbToHex(palette.gridLine),
    sparkleWhite: rgbToHex(palette.sparkleWhite),
    sparkleGold: rgbToHex(palette.sparkleGold),
    rustEmber: rgbToHex(palette.rustEmber),
    rustCrimson: rgbToHex(palette.rustCrimson),
  };
}

export type BrandHex = ReturnType<typeof buildBrandHex>;

export const P: BrandPalette = buildBrandPalette();
export const BRAND_HEX: BrandHex = buildBrandHex(P);

function assignRgb(target: BrandRgb, next: BrandRgb): void {
  const mutable = target as MutableBrandRgb;
  mutable.r = next.r;
  mutable.g = next.g;
  mutable.b = next.b;
}

function updatePaletteInPlace(target: BrandPalette, next: BrandPalette): void {
  for (const key of Object.keys(next) as Array<keyof BrandPalette>) {
    assignRgb(target[key], next[key]);
  }
}

function updateHexInPlace(target: BrandHex, next: BrandHex): void {
  for (const key of Object.keys(next) as Array<keyof BrandHex>) {
    target[key] = next[key];
  }
}

export function setBrandPaletteTheme(name: string | undefined): BrandThemeName {
  const resolved = setActiveBrandTheme(name);
  updatePaletteInPlace(P, buildBrandPalette());
  updateHexInPlace(BRAND_HEX, buildBrandHex(P));
  return resolved;
}

export function resetBrandPaletteTheme(): BrandThemeName {
  return setBrandPaletteTheme("night-city");
}

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
