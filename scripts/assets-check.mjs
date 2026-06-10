#!/usr/bin/env node
/**
 * assets:check — read-only provenance drift gate for the theme-derived SVG assets.
 *
 * Zero writes. Verifies that the committed SVGs and readmeasset/ASSET_PROVENANCE.md
 * still describe the current theme contract:
 *   (a) compute the current theme hash (first 12 hex of sha256 over the theme file);
 *   (b) each derived SVG embeds `<!-- derived-from: <prefix>@<hash> -->` with that hash;
 *   (c) every derived-from line in the ledger carries the current hash;
 *   (d) the ledger table's byte-size and SHA-256 cells match the files on disk.
 *
 * On any drift: prints each stale item as "<item>: expected <x> actual <y>",
 * sorted for determinism, plus the remediation hint, and exits 1.
 * On success: one summary line, exit 0.
 *
 * Usage: node scripts/assets-check.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";

const root = process.cwd();
const THEME_PATH = join("themes", "night-city.theme.json");
const LEDGER_PATH = join("readmeasset", "ASSET_PROVENANCE.md");

const DERIVED_SVGS = [
  "readmeasset/omk-badges.svg",
  "readmeasset/omk-control-surfaces.svg",
  "readmeasset/omk-core-loop.svg",
  "readmeasset/omk-evidence-ledger.svg",
  "readmeasset/omk-logo-mark.svg",
  "readmeasset/omk-provider-lanes.svg",
  "readmeasset/omk-release-assertions.svg",
];

const REMEDIATION = "run: npm run assets:build && refresh ASSET_PROVENANCE.md";

function fail(message) {
  console.error(`[assets:check] ${message}`);
  process.exit(1);
}

function readBytes(rel) {
  try {
    return readFileSync(join(root, rel));
  } catch (err) {
    fail(`cannot read ${rel}: ${err.message}`);
    return Buffer.alloc(0); // unreachable; fail() exits.
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const themeBytes = readBytes(THEME_PATH);
  const hash = createHash("sha256").update(themeBytes).digest("hex").slice(0, 12);

  let theme;
  try {
    theme = JSON.parse(themeBytes.toString("utf8"));
  } catch (err) {
    fail(`${THEME_PATH} is not valid JSON: ${err.message}`);
  }
  const prefix = `${theme.schemaVersion}/${theme.name}`;
  const expectedProvenance = `${prefix}@${hash}`;
  const derivedRe = new RegExp(`derived-from:\\s*${escapeRegExp(prefix)}@([0-9a-f]{6,64})`);

  // Disk truth for each SVG: byte size, sha256, embedded derived-from hash.
  const disk = new Map();
  for (const rel of DERIVED_SVGS) {
    const bytes = readBytes(rel);
    const match = bytes.toString("utf8").match(derivedRe);
    disk.set(basename(rel), {
      rel,
      size: bytes.length,
      sha: createHash("sha256").update(bytes).digest("hex"),
      embedded: match ? match[1] : "missing",
    });
  }

  const issues = [];

  // (b) each SVG must embed the current hash.
  for (const info of disk.values()) {
    if (info.embedded !== hash) {
      issues.push(`${info.rel} derived-from: expected ${hash} actual ${info.embedded}`);
    }
  }

  const targetNames = new Set([...disk.keys()]);
  const ledgerLines = readBytes(LEDGER_PATH).toString("utf8").split(/\r?\n/);
  const svgRefRe = /`([a-z0-9-]+\.svg)`/i;

  // (c) ledger derived-from lines must carry the current hash.
  const seenDerivedLine = new Set();
  for (const line of ledgerLines) {
    const match = line.match(derivedRe);
    if (!match) continue;
    const ref = line.match(svgRefRe);
    const name = ref && targetNames.has(ref[1]) ? ref[1] : null;
    if (name) seenDerivedLine.add(name);
    if (match[1] !== hash) {
      issues.push(`${LEDGER_PATH} derived-from ${name ?? "line"}: expected ${hash} actual ${match[1]}`);
    }
  }
  for (const name of targetNames) {
    if (!seenDerivedLine.has(name)) {
      issues.push(`${LEDGER_PATH} derived-from ${name}: expected ${hash} actual missing`);
    }
  }

  // (d) ledger table byte-size + SHA-256 cells must match disk.
  const seenRow = new Set();
  for (const line of ledgerLines) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 8) continue;
    const fileCell = cells[1].replace(/`/g, "").trim();
    const info = disk.get(fileCell);
    if (!info) continue;
    seenRow.add(fileCell);
    const sizeCell = cells[6].replace(/`/g, "").trim();
    const shaCell = cells[7].replace(/`/g, "").trim();
    if (sizeCell !== String(info.size)) {
      issues.push(`${LEDGER_PATH} byte-size ${fileCell}: expected ${info.size} actual ${sizeCell}`);
    }
    if (shaCell !== info.sha) {
      issues.push(`${LEDGER_PATH} sha256 ${fileCell}: expected ${info.sha} actual ${shaCell}`);
    }
  }
  for (const name of targetNames) {
    if (!seenRow.has(name)) {
      issues.push(`${LEDGER_PATH} table-row ${name}: expected present actual missing`);
    }
  }

  if (issues.length > 0) {
    issues.sort();
    const noun = issues.length === 1 ? "stale item" : "stale items";
    console.error(`[assets:check] provenance drift detected (${issues.length} ${noun}):`);
    for (const item of issues) console.error(`- ${item}`);
    console.error(REMEDIATION);
    process.exit(1);
  }

  console.log(
    `[assets:check] OK — ${DERIVED_SVGS.length} SVGs match ${expectedProvenance}; ledger byte-size/SHA-256/derived-from current.`,
  );
}

main();
