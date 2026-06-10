#!/usr/bin/env node
/**
 * theme:check — contrast gate for omk.theme.v1 documents.
 *
 * For every declared (foreground role x background) pair, computes WCAG 2.x
 * contrast ratio and gates it:
 *   usage "text"      -> CR >= 4.5
 *   usage "indicator" -> CR >= 3.0  (glyphs, large text, borders; WCAG 1.4.11)
 * Also re-runs the gates for the hand-authored 16-color tier against the
 * standard VGA palette, gates the 256 tier by quantizing each pair through
 * the same OKLab nearest-neighbor mapping the runtime uses (xterm 16-255
 * only: 6x6x6 cube levels [0,95,135,175,215,255] + grayscale ramp 8+10n),
 * and validates the structural theme contract
 * (mandatory glyphs on states, primitive-only references, fallback coverage).
 *
 * Failures suggest an OKLCH lightness adjustment (hue held, L moved) and exit 1.
 * Usage: node scripts/theme-check.mjs [--out <dir>] [--self-test]
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : "proof/theme-check";
const selfTest = args.includes("--self-test");

const GATES = { text: 4.5, indicator: 3.0 };

// Standard VGA palette for the 16-color tier (xterm defaults; indexes 0-15).
const VGA = {
  black: "#000000", red: "#AA0000", green: "#00AA00", yellow: "#AA5500",
  blue: "#0000AA", magenta: "#AA00AA", cyan: "#00AAAA", white: "#AAAAAA",
  brightBlack: "#555555", brightRed: "#FF5555", brightGreen: "#55FF55",
  brightYellow: "#FFFF55", brightBlue: "#5555FF", brightMagenta: "#FF55FF",
  brightCyan: "#55FFFF", brightWhite: "#FFFFFF",
};

// ── WCAG 2.x math ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16) / 255);
}
const linearize = (c) => (c <= 0.04045 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4));
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fgHex, bgHex) {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ── OKLab / OKLCH (Björn Ottosson) — for hue-preserving lightness repair ───
function srgbToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
function oklabToSrgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * (c <= 0 ? 0 : c ** (1 / 2.4)) - 0.055;
    return Math.min(1, Math.max(0, v));
  });
}
const inGamut = ({ L, a, b }) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
};
const toHex = (rgb) =>
  `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0").toUpperCase()).join("")}`;

/**
 * Hue-preserving repair: hold OKLCH hue h, move lightness L (toward contrast),
 * shrinking chroma C only as much as gamut requires at each step.
 */
function adjustForContrast(fgHex, bgHex, gate) {
  const lab = srgbToOklab(fgHex);
  const C = Math.hypot(lab.a, lab.b);
  const h = Math.atan2(lab.b, lab.a);
  const bgLighter = luminance(bgHex) > luminance(fgHex);
  const dir = bgLighter ? -1 : 1; // dark bg -> raise L; light bg -> lower L
  for (let step = 0.005; step <= 0.6; step += 0.005) {
    const L = lab.L + dir * step;
    if (L <= 0 || L >= 1) break;
    let c = C;
    let candidate = { L, a: c * Math.cos(h), b: c * Math.sin(h) };
    while (!inGamut(candidate) && c > 0.001) {
      c -= 0.005;
      candidate = { L, a: c * Math.cos(h), b: c * Math.sin(h) };
    }
    const hex = toHex(oklabToSrgb(candidate));
    if (contrast(hex, bgHex) >= gate) return hex;
  }
  return null;
}

// ── xterm-256 quantization (OKLab NN, indexes 16-255 only) ─────────────────
// Mirrors src/cli/theme/oklab-quantize.ts: system colors 0-15 are never used
// because users commonly remap them, breaking contrast guarantees.
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
function xterm256Hex(index) {
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = CUBE_LEVELS[Math.floor(n / 36)];
    const g = CUBE_LEVELS[Math.floor(n / 6) % 6];
    const b = CUBE_LEVELS[n % 6];
    return toHex([r / 255, g / 255, b / 255]);
  }
  const v = 8 + 10 * (index - 232);
  return toHex([v / 255, v / 255, v / 255]);
}
const XTERM_PALETTE = (() => {
  const entries = [];
  for (let i = 16; i <= 255; i++) {
    entries.push({ index: i, hex: xterm256Hex(i), lab: srgbToOklab(xterm256Hex(i)) });
  }
  return entries;
})();
const quantCache = new Map();
function quantizeXterm256(hex) {
  const key = hex.toUpperCase();
  const cached = quantCache.get(key);
  if (cached) return cached;
  const lab = srgbToOklab(key);
  let best = XTERM_PALETTE[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of XTERM_PALETTE) {
    const dL = lab.L - entry.lab.L;
    const da = lab.a - entry.lab.a;
    const db = lab.b - entry.lab.b;
    const dist = dL * dL + da * da + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  quantCache.set(key, best);
  return best;
}

// ── Structural validation (the executable schema rules) ────────────────────
function validateTheme(theme, file) {
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  if (theme.schemaVersion !== "omk.theme.v1") err(`schemaVersion must be "omk.theme.v1"`);
  if (!/^[a-z][a-z0-9-]*$/.test(theme.name ?? "")) err("invalid theme name");
  if (!["dark", "light"].includes(theme.mode)) err("mode must be dark|light");
  const primitives = theme.primitives ?? {};
  for (const [k, v] of Object.entries(primitives)) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) err(`primitive ${k}: bad hex ${v}`);
  }
  for (const bg of theme.backgrounds ?? []) {
    if (!primitives[bg]) err(`background "${bg}" is not a primitive`);
  }
  const semantics = theme.semantics ?? {};
  for (const [role, spec] of Object.entries(semantics)) {
    if (!primitives[spec.color]) err(`semantic ${role}: color "${spec.color}" is not a primitive`);
    const kind = spec.kind ?? "state";
    if (kind === "state" && !spec.glyph) err(`semantic state ${role}: missing mandatory glyph`);
    if (!["text", "indicator", "background"].includes(spec.usage)) err(`semantic ${role}: bad usage`);
  }
  for (const [comp, slots] of Object.entries(theme.components ?? {})) {
    for (const [slot, role] of Object.entries(slots)) {
      if (!semantics[role]) err(`component ${comp}.${slot}: unknown semantic role "${role}"`);
    }
  }
  const fb = theme.fallback16 ?? {};
  for (const role of Object.keys(semantics)) {
    if (!fb[role]) err(`fallback16: missing entry for semantic role "${role}"`);
  }
  for (const [role, name] of Object.entries(fb)) {
    if (!VGA[name]) err(`fallback16 ${role}: unknown ANSI-16 name "${name}"`);
    if (!semantics[role]) err(`fallback16 ${role}: no such semantic role`);
  }
  return errors;
}

// ── Matrix computation ──────────────────────────────────────────────────────
function computeMatrix(theme) {
  const rows = [];
  const primitives = theme.primitives;
  const bgs = theme.backgrounds.map((b) => ({ name: b, hex: primitives[b] }));
  for (const [role, spec] of Object.entries(theme.semantics)) {
    if (spec.usage === "background") continue;
    const gate = GATES[spec.usage];
    for (const bg of bgs) {
      const fgHex = primitives[spec.color];
      const cr = contrast(fgHex, bg.hex);
      const pass = cr >= gate;
      rows.push({
        tier: "truecolor", role, usage: spec.usage, fg: `${spec.color} ${fgHex}`,
        bg: `${bg.name} ${bg.hex}`, cr: cr.toFixed(2), gate, pass,
        suggestion: pass ? "" : adjustForContrast(fgHex, bg.hex, gate) ?? "(no in-gamut fix)",
      });
    }
  }
  // 256 tier: quantize fg AND bg through the same OKLab NN the runtime uses
  // (xterm 16-255 only) and re-gate at the same thresholds. This is the CI
  // gate required by t3-a11y-review.md condition #1 — it catches hand-tuned
  // index overrides or primitive edits that erode post-quantization margins.
  for (const [role, spec] of Object.entries(theme.semantics)) {
    if (spec.usage === "background") continue;
    const gate = GATES[spec.usage];
    for (const bg of bgs) {
      const qFg = quantizeXterm256(primitives[spec.color]);
      const qBg = quantizeXterm256(bg.hex);
      const cr = contrast(qFg.hex, qBg.hex);
      const pass = cr >= gate;
      rows.push({
        tier: "256(xterm)", role, usage: spec.usage,
        fg: `${spec.color}@${qFg.index} ${qFg.hex}`,
        bg: `${bg.name}@${qBg.index} ${qBg.hex}`,
        cr: cr.toFixed(2), gate, pass,
        suggestion: pass ? "" : "re-tune primitive (hue held, L moved) and re-gate; do not pick a raw cube index without a matrix row",
      });
    }
  }
  // 16-color tier: hand-authored names vs the tier background (VGA value of control.bg fallback)
  const bgRole = Object.entries(theme.semantics).find(([, s]) => s.usage === "background");
  const fbBgHex = VGA[theme.fallback16[bgRole?.[0]] ?? "black"];
  for (const [role, spec] of Object.entries(theme.semantics)) {
    if (spec.usage === "background") continue;
    const gate = GATES[spec.usage];
    const name = theme.fallback16[role];
    const cr = contrast(VGA[name], fbBgHex);
    const pass = cr >= gate;
    rows.push({
      tier: "16-color(VGA)", role, usage: spec.usage, fg: `${name} ${VGA[name]}`,
      bg: `black ${fbBgHex}`, cr: cr.toFixed(2), gate, pass, suggestion: pass ? "" : "re-author fallback16 entry",
    });
  }
  return rows;
}

// ── Main ────────────────────────────────────────────────────────────────────
if (selfTest) {
  // Prove the OKLCH repair engine on a known-failing pair: purple as running text on dark.
  const fg = "#9D4EDD";
  const bg = "#070B14";
  const before = contrast(fg, bg);
  const fixed = adjustForContrast(fg, bg, 4.5);
  const after = fixed ? contrast(fixed, bg) : 0;
  const labBefore = srgbToOklab(fg);
  const labAfter = srgbToOklab(fixed);
  const DEGREES_PER_RADIAN = 57.29577951308232;
  const hue = (lab) => (Math.atan2(lab.b, lab.a) * DEGREES_PER_RADIAN + 360) % 360;
  console.log(`[self-test] ${fg} on ${bg} @gate4.5: CR ${before.toFixed(2)} -> ${fixed} CR ${after.toFixed(2)}`);
  console.log(`[self-test] OKLCH hue held: ${hue(labBefore).toFixed(1)}° -> ${hue(labAfter).toFixed(1)}°; L ${labBefore.L.toFixed(3)} -> ${labAfter.L.toFixed(3)}`);
  if (!fixed || after < 4.5 || Math.abs(hue(labBefore) - hue(labAfter)) > 2.5) {
    console.error("[self-test] FAILED");
    process.exit(1);
  }
  console.log("[self-test] OK");
  process.exit(0);
}

const themesDir = join(root, "themes");
const files = (await readdir(themesDir)).filter((f) => f.endsWith(".theme.json"));
if (files.length === 0) {
  console.error("theme:check: no themes/*.theme.json documents found");
  process.exit(1);
}

let failed = false;
const allRows = [];
for (const file of files) {
  const theme = JSON.parse(await readFile(join(themesDir, file), "utf8"));
  const errors = validateTheme(theme, file);
  if (errors.length) {
    failed = true;
    for (const e of errors) console.error(`✗ ${e}`);
    continue;
  }
  const rows = computeMatrix(theme);
  allRows.push(...rows.map((r) => ({ theme: theme.name, ...r })));
  const bad = rows.filter((r) => !r.pass);
  if (bad.length) failed = true;
  console.log(`${bad.length === 0 ? "✓" : "✗"} ${theme.name}: ${rows.length} pairs checked, ${bad.length} failed`);
  for (const r of bad) {
    console.error(`  ✗ [${r.tier}] ${r.role} (${r.usage}) ${r.fg} on ${r.bg}: CR ${r.cr} < ${r.gate}; suggest ${r.suggestion}`);
  }
}

await mkdir(join(root, outDir), { recursive: true });
const header = ["theme", "tier", "role", "usage", "fg", "bg", "cr", "gate", "pass", "suggestion"];
const csv = [header.join(","), ...allRows.map((r) => header.map((h) => `"${String(r[h])}"`).join(","))].join("\n");
await writeFile(join(root, outDir, "contrast-matrix.csv"), `${csv}\n`);
const md = [
  `# Contrast matrix (generated ${new Date().toISOString()})`,
  "",
  `| theme | tier | role | usage | fg | bg | CR | gate | pass |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...allRows.map((r) => `| ${r.theme} | ${r.tier} | ${r.role} | ${r.usage} | ${r.fg} | ${r.bg} | ${r.cr} | ≥${r.gate} | ${r.pass ? "✓" : "✗ → " + r.suggestion} |`),
].join("\n");
await writeFile(join(root, outDir, "contrast-matrix.md"), `${md}\n`);
console.log(`matrix: ${allRows.length} pairs -> ${outDir}/contrast-matrix.{csv,md}`);

if (failed) process.exit(1);
console.log("theme:check passed");
