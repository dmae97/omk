import test from "node:test";
import assert from "node:assert/strict";

const { GREEN_RAIN_THEME, SYSTEM24_THEME, resolveOmkBrandTheme, resolveTuiMotion, shouldUseAnsiColor } = await import("../dist/brand/theme.js");
const { OMK_MATRIX_ASCII_ART } = await import("../dist/brand/omk-matrix-art.js");

test("green-rain theme is OMK-native and evidence-oriented", () => {
  assert.equal(GREEN_RAIN_THEME.name, "green-rain");
  assert.equal(GREEN_RAIN_THEME.label, "OMK Green Rain");
  assert.match(GREEN_RAIN_THEME.tagline, /Provider-neutral agent control plane/);
  assert.match(GREEN_RAIN_THEME.motto, /Verify the evidence/);
  assert.equal(GREEN_RAIN_THEME.motion.rain, true);
  assert.equal(SYSTEM24_THEME.motion.rain, false);
});

test("brand resolver accepts green-rain aliases without changing the default", () => {
  assert.equal(resolveOmkBrandTheme(undefined).name, "system24");
  assert.equal(resolveOmkBrandTheme("system24").name, "system24");
  assert.equal(resolveOmkBrandTheme("green-rain").name, "green-rain");
  assert.equal(resolveOmkBrandTheme("green").name, "green-rain");
  assert.equal(resolveOmkBrandTheme("rain").name, "green-rain");
});

test("OMK ASCII art uses IP-safe Green Rain copy", () => {
  assert.match(OMK_MATRIX_ASCII_ART, /GREEN\s+RAIN\s+MODE/);
  assert.doesNotMatch(OMK_MATRIX_ASCII_ART, /THE\s+MATRIX/i);
});


test("resolveTuiMotion disables animation for CI and no-color terminals", () => {
  assert.equal(resolveTuiMotion({ CI: "true" }), "off");
  assert.equal(resolveTuiMotion({ NO_COLOR: "1", OMK_ANIMATION: "full" }), "off");
  assert.equal(resolveTuiMotion({ TERM: "dumb", OMK_ANIMATION: "full" }), "off");
  assert.equal(resolveTuiMotion({ OMK_ANIMATION: "low" }), "low");
  assert.equal(resolveTuiMotion({}), "auto");
});

test("shouldUseAnsiColor honors NO_COLOR and TERM=dumb", () => {
  assert.equal(shouldUseAnsiColor({}), true);
  assert.equal(shouldUseAnsiColor({ NO_COLOR: "1", FORCE_COLOR: "1" }), false);
  assert.equal(shouldUseAnsiColor({ TERM: "dumb", FORCE_COLOR: "1" }), false);
});
