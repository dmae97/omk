#!/usr/bin/env node
/**
 * T5b visual-parity capture — renders representative cockpit/renderer frames
 * deterministically (fixed clock, animation off, color forced) and prints the
 * raw bytes JSON-escaped so before/after migration output can be diffed.
 *
 * Usage: node proof/theme-2026-06-10/capture-frame.mjs > capture.txt
 */
process.env.OMK_ANIMATION = "off";
delete process.env.NO_COLOR;
process.env.FORCE_COLOR = "1";
process.env.COLORTERM = "truecolor";

const FIXED_NOW = 1760000000000;
Date.now = () => FIXED_NOW;

const out = [];
const fakeStream = {
  chunks: out,
  write(chunk) {
    out.push(chunk);
    return true;
  },
  isTTY: true,
  columns: 80,
  rows: 24,
};

const { NeonGridRenderer } = await import("../../dist/cli/ui/neon-grid-renderer.js");
const { GreenRainRenderer } = await import("../../dist/cli/ui/green-rain-renderer.js");
const { RustForgeRenderer } = await import("../../dist/cli/ui/rust-forge-renderer.js");
const brand = await import("../../dist/brand/theme.js");
const { renderOmkSparkleText } = await import("../../dist/ui/omk-sigil.js");

const event = {
  type: "session:start",
  runId: "abc1234def",
  provider: "mimo",
  model: "mimo-v2.5-pro",
  root: "/tmp/omk-parity",
};

function capture(label, fn) {
  out.length = 0;
  fn();
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(out.join("")));
}

capture("neon-grid session:start header", () => {
  const r = new NeonGridRenderer({ stdout: fakeStream, stderr: fakeStream });
  r.emit(event);
});

capture("green-rain session:start header", () => {
  const r = new GreenRainRenderer({ stdout: fakeStream, stderr: fakeStream });
  r.emit(event);
});

capture("rust-forge session:start header", () => {
  const r = new RustForgeRenderer({ stdout: fakeStream, stderr: fakeStream });
  r.emit(event);
});

console.log("=== cockpit sparkle title (fixed frame 42) ===");
console.log(
  JSON.stringify(
    renderOmkSparkleText("◢█ OMK//CONTROL COCKPIT █◣", { frame: 42 }),
  ),
);

console.log("=== brand theme color SGR bytes ===");
for (const themeName of [
  "SYSTEM24_THEME",
  "GREEN_RAIN_THEME",
  "NEON_GRID_THEME",
  "RUST_FORGE_THEME",
  "MATRIX_THEME",
  "PLAIN_THEME",
  "HIGH_CONTRAST_THEME",
]) {
  const theme = brand[themeName];
  console.log(themeName, JSON.stringify(theme.colors));
}
