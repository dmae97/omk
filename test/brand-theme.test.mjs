import test from "node:test";
import assert from "node:assert/strict";

const {
  GREEN_RAIN_THEME,
  NEON_GRID_THEME,
  RUST_FORGE_THEME,
  SYSTEM24_THEME,
  resolveOmkBrandTheme,
  resolveTuiMotion,
  shouldUseAnsiColor,
} = await import("../dist/brand/theme.js");
const { OMK_MATRIX_ASCII_ART } =
  await import("../dist/brand/omk-matrix-art.js");

test("green-rain theme is OMK-native and evidence-oriented", () => {
  assert.equal(GREEN_RAIN_THEME.name, "green-rain");
  assert.equal(GREEN_RAIN_THEME.label, "OMK Green Rain");
  assert.match(
    GREEN_RAIN_THEME.tagline,
    /Provider-neutral Green Rain signal console/,
  );
  assert.match(GREEN_RAIN_THEME.motto, /Follow the signal/);
  assert.match(GREEN_RAIN_THEME.motto, /Verify the evidence/);
  assert.equal(GREEN_RAIN_THEME.motion.rain, true);
  assert.equal(SYSTEM24_THEME.motion.rain, false);
});

test("neon-grid theme defines OMK Control visual language", () => {
  assert.equal(NEON_GRID_THEME.name, "neon-grid");
  assert.equal(NEON_GRID_THEME.label, "PI+OMK//CONTROL");
  assert.match(NEON_GRID_THEME.tagline, /PI\+OMK control plane/);
  assert.match(NEON_GRID_THEME.motto, /Control the loop/);
  assert.equal(NEON_GRID_THEME.symbols.active, "●");
  assert.match(NEON_GRID_THEME.colors.info, /38;2;0;214;255m/);
  assert.equal(NEON_GRID_THEME.motion.rain, false);
});

test("rust-forge theme defines Rust-native OMK safety visuals", () => {
  assert.equal(RUST_FORGE_THEME.name, "rust-forge");
  assert.equal(RUST_FORGE_THEME.label, "OMK Rust Forge");
  assert.match(RUST_FORGE_THEME.tagline, /Rust-native safety console/);
  assert.match(RUST_FORGE_THEME.motto, /Forge native checks/);
  assert.match(RUST_FORGE_THEME.colors.primary, /38;2;249;115;22m/);
  assert.match(RUST_FORGE_THEME.colors.border, /38;2;124;45;18m/);
  assert.equal(RUST_FORGE_THEME.motion.rain, false);
});

test("brand resolver accepts green-rain, matrix, neon-grid, and rust-forge aliases without changing the default", () => {
  assert.equal(resolveOmkBrandTheme(undefined).name, "system24");
  assert.equal(resolveOmkBrandTheme("system24").name, "system24");
  assert.equal(resolveOmkBrandTheme("green-rain").name, "green-rain");
  assert.equal(resolveOmkBrandTheme("green").name, "green-rain");
  assert.equal(resolveOmkBrandTheme("phosphor").name, "green-rain");
  assert.equal(resolveOmkBrandTheme("rain").name, "matrix");
  assert.equal(resolveOmkBrandTheme("matrix").name, "matrix");
  assert.equal(resolveOmkBrandTheme("matrix-rain").name, "matrix");
  assert.equal(resolveOmkBrandTheme("neo").name, "matrix");
  assert.equal(resolveOmkBrandTheme("zion").name, "matrix");
  assert.equal(resolveOmkBrandTheme("neon-grid").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("neon").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("control").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("omk-control").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("night-city").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("metrics-control").name, "neon-grid");
  assert.equal(resolveOmkBrandTheme("rust-forge").name, "rust-forge");
  assert.equal(resolveOmkBrandTheme("rust").name, "rust-forge");
  assert.equal(resolveOmkBrandTheme("cargo").name, "rust-forge");
  assert.equal(resolveOmkBrandTheme("oxide").name, "rust-forge");
  assert.equal(resolveOmkBrandTheme("forge").name, "rust-forge");
  assert.equal(resolveOmkBrandTheme("plain").name, "plain");
  assert.equal(resolveOmkBrandTheme("high-contrast").name, "high-contrast");
  assert.equal(resolveOmkBrandTheme("contrast").name, "high-contrast");
});

test("OMK ASCII art uses IP-safe Green Rain copy", () => {
  assert.match(OMK_MATRIX_ASCII_ART, /GREEN\s+RAIN\s+MODE/);
  assert.match(OMK_MATRIX_ASCII_ART, /NIGHT\s+CITY\s+OPS/);
  assert.match(OMK_MATRIX_ASCII_ART, /SKILLS:\s+bound/);
  assert.match(OMK_MATRIX_ASCII_ART, /TOKENS:\s+hot/);
  assert.doesNotMatch(OMK_MATRIX_ASCII_ART, /THE\s+MATRIX/i);
});

test("resolveTuiMotion disables animation for CI and no-color terminals", () => {
  assert.equal(resolveTuiMotion({ CI: "true" }), "off");
  assert.equal(
    resolveTuiMotion({ NO_COLOR: "1", OMK_ANIMATION: "full" }),
    "off",
  );
  assert.equal(
    resolveTuiMotion({ TERM: "dumb", OMK_ANIMATION: "full" }),
    "off",
  );
  assert.equal(resolveTuiMotion({ OMK_ANIMATION: "low" }), "low");
  assert.equal(resolveTuiMotion({}), "auto");
});

test("shouldUseAnsiColor honors NO_COLOR and TERM=dumb", () => {
  assert.equal(shouldUseAnsiColor({}), true);
  assert.equal(shouldUseAnsiColor({ NO_COLOR: "1", FORCE_COLOR: "1" }), false);
  assert.equal(shouldUseAnsiColor({ TERM: "dumb", FORCE_COLOR: "1" }), false);
});
