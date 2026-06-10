import test from "node:test";
import assert from "node:assert/strict";

import { emoji, omkCliHero, panel, sanitizeTerminalText, stripBrokenAnsi } from "../dist/util/theme.js";
import { getBuiltinTheme, listBuiltinThemes } from "../dist/cli/theme/theme-registry.js";
import { OMK_SIMPLE_ASCII_ART } from "../dist/kimi/simple-art.js";

test("OMK CLI hero uses the compact control-plane theme", () => {
  const hero = omkCliHero();

  const cleanHero = sanitizeTerminalText(hero);
  assert.match(cleanHero, /OMK/);
  assert.match(cleanHero, /open-multi-agent-kit/i);
  assert.match(cleanHero, /cyberpunk metrics wall/i);
  assert.match(cleanHero, /goal-scoped MCP .* skills .* hooks/i);
  assert.match(cleanHero, /\[METRICS\]/);
  assert.match(cleanHero, /\[AGENTS\]/);

  const artLines = OMK_SIMPLE_ASCII_ART.split("\n");

  assert.equal(artLines.length <= 5, true);
  assert.equal(artLines.every((line) => line.length <= 36), true);
  assert.match(hero, /OMK\/\/CONTROL/);
  assert.match(cleanHero, /___\s+__\s+__/);
  assert.match(OMK_SIMPLE_ASCII_ART, /OMK\/\/CONTROL/);
  assert.match(OMK_SIMPLE_ASCII_ART, /ROUTE\s+│ VERIFY/);
  assert.match(OMK_SIMPLE_ASCII_ART, /TOKENS\s+│ AGENTS/);
  assert.doesNotMatch(OMK_SIMPLE_ASCII_ART, /kimi❯|hoodie|chocomint/i);
});

test("CLI theme registry exposes researched OMK control palettes", () => {
  const themes = listBuiltinThemes();

  assert.ok(themes.includes("night-city"));
  assert.ok(themes.includes("night-city-ops"));
  assert.ok(themes.includes("omk-control"));
  assert.ok(themes.includes("neon-grid"));
  assert.ok(themes.includes("metrics-control"));
  assert.ok(themes.includes("green-rain"));
  assert.ok(themes.includes("rust-forge"));
  assert.ok(themes.includes("rust"));
  assert.ok(themes.includes("cargo"));
  assert.ok(themes.includes("neon-circuit"));
  assert.equal(getBuiltinTheme("night-city")?.mode, "dark");
  assert.equal(getBuiltinTheme("neon-grid"), getBuiltinTheme("night-city"));
  assert.equal(getBuiltinTheme("metrics-control"), getBuiltinTheme("night-city"));
  assert.equal(getBuiltinTheme("green-rain")?.mode, "dark");
  assert.equal(getBuiltinTheme("rust"), getBuiltinTheme("rust-forge"));
  assert.equal(getBuiltinTheme("cargo"), getBuiltinTheme("rust-forge"));
});

test("Rust-native accent styles are exposed for terminal theme surfaces", async () => {
  const { P, style } = await import("../dist/theme/index.js");
  assert.deepEqual(P.rustOrange, { r: 249, g: 115, b: 22 });
  assert.deepEqual(P.rustOxide, { r: 124, g: 45, b: 18 });
  assert.equal(typeof style.rust, "function");
  assert.equal(typeof style.rustBold, "function");
  assert.equal(style.rust("native").includes("native"), true);
});

test("theme style builders sanitize wrapped text and reject unsafe ANSI codes", async () => {
  const unsafe = "safe\x1b]52;c;copied\x07\x1b[31mred\x00";
  const theme = await import("../dist/theme/index.js");
  const utilTheme = await import("../dist/util/theme.js");
  const ansi = await import("../dist/theme/ansi.js");

  assert.equal(theme.sanitizeTerminalText(theme.style.blue(unsafe)), "safered");
  assert.equal(utilTheme.sanitizeTerminalText(utilTheme.style.blue(unsafe)), "safered");

  const previousForceColor = process.env.FORCE_COLOR;
  const previousNoColor = process.env.NO_COLOR;
  const previousTerm = process.env.TERM;
  try {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    assert.equal(ansi.esc("31"), "\x1b[31m");
    assert.equal(ansi.esc("31m\x1b]0;bad"), "");
  } finally {
    if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previousForceColor;
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  }
});

test("control glyph kit uses operations language instead of mascot labels", () => {
  assert.equal(emoji.node, "◉");
  assert.equal(emoji.route, "◬");
  assert.equal(emoji.signal, "◎");
  assert.equal(Object.hasOwn(emoji, "cat"), false);
  assert.equal(Object.hasOwn(emoji, "candy"), false);
  assert.equal(Object.hasOwn(emoji, "flower"), false);
});

test("terminal text sanitizer strips control sequences from display values", () => {
  const unsafe = "safe\x1b]52;c;copied\x07\x1b[31mred\x00";

  assert.equal(sanitizeTerminalText(unsafe), "safered");
});

test("terminal text sanitizer strips broken ANSI fragments", () => {
  const unsafe = "safe[38;2;0;50;0mred[0m[38;2;0;69;4mgreen";

  assert.equal(stripBrokenAnsi(unsafe), "saferedgreen");
  assert.equal(sanitizeTerminalText(unsafe), "saferedgreen");
});

test("sanitizeTerminalText strips standalone ::code-comment directives", () => {
  const raw = "line1\n::code-comment{some note}\nline2\n::code-comment{another}\t \nline3";

  assert.equal(sanitizeTerminalText(raw), "line1\nline2\nline3");
});

test("panel sanitizes title before gradient rendering and width math", () => {
  const output = panel(["  body"], "S[38;2;0;50;0mIGNAL[0m");

  assert.match(output, /SIGNAL/);
  assert.doesNotMatch(output, /(?<!\x1b)\[(?:38|48);2;|(?<!\x1b)\[0m/);
});

test("rust-forge.theme.json validates as omk.theme.v1 and compiles for all tiers", async () => {
  const { readFile } = await import("node:fs/promises");
  const { validateThemeDocument } = await import("../dist/cli/theme/theme-doc.js");
  const { compileTheme } = await import("../dist/cli/theme/render-table.js");

  const doc = JSON.parse(
    await readFile(new URL("../themes/rust-forge.theme.json", import.meta.url), "utf8"),
  );

  const errors = validateThemeDocument(doc);
  assert.equal(errors.length, 0, `validation errors: ${errors.join("; ")}`);

  for (const tier of ["truecolor", "256", "16", "no-color"]) {
    const compiled = compileTheme(doc, tier);
    assert.equal(compiled.name, "rust-forge");
    assert.equal(compiled.tokens["control.accent"].role, "control.accent");
    assert.equal(compiled.surfaces.statusCard.border.role, "control.accent");
    assert.equal(compiled.surfaces.forgeConsole.heat.role, "forge.heat");
    assert.equal(compiled.surfaces.forgeConsole.quench.role, "forge.quench");
  }
});

test("rust-forge compiled palette passes WCAG contrast gates", async () => {
  const { readFile } = await import("node:fs/promises");
  const { execSync } = await import("node:child_process");

  const output = execSync("npm run theme:check", {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert.match(output, /rust-forge: 100 pairs checked, 0 failed/);
});
