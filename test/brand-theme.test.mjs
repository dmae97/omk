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
  assert.equal(NEON_GRID_THEME.label, "OMK//CONTROL");
  assert.match(NEON_GRID_THEME.tagline, /OMK control plane/);
  assert.match(NEON_GRID_THEME.motto, /Control the loop/);
  assert.equal(NEON_GRID_THEME.symbols.active, "●");
  assert.match(NEON_GRID_THEME.colors.info, /38;2;0;214;255m/);
  assert.equal(NEON_GRID_THEME.motion.rain, false);
});

test("rust-forge theme defines oxidized OMK control visuals", () => {
  assert.equal(RUST_FORGE_THEME.name, "rust-forge");
  assert.equal(RUST_FORGE_THEME.label, "OMK Rust Forge");
  assert.match(RUST_FORGE_THEME.tagline, /Oxidized forge console/);
  assert.match(RUST_FORGE_THEME.tagline, /standalone OMK control/);
  assert.match(RUST_FORGE_THEME.motto, /OMK controls the loop/);
  assert.match(RUST_FORGE_THEME.colors.primary, /38;2;255;106;61m/);
  assert.match(RUST_FORGE_THEME.colors.border, /38;2;224;138;75m/);
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

// ── Theme contract T5b: brand colors are compiled from the night-city theme ──

test("brand palette night-city entries are theme-derived (compiled, not hardcoded)", async () => {
  const { P, BRAND_HEX } = await import("../dist/brand/palette.js");
  const { NIGHT_CITY_THEME, nightCityRgb } = await import("../dist/brand/theme-compiled.js");

  assert.equal(NIGHT_CITY_THEME.schemaVersion, "omk.theme.v1");
  assert.equal(NIGHT_CITY_THEME.name, "night-city");

  // P entries that map to night-city primitives must equal the compiled values.
  assert.deepEqual(P.blue, nightCityRgb("cyan"));
  assert.deepEqual(P.mint, nightCityRgb("mint"));
  assert.deepEqual(P.pink, nightCityRgb("magenta"));
  assert.deepEqual(P.purple, nightCityRgb("purple"));
  assert.deepEqual(P.orange, nightCityRgb("amber"));
  assert.deepEqual(P.red, nightCityRgb("red"));
  assert.deepEqual(P.cream, nightCityRgb("cream"));
  assert.deepEqual(P.dark, nightCityRgb("dark"));
  assert.deepEqual(P.gray, nightCityRgb("gray"));

  // BRAND_HEX exposes canonical hex strings for every required primitive.
  for (const name of ["dark", "cyan", "mint", "magenta", "purple", "amber", "red", "cream", "gray"]) {
    assert.match(BRAND_HEX[name], /^#[0-9A-F]{6}$/, `BRAND_HEX.${name} should be canonical hex`);
    assert.equal(BRAND_HEX[name], NIGHT_CITY_THEME.primitives[name].toUpperCase());
  }
});

test("brand theme SGR sequences come from the theme compiler and keep legacy bytes", async () => {
  const { compileTheme } = await import("../dist/cli/theme/render-table.js");
  const { NIGHT_CITY_THEME, brandTruecolorSgr } = await import("../dist/brand/theme-compiled.js");
  const compiled = compileTheme(NIGHT_CITY_THEME, "truecolor");

  // NEON_GRID info/primary = night-city cyan = route.active token at truecolor.
  assert.equal(NEON_GRID_THEME.colors.info, compiled.tokens["route.active"].sgr);
  assert.equal(GREEN_RAIN_THEME.colors.success, compiled.tokens["evidence.pass"].sgr);
  assert.equal(NEON_GRID_THEME.colors.text, compiled.tokens["control.fg"].sgr);
  assert.equal(NEON_GRID_THEME.colors.muted, compiled.tokens["control.dim"].sgr);

  // The single SGR factory emits classic truecolor bytes.
  assert.equal(brandTruecolorSgr({ r: 0, g: 214, b: 255 }), "\u001b[38;2;0;214;255m");
});

test("night-city snapshot stays in sync with themes/night-city.theme.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const snapshot = JSON.parse(
    await readFile(new URL("../src/brand/night-city.theme.json", import.meta.url), "utf8"),
  );
  const canonical = JSON.parse(
    await readFile(new URL("../themes/night-city.theme.json", import.meta.url), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, "omk.theme.v1");
  // Every primitive present in both documents must agree — a hex change in
  // themes/ requires refreshing the src/brand snapshot (cp themes/night-city.theme.json src/brand/).
  for (const [name, hex] of Object.entries(snapshot.primitives)) {
    if (name in canonical.primitives) {
      assert.equal(
        hex.toUpperCase(),
        canonical.primitives[name].toUpperCase(),
        `primitive "${name}" drifted — refresh src/brand/night-city.theme.json from themes/`,
      );
    }
  }
});

test("rust-forge snapshot stays in sync with themes/rust-forge.theme.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const snapshot = await readFile(new URL("../src/brand/rust-forge.theme.json", import.meta.url), "utf8");
  const canonical = await readFile(new URL("../themes/rust-forge.theme.json", import.meta.url), "utf8");
  assert.equal(snapshot, canonical, "refresh src/brand/rust-forge.theme.json from themes/rust-forge.theme.json");
});

test("active brand palette can switch to rust-forge and back without replacing exports", async () => {
  const { P, BRAND_HEX, setBrandPaletteTheme } = await import("../dist/brand/palette.js");
  const { getActiveBrandThemeName, RUST_FORGE_THEME: COMPILED_RUST_FORGE_THEME } =
    await import("../dist/brand/theme-compiled.js");
  const pRef = P;
  const hexRef = BRAND_HEX;
  const original = {
    blue: { ...P.blue },
    mintHex: BRAND_HEX.mint,
    rustOrange: { ...P.rustOrange },
  };

  assert.equal(setBrandPaletteTheme("rust-forge"), "rust-forge");
  assert.equal(getActiveBrandThemeName(), "rust-forge");
  assert.equal(P, pRef);
  assert.equal(BRAND_HEX, hexRef);
  assert.deepEqual(P.blue, { r: 255, g: 106, b: 61 });
  assert.deepEqual(P.rustOrange, { r: 255, g: 106, b: 61 });
  assert.equal(BRAND_HEX.mint, COMPILED_RUST_FORGE_THEME.primitives.oxide.toUpperCase());
  assert.equal(BRAND_HEX.magenta, COMPILED_RUST_FORGE_THEME.primitives.rust.toUpperCase());

  assert.equal(setBrandPaletteTheme("night-city"), "night-city");
  assert.equal(getActiveBrandThemeName(), "night-city");
  assert.equal(P, pRef);
  assert.equal(BRAND_HEX, hexRef);
  assert.deepEqual(P.blue, original.blue);
  assert.deepEqual(P.rustOrange, original.rustOrange);
  assert.equal(BRAND_HEX.mint, original.mintHex);
});
