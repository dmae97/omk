#!/usr/bin/env node
/**
 * assets:build — derive the README SVG assets from the omk.theme.v1 theme contract.
 *
 * Reads themes/night-city.theme.json (override: --theme <path>), computes a short
 * content hash (first 12 hex of sha256 over the theme file bytes), and rewrites every
 * fill/stroke/stop-color value in the derived SVGs with values resolved from theme
 * primitives. Geometry, layout, text, and structure are preserved — the only changes
 * are color values and the provenance comment:
 *
 *   <!-- derived-from: omk.theme.v1/night-city@<hash> -->
 *
 * Dark-only policy (docs/decisions/ADR-theme-dark-only-assets.md): assets ship from a
 * single contrast-gated dark theme. Non-dark themes are refused unless every used
 * foreground/background pair passes the same WCAG gates theme:check enforces
 * (usage "text" -> CR >= 4.5, usage "indicator" -> CR >= 3.0). The gate also runs for
 * dark themes so a drifted primitive cannot silently ship an unreadable asset.
 *
 * Usage: node scripts/assets-build.mjs [--theme <path>]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const args = process.argv.slice(2);
const themePath = args.includes("--theme")
  ? args[args.indexOf("--theme") + 1]
  : join("themes", "night-city.theme.json");

const DERIVED_SVGS = [
  "readmeasset/omk-badges.svg",
  "readmeasset/omk-core-loop.svg",
  "readmeasset/omk-evidence-ledger.svg",
  "readmeasset/omk-logo-mark.svg",
  "readmeasset/omk-provider-lanes.svg",
];

// Migration anchors: the hex values the hand-authored SVGs originally shipped with,
// keyed to the primitive token each color slot belongs to (mirrors the
// readmeasset/ASSET_PROVENANCE.md theme mapping). These are lookup KEYS only —
// every color written to disk is resolved via theme.primitives[token], never copied
// from this table. The current theme's primitives are merged on top at runtime so
// rebuilds keep working after a token value changes.
const LEGACY_HEX_TO_TOKEN = {
  "#070B14": "dark",
  "#101826": "surface",
  "#00D6FF": "cyan",
  "#00FFC2": "mint",
  "#FF47B2": "magenta",
  "#9D4EDD": "purple",
  "#FFB000": "amber",
  "#FF5874": "red",
  "#E8F8FF": "cream",
  "#9DB3C7": "muted",
  "#758FA8": "gray",
};

const GATES = { text: 4.5, indicator: 3.0 };

// ── WCAG 2.x contrast math (same model as scripts/theme-check.mjs) ─────────
function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16) / 255);
}
const linearize = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
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

/**
 * Gate for a primitive token: the loosest gate among the semantic roles that
 * reference it (these SVGs use tokens as large/bold badge labels, strokes, and
 * glyph-scale accents, so the indicator tier applies whenever the contract
 * grants it). Tokens absent from semantics (pure brand accents, e.g. magenta)
 * gate as indicator.
 */
function tokenGate(theme, token) {
  let gate = null;
  for (const role of Object.values(theme.semantics ?? {})) {
    if (role.color !== token) continue;
    const g = role.usage === "text" ? GATES.text : role.usage === "indicator" ? GATES.indicator : null;
    if (g !== null) gate = gate === null ? g : Math.min(gate, g);
  }
  return gate ?? GATES.indicator;
}

/** Minimal well-formedness check: balanced, properly nested element tags. */
function assertWellFormed(file, xml) {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const tagRe = /<\/?([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^"'>])*>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(stripped)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.startsWith("</")) {
      const open = stack.pop();
      if (open !== name) throw new Error(`${file}: mismatched </${name}> (expected </${open ?? "EOF"}>)`);
    } else if (!full.endsWith("/>")) {
      stack.push(name);
    }
  }
  if (stack.length > 0) throw new Error(`${file}: unclosed <${stack.join(">, <")}>`);
}

async function main() {
  const themeBytes = await readFile(resolve(root, themePath));
  const hash = createHash("sha256").update(themeBytes).digest("hex").slice(0, 12);
  const theme = JSON.parse(themeBytes.toString("utf8"));

  if (theme.schemaVersion !== "omk.theme.v1" || typeof theme.primitives !== "object") {
    console.error(`[assets:build] ${themePath} is not a valid omk.theme.v1 document`);
    process.exit(1);
  }

  const provenanceId = `${theme.schemaVersion}/${theme.name}@${hash}`;
  const backgrounds = Array.isArray(theme.backgrounds) ? theme.backgrounds : [];

  // hex -> token lookup: legacy anchors first, current theme values on top.
  const hexToToken = new Map(
    Object.entries(LEGACY_HEX_TO_TOKEN).map(([hex, token]) => [hex.toUpperCase(), token]),
  );
  for (const [token, hex] of Object.entries(theme.primitives)) {
    hexToToken.set(String(hex).toUpperCase(), token);
  }

  const usedFgTokens = new Set();
  const outputs = [];
  const colorAttrRe = /\b(fill|stroke|stop-color)="(#[0-9A-Fa-f]{6})"/g;

  for (const rel of DERIVED_SVGS) {
    const raw = await readFile(join(root, rel), "utf8");
    let body = raw.replace(/^<!-- derived-from:[^>]*-->\r?\n?/, "");
    let replaced = 0;
    body = body.replace(colorAttrRe, (full, attr, hex) => {
      const colorToken = hexToToken.get(hex.toUpperCase());
      if (!colorToken) {
        throw new Error(
          `${rel}: color ${hex} (${attr}) has no theme token mapping — extend the theme or the migration anchors`,
        );
      }
      const value = theme.primitives[colorToken];
      if (typeof value !== "string") {
        throw new Error(`${rel}: token "${colorToken}" missing from theme.primitives`);
      }
      if (!backgrounds.includes(colorToken)) usedFgTokens.add(colorToken);
      replaced += 1;
      return `${attr}="${value}"`;
    });
    const out = `<!-- derived-from: ${provenanceId} -->\n${body}`;
    assertWellFormed(rel, out);
    outputs.push({ rel, out, replaced });
  }

  // Contrast gate: every used foreground token must clear its gate on every
  // declared theme background (same pairing model as theme:check).
  const failures = [];
  for (const fg of usedFgTokens) {
    const gate = tokenGate(theme, fg);
    for (const bg of backgrounds) {
      const cr = contrast(theme.primitives[fg], theme.primitives[bg]);
      if (cr < gate) failures.push({ fg, bg, cr: cr.toFixed(2), gate });
    }
  }

  if (theme.mode !== "dark") {
    console.error(
      `[assets:build] non-dark theme "${theme.name}" (mode=${theme.mode}) — dark-only policy applies, ` +
        `see docs/decisions/ADR-theme-dark-only-assets.md`,
    );
    if (failures.length > 0) {
      for (const f of failures) {
        console.error(`  ✗ ${f.fg} on ${f.bg}: CR ${f.cr} < gate ${f.gate}`);
      }
      console.error("[assets:build] refused: non-dark variant failed the contrast gate");
      process.exit(1);
    }
    console.error("[assets:build] non-dark variant accepted only because all used pairs pass the gate");
  } else if (failures.length > 0) {
    for (const f of failures) {
      console.error(`  ✗ ${f.fg} on ${f.bg}: CR ${f.cr} < gate ${f.gate}`);
    }
    console.error(`[assets:build] refused: theme "${theme.name}" failed the contrast gate for used pairs`);
    process.exit(1);
  }

  for (const { rel, out, replaced } of outputs) {
    await writeFile(join(root, rel), out, "utf8");
    console.log(`✓ ${rel}: ${replaced} color values from tokens, derived-from: ${provenanceId}`);
  }
  console.log(
    `[assets:build] ${outputs.length} SVGs derived from ${themePath} ` +
      `(${usedFgTokens.size} fg tokens gated on ${backgrounds.join("+")}, 0 failures)`,
  );
}

main().catch((err) => {
  console.error(`[assets:build] ${err.message}`);
  process.exit(1);
});
