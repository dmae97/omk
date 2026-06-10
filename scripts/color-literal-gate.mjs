#!/usr/bin/env node
/**
 * color:gate — CI grep gate banning color literals in src/ outside the theme module.
 *
 * Scans src/**\/*.ts (excluding src/cli/theme/**) for:
 *   (a) hex color literals  #rgb / #rrggbb / #rrggbbaa
 *   (b) hardcoded SGR color escapes  \x1b[3Xm, \x1b[9Xm, 38;2;, 38;5;, 48;2;, 48;5;
 *
 * Allowlist: scripts/color-allowlist.json
 *   "permanent"        — exempt by design (init template payloads = generated-project content).
 *   "legacy-burn-down" — per-file ratchet ceilings (today's counts). The gate FAILS when
 *                        a file's hex or SGR count INCREASES past its ceiling, or when a
 *                        violating file appears that is in neither section.
 *                        Counts may only go DOWN; lower the ceiling when they do.
 *
 * Output is sorted by file path so CI diffs are deterministic.
 *
 * Usage:
 *   node scripts/color-literal-gate.mjs            # gate mode (exit 1 on violations)
 *   node scripts/color-literal-gate.mjs --report   # print markdown inventory to stdout (always exit 0)
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const SRC_DIR = "src";
const EXCLUDE_PREFIXES = ["src/cli/theme/"];
const ALLOWLIST_PATH = "scripts/color-allowlist.json";
const reportMode = process.argv.includes("--report");

// (a) hex color literals: #rgb / #rrggbb / #rrggbbaa (longest-first; reject longer hex runs)
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
// (b) hardcoded SGR color escapes. Source files encode ESC as \x1b / \u001b / \033 / \e
// (or, rarely, a raw ESC byte). 38;2;/38;5;/48;2;/48;5; are matched bare because they sit
// inside compound sequences such as \x1b[1;38;2;R;G;Bm.
const ESC = "(?:\\\\x1b|\\\\u001b|\\\\033|\\\\e|\\x1b)";
const SGR_RE = new RegExp(`${ESC}\\[(?:3[0-7]|9[0-7])m|[34]8;[25];`, "g");

/** @returns {Promise<string[]>} all .ts files under dir, posix-separated, sorted */
async function walk(dir) {
  const out = [];
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(rel)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(rel);
  }
  return out.sort();
}

function countMatches(text, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n += 1;
  return n;
}

async function loadAllowlist() {
  const raw = JSON.parse(await readFile(join(root, ALLOWLIST_PATH), "utf8"));
  const permanent = new Set(raw?.permanent?.files ?? []);
  const legacy = new Map(Object.entries(raw?.["legacy-burn-down"]?.files ?? {}));
  return { permanent, legacy };
}

const { permanent, legacy } = await loadAllowlist();
const files = (await walk(SRC_DIR)).filter(
  (f) => !EXCLUDE_PREFIXES.some((p) => f.startsWith(p)),
);

/** @type {{file: string, hex: number, sgr: number, section: string, ok: boolean, note: string}[]} */
const rows = [];
for (const file of files) {
  const text = await readFile(join(root, file), "utf8");
  const hex = countMatches(text, HEX_RE);
  const sgr = countMatches(text, SGR_RE);
  if (hex === 0 && sgr === 0) continue;

  if (permanent.has(file)) {
    rows.push({ file, hex, sgr, section: "permanent", ok: true, note: "exempt by design" });
  } else if (legacy.has(file)) {
    const ceiling = legacy.get(file);
    const hexOver = hex > (ceiling.hex ?? 0);
    const sgrOver = sgr > (ceiling.sgr ?? 0);
    const ok = !hexOver && !sgrOver;
    const note = ok
      ? hex < (ceiling.hex ?? 0) || sgr < (ceiling.sgr ?? 0)
        ? `below ceiling hex<=${ceiling.hex} sgr<=${ceiling.sgr} — lower the ratchet`
        : `at ceiling hex<=${ceiling.hex} sgr<=${ceiling.sgr}`
      : `RATCHET BROKEN (ceiling hex<=${ceiling.hex} sgr<=${ceiling.sgr})`;
    rows.push({ file, hex, sgr, section: "legacy-burn-down", ok, note });
  } else {
    rows.push({ file, hex, sgr, section: "UNLISTED", ok: false, note: "new violating file" });
  }
}

// Stale allowlist entries (file gone or now clean) are informational only — parallel lanes
// burning down debt must not break the gate.
const seen = new Set(rows.map((r) => r.file));
const stale = [...legacy.keys()].filter((f) => !seen.has(f)).sort();

const totals = rows.reduce(
  (acc, r) => ({ hex: acc.hex + r.hex, sgr: acc.sgr + r.sgr }),
  { hex: 0, sgr: 0 },
);
const failures = rows.filter((r) => !r.ok);

if (reportMode) {
  const lines = [];
  lines.push("# Color-literal debt inventory");
  lines.push("");
  lines.push(`Scope: \`src/**/*.ts\` excluding \`src/cli/theme/**\` · gate: \`npm run color:gate\``);
  lines.push(`(scripts/color-literal-gate.mjs + scripts/color-allowlist.json)`);
  lines.push("");
  lines.push("| file | hex count | SGR count | allowlist section |");
  lines.push("|---|---:|---:|---|");
  for (const r of rows) {
    lines.push(`| ${r.file} | ${r.hex} | ${r.sgr} | ${r.section} |`);
  }
  lines.push(`| **TOTAL** | **${totals.hex}** | **${totals.sgr}** | ${rows.length} files |`);
  lines.push("");
  lines.push(
    "Sections: `permanent` = init template payloads (generated-project content, exempt by design);",
  );
  lines.push(
    "`legacy-burn-down` = temporary ratchet ceilings — counts may only decrease; migration to the",
  );
  lines.push("theme module happens in a later layer.");
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

console.log("color:gate — per-file violation counts (hex / sgr)");
for (const r of rows) {
  const mark = r.ok ? "ok  " : "FAIL";
  console.log(`  ${mark} ${r.file}  hex=${r.hex} sgr=${r.sgr} [${r.section}] ${r.note}`);
}
for (const f of stale) {
  console.log(`  info ${f}  stale allowlist entry (clean or removed) — drop it from ${ALLOWLIST_PATH}`);
}
console.log(`  total: hex=${totals.hex} sgr=${totals.sgr} across ${rows.length} files`);

if (failures.length > 0) {
  console.error(
    `color:gate FAILED — ${failures.length} file(s) violate the allowlist. ` +
      `Use the theme module (src/cli/theme/) instead of color literals, or — for sanctioned ` +
      `burn-down work only — adjust ${ALLOWLIST_PATH}.`,
  );
  process.exit(1);
}
console.log("color:gate passed.");
