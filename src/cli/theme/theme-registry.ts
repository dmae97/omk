/**
 * CLI Theme — Built-in Theme Registry
 * Maps semantic tokens to ANSI colors. Reuses src/theme/colors.ts exports.
 */

import { style } from "../../theme/colors.js";

export type SemanticToken =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "agent"
  | "task"
  | "tool"
  | "header"
  | "subheader"
  | "dim"
  | "bold"
  | "reset"
  | "separator"
  | "bullet"
  | "labelKey"
  | "labelValue";

export interface ThemePalette {
  readonly name: string;
  readonly mode: "dark" | "light" | "auto" | "mono";
  readonly supportsColor: boolean;
  readonly render: (token: SemanticToken, text: string) => string;
}

// --- omk (full brand) ---

const omkPalette: ThemePalette = {
  name: "omk",
  mode: "dark",
  supportsColor: true,
  render(token, text) {
    switch (token) {
      case "success": return style.mint(text);
      case "warning": return style.orange(text);
      case "error": return style.red(text);
      case "info": return style.blue(text);
      case "agent": return style.purple(text);
      case "task": return style.pink(text);
      case "tool": return style.cyan(text);
      case "header": return style.purpleBold(text);
      case "subheader": return style.blueBold(text);
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.gray(text);
      case "bullet": return style.purple("• " + text);
      case "labelKey": return style.dim + text + style.reset;
      case "labelValue": return text;
      default: return text;
    }
  },
};

// --- night-city (README control image / Night City Ops Console) ---

const nightCityPalette: ThemePalette = {
  name: "night-city",
  mode: "dark",
  supportsColor: true,
  render(semantic, text) {
    switch (semantic) {
      case "success": return style.mintBold(text);
      case "warning": return style.orangeBold(text);
      case "error": return style.redBold(text);
      case "info": return style.blueBold(text);
      case "agent": return style.lightPurple(text);
      case "task": return style.pink(text);
      case "tool": return style.mint(text);
      case "header": return style.blueBold(text);
      case "subheader": return style.mintBold(text);
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.gray(text);
      case "bullet": return style.blue("◇ " + text);
      case "labelKey": return style.gray(text);
      case "labelValue": return style.cream(text);
      default: return text;
    }
  },
};

// --- green-rain (phosphor signal console) ---

const greenRainPalette: ThemePalette = {
  name: "green-rain",
  mode: "dark",
  supportsColor: true,
  render(semantic, text) {
    switch (semantic) {
      case "success": return style.phosphorBold(text);
      case "warning": return style.orange(text);
      case "error": return style.red(text);
      case "info": return style.phosphor(text);
      case "agent": return style.phosphorBold(text);
      case "task": return style.phosphor(text);
      case "tool": return style.blue(text);
      case "header": return style.phosphorBold(text);
      case "subheader": return style.phosphor(text);
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.matrixDark(text);
      case "bullet": return style.phosphor("◆ " + text);
      case "labelKey": return style.dim + text + style.reset;
      case "labelValue": return style.phosphor(text);
      default: return text;
    }
  },
};

// --- matrix (iconic Matrix rain code console) ---

const matrixPalette: ThemePalette = {
  name: "matrix",
  mode: "dark",
  supportsColor: true,
  render(semantic, text) {
    switch (semantic) {
      case "success": return style.rainGreenBold(text);
      case "warning": return style.rainWarning(text);
      case "error": return style.rainError(text);
      case "info": return style.rainGreenDim(text);
      case "agent": return style.rainGreenBold(text);
      case "task": return style.rainGreen(text);
      case "tool": return style.rainGreenDim(text);
      case "header": return style.rainGreenBold(text);
      case "subheader": return style.rainGreen(text);
      case "dim": return style.rainGreenDim(text);
      case "bold": return style.rainGreenBold(text);
      case "reset": return style.reset + text;
      case "separator": return style.rainGreenDim(text);
      case "bullet": return style.rainGreen("├─ " + text);
      case "labelKey": return style.rainGreenDim(text);
      case "labelValue": return style.rainGreen(text);
      default: return style.rainGreen(text);
    }
  },
};

// --- neon-circuit (high-energy neon terminal palette) ---

const neonCircuitPalette: ThemePalette = {
  name: "neon-circuit",
  mode: "dark",
  supportsColor: true,
  render(semantic, text) {
    switch (semantic) {
      case "success": return style.mint(text);
      case "warning": return style.skin(text);
      case "error": return style.hotPink(text);
      case "info": return style.cyanBold(text);
      case "agent": return style.purpleBold(text);
      case "task": return style.pinkBold(text);
      case "tool": return style.cyan(text);
      case "header": return style.pinkBold(text);
      case "subheader": return style.lightPurple(text);
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.gray(text);
      case "bullet": return style.pink("⟐ " + text);
      case "labelKey": return style.gray(text);
      case "labelValue": return style.cream(text);
      default: return text;
    }
  },
};

// --- rust-forge (Rust/native safety console) ---

const rustForgePalette: ThemePalette = {
  name: "rust-forge",
  mode: "dark",
  supportsColor: true,
  render(semantic, text) {
    switch (semantic) {
      case "success": return style.cargoGreen(text);
      case "warning": return style.orangeBold(text);
      case "error": return style.redBold(text);
      case "info": return style.rustBold(text);
      case "agent": return style.rust(text);
      case "task": return style.cream(text);
      case "tool": return style.cargoGreen(text);
      case "header": return style.rustBold(text);
      case "subheader": return style.cargoGreen(text);
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.rustOxide(text);
      case "bullet": return style.rust("▣ " + text);
      case "labelKey": return style.gray(text);
      case "labelValue": return style.cream(text);
      default: return text;
    }
  },
};

// --- minimal (basic ANSI, no brand colors) ---

const minimalPalette: ThemePalette = {
  name: "minimal",
  mode: "auto",
  supportsColor: true,
  render(token, text) {
    switch (token) {
      case "success": return style.bold + text + style.reset;
      case "warning": return text;
      case "error": return text;
      case "info": return text;
      case "agent": return text;
      case "task": return text;
      case "tool": return text;
      case "header": return style.bold + text + style.reset;
      case "subheader": return style.bold + text + style.reset;
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return text;
      case "bullet": return "- " + text;
      case "labelKey": return style.dim + text + style.reset;
      case "labelValue": return text;
      default: return text;
    }
  },
};

// --- mono (no color at all) ---

const monoPalette: ThemePalette = {
  name: "mono",
  mode: "mono",
  supportsColor: false,
  render(_token, text) {
    return text;
  },
};

// --- dark (generic dark terminal) ---

const darkPalette: ThemePalette = {
  name: "dark",
  mode: "dark",
  supportsColor: true,
  render(token, text) {
    switch (token) {
      case "success": return style.green(text);
      case "warning": return style.amber(text);
      case "error": return style.metricsRed(text);
      case "info": return style.blue(text);
      case "agent": return style.violet(text);
      case "task": return style.cyan(text);
      case "tool": return style.silver(text);
      case "header": return style.whiteBold(text);
      case "subheader": return style.bold + text + style.reset;
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.gray(text);
      case "bullet": return style.dim + "• " + text + style.reset;
      case "labelKey": return style.dim + text + style.reset;
      case "labelValue": return text;
      default: return text;
    }
  },
};

// --- light (generic light terminal) ---

const lightPalette: ThemePalette = {
  name: "light",
  mode: "light",
  supportsColor: true,
  render(token, text) {
    // On light backgrounds, use darker/more saturated variants
    switch (token) {
      case "success": return style.greenBold(text);
      case "warning": return style.amberBold(text);
      case "error": return style.metricsRedBold(text);
      case "info": return style.blueBold(text);
      case "agent": return style.purpleBold(text);
      case "task": return style.cyanBold(text);
      case "tool": return style.slate(text);
      case "header": return style.navy(text);
      case "subheader": return style.bold + text + style.reset;
      case "dim": return style.dim + text + style.reset;
      case "bold": return style.bold + text + style.reset;
      case "reset": return style.reset + text;
      case "separator": return style.gray(text);
      case "bullet": return style.dim + "• " + text + style.reset;
      case "labelKey": return style.dim + text + style.reset;
      case "labelValue": return text;
      default: return text;
    }
  },
};

const registry = new Map<string, ThemePalette>([
  ["omk", omkPalette],
  ["night-city", nightCityPalette],
  ["night-city-ops", nightCityPalette],
  ["omk-control", nightCityPalette],
  ["neon-grid", nightCityPalette],
  ["metrics-control", nightCityPalette],
  ["green-rain", greenRainPalette],
  ["matrix", matrixPalette],
  ["matrix-rain", matrixPalette],
  ["neo", matrixPalette],
  ["zion", matrixPalette],
  ["rain", matrixPalette],
  ["rust-forge", rustForgePalette],
  ["rust", rustForgePalette],
  ["cargo", rustForgePalette],
  ["oxide", rustForgePalette],
  ["forge", rustForgePalette],
  ["rust-native", rustForgePalette],
  ["neon-circuit", neonCircuitPalette],
  ["minimal", minimalPalette],
  ["mono", monoPalette],
  ["dark", darkPalette],
  ["light", lightPalette],
]);

export function getBuiltinTheme(name: string): ThemePalette | undefined {
  return registry.get(name);
}

export function listBuiltinThemes(): readonly string[] {
  return Array.from(registry.keys());
}

export function registerBuiltinTheme(name: string, palette: ThemePalette): void {
  registry.set(name, palette);
}

/**
 * Render a color swatch preview bar for a theme.
 * Shows success/warning/error/agent/header colors in labeled blocks.
 */
export function renderThemePreview(palette: ThemePalette, label?: string): string {
  const name = label ?? palette.name;
  const modeBadge = palette.mode === "mono" ? "[mono]" : palette.mode === "light" ? "[light]" : palette.mode === "dark" ? "[dark]" : "[auto]";
  const lines: string[] = [];

  // Header line with theme name and mode
  const headerLine = palette.render("header", `  ${name} ${modeBadge}`);
  lines.push(headerLine);

  // Color swatch tokens to display
  const swatchTokens: { token: SemanticToken; label: string }[] = [
    { token: "success", label: "success" },
    { token: "warning", label: "warning" },
    { token: "error", label: "error" },
    { token: "agent", label: "agent" },
    { token: "header", label: "header" },
  ];

  // Render each swatch as: label  ████████ colorSample
  for (const { token, label: tokenLabel } of swatchTokens) {
    const coloredBar = palette.render(token, "████████");
    const labelText = palette.render("dim", tokenLabel.padEnd(9));
    lines.push(`    ${labelText} ${coloredBar}`);
  }

  return lines.join("\n");
}

/**
 * Render all built-in themes as color swatch previews.
 */
export function renderAllThemePreviews(): string {
  const unique = new Map<string, ThemePalette>();
  for (const [, p] of registry) {
    if (!unique.has(p.name)) unique.set(p.name, p);
  }
  const lines: string[] = [];
  for (const [name, palette] of unique) {
    lines.push(renderThemePreview(palette, name));
    lines.push("");
  }
  return lines.filter((l, i, arr) => !(l === "" && i === arr.length - 1)).join("\n");
}

export { registry as __registry };
