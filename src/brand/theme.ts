import { P } from "./palette.js";
import { brandThemeRgbByRole, brandTruecolorSgr } from "./theme-compiled.js";
import type { BrandRgb } from "./theme-compiled.js";

/**
 * Truecolor SGR open sequence for a brand color, produced via the theme
 * compiler (compileTheme) — no raw escape literals in this file. Brand theme
 * constants stay truecolor on purpose for byte parity; tier-aware rendering
 * lives in src/brand/theme-compiled.ts (getCompiledBrandTheme).
 */
function fg(color: BrandRgb): string {
  return brandTruecolorSgr(color);
}

function rgb(r: number, g: number, b: number): string {
  return fg({ r, g, b });
}

function rustFg(role: string): string {
  return brandTruecolorSgr(brandThemeRgbByRole("rust-forge", role));
}

export type OmkBrandThemeName =
  | "system24"
  | "green-rain"
  | "neon-grid"
  | "rust-forge"
  | "plain"
  | "high-contrast"
  | "matrix";
export type OmkTuiMotion = "off" | "low" | "auto" | "full";

export interface OmkBrandTheme {
  name: OmkBrandThemeName;
  label: string;
  tagline: string;
  motto: string;
  symbols: {
    prompt: string;
    active: string;
    done: string;
    failed: string;
    pending: string;
    signal: string;
  };
  colors: {
    border: string;
    borderHot: string;
    text: string;
    muted: string;
    primary: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  motion: {
    rain: boolean;
    spinner: "braille" | "scanline" | "none";
  };
}

export const SYSTEM24_THEME: OmkBrandTheme = {
  name: "system24",
  label: "OMK System24",
  tagline: "OMK operator console for routed agent work.",
  motto: "Route the work. Verify the evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "▶",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "◆",
  },
  colors: {
    border: rgb(85, 85, 85),
    borderHot: rgb(140, 140, 140),
    text: rgb(242, 242, 242),
    muted: rgb(153, 153, 153),
    primary: rgb(167, 139, 250),
    success: rgb(102, 204, 153),
    warning: rgb(245, 191, 102),
    danger: rgb(242, 143, 143),
    info: rgb(102, 204, 217),
  },
  motion: {
    rain: false,
    spinner: "braille",
  },
};

export const GREEN_RAIN_THEME: OmkBrandTheme = {
  name: "green-rain",
  label: "OMK Green Rain",
  tagline: "Provider-neutral Green Rain signal console.",
  motto: "Follow the signal. Verify the evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "▶",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "◆",
  },
  colors: {
    border: fg(P.matrixDark),
    borderHot: fg(P.mint),
    text: fg(P.cream),
    muted: fg(P.gray),
    primary: fg(P.mint),
    success: fg(P.mint),
    warning: fg(P.orange),
    danger: fg(P.red),
    info: fg(P.blue),
  },
  motion: {
    rain: true,
    spinner: "scanline",
  },
};

export const NEON_GRID_THEME: OmkBrandTheme = {
  name: "neon-grid",
  label: "OMK//CONTROL",
  tagline: "OMK control plane for coding agents.",
  motto: "Route agents. Verify evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "●",
    done: "✓",
    failed: "✕",
    pending: "○",
    signal: "◇",
  },
  colors: {
    border: fg(P.gridLine),
    borderHot: fg(P.blue),
    text: fg(P.cream),
    muted: fg(P.gray),
    primary: fg(P.blue),
    success: fg(P.mint),
    warning: fg(P.orange),
    danger: fg(P.red),
    info: fg(P.blue),
  },
  motion: {
    rain: false,
    spinner: "scanline",
  },
};

export const RUST_FORGE_THEME: OmkBrandTheme = {
  name: "rust-forge",
  label: "OMK Rust Forge",
  tagline: "Oxidized forge console for OMK control.",
  motto: "Forge the route. Verify the evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "◉",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "▣",
  },
  colors: {
    border: rustFg("route.fallback"),
    borderHot: rustFg("control.accent"),
    text: rustFg("control.fg"),
    muted: rustFg("control.dim"),
    primary: rustFg("control.accent"),
    success: rustFg("evidence.pass"),
    warning: rustFg("telemetry.warn"),
    danger: rustFg("telemetry.error"),
    info: rustFg("route.active"),
  },
  motion: {
    rain: false,
    spinner: "braille",
  },
};

export const MATRIX_THEME: OmkBrandTheme = {
  name: "matrix",
  label: "OMK Matrix",
  tagline: "Matrix rain code console for OMK orchestration.",
  motto: "Follow the white rabbit. Verify the evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "⏵",
    done: "✓",
    failed: "✕",
    pending: "○",
    signal: "⏣",
  },
  colors: {
    border: rgb(0, 20, 0),
    borderHot: fg(P.matrixRainGreen),
    text: rgb(200, 255, 200),
    muted: fg(P.matrixRainDim),
    primary: fg(P.matrixRainGreen),
    success: fg(P.matrixRainGreen),
    warning: fg(P.matrixWarningAmber),
    danger: fg(P.matrixErrorRed),
    info: rgb(0, 200, 50),
  },
  motion: {
    rain: true,
    spinner: "scanline",
  },
};

export const PLAIN_THEME: OmkBrandTheme = {
  name: "plain",
  label: "OMK Plain",
  tagline: "OMK operator console.",
  motto: "Route the work. Verify the evidence. Control the loop.",
  symbols: {
    prompt: ">",
    active: ">",
    done: "ok",
    failed: "x",
    pending: "-",
    signal: "*",
  },
  colors: {
    border: "",
    borderHot: "",
    text: "",
    muted: "",
    primary: "",
    success: "",
    warning: "",
    danger: "",
    info: "",
  },
  motion: {
    rain: false,
    spinner: "none",
  },
};

export const HIGH_CONTRAST_THEME: OmkBrandTheme = {
  name: "high-contrast",
  label: "OMK High Contrast",
  tagline: "High-contrast OMK operator console.",
  motto: "Route the work. Verify the evidence. Control the loop.",
  symbols: {
    prompt: "›",
    active: "▶",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "◆",
  },
  colors: {
    border: rgb(210, 210, 210),
    borderHot: rgb(255, 255, 255),
    text: rgb(255, 255, 255),
    muted: rgb(210, 210, 210),
    primary: rgb(255, 255, 255),
    success: rgb(140, 255, 140),
    warning: rgb(255, 230, 120),
    danger: rgb(255, 120, 120),
    info: rgb(140, 220, 255),
  },
  motion: {
    rain: false,
    spinner: "braille",
  },
};

export function resolveOmkBrandTheme(name: string | undefined): OmkBrandTheme {
  const normalized = name?.trim().toLowerCase();
  if (
    normalized === "green-rain" ||
    normalized === "green" ||
    normalized === "phosphor"
  )
    return GREEN_RAIN_THEME;
  if (
    normalized === "matrix" ||
    normalized === "matrix-rain" ||
    normalized === "neo" ||
    normalized === "zion" ||
    normalized === "rain"
  )
    return MATRIX_THEME;
  if (
    normalized === "neon-grid" ||
    normalized === "neon" ||
    normalized === "grid" ||
    normalized === "control" ||
    normalized === "omk-control" ||
    normalized === "night-city" ||
    normalized === "night-city-ops" ||
    normalized === "metrics" ||
    normalized === "metrics-control" ||
    normalized === "cyberpunk"
  )
    return NEON_GRID_THEME;
  if (
    normalized === "rust-forge" ||
    normalized === "rust" ||
    normalized === "cargo" ||
    normalized === "oxide" ||
    normalized === "forge" ||
    normalized === "rust-native"
  )
    return RUST_FORGE_THEME;
  if (normalized === "plain") return PLAIN_THEME;
  if (normalized === "high-contrast" || normalized === "contrast")
    return HIGH_CONTRAST_THEME;
  return SYSTEM24_THEME;
}

export function shouldUseAnsiColor(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NO_COLOR !== undefined || env.TERM === "dumb") return false;
  return true;
}

export function resolveTuiMotion(
  env: NodeJS.ProcessEnv = process.env,
): OmkTuiMotion {
  if (
    env.NO_COLOR !== undefined ||
    env.CI === "true" ||
    env.CI === "1" ||
    env.TERM === "dumb"
  )
    return "off";
  const normalized = env.OMK_ANIMATION?.trim().toLowerCase();
  if (
    normalized === "off" ||
    normalized === "low" ||
    normalized === "auto" ||
    normalized === "full"
  )
    return normalized;
  return "auto";
}
