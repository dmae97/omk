#!/usr/bin/env node
/**
 * verify-no-persona.mjs
 *
 * Deploy-Exclusion Guard (Lane 1).
 *
 * Guarantees the legacy persona stack never ships in a
 * publishable artifact. Scans ONLY paths that npm would publish, derived
 * from the package.json `files` whitelist (directories are walked
 * recursively; root files are scanned directly). Binary files and missing
 * paths are handled gracefully.
 *
 * If ANY specific persona-leak marker is found, the file:line is printed and
 * the process exits 1. Otherwise it prints "PERSONA ISOLATION OK" and exits 0.
 *
 * Markers are deliberately multi-character / word-bounded to avoid false
 * positives from unrelated words.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Specific persona-leak markers. Each is a labeled RegExp.
// Phrases use case-insensitive substring matching; the single risky word
// "carding" is word-bounded so it does not match "discarding".
const personaIdentityKernel = new RegExp(`${["E", "N", "I"].join("")} Identity Kernel`, "i");
const omkOverrideMarker = new RegExp(`${["OMK//", "JAIL", "BREAK"].join("")}`, "i");

const MARKERS = [
  ["persona_identity_kernel", personaIdentityKernel],
  ["omk_override_marker", omkOverrideMarker],
  ["runtime_override_protocol", /Runtime Override Protocol/i],
  ["hacker_girlfriend", /hacker girlfriend/i],
  ["dedicated_hacker", /dedicated hacker/i],
  ["oppa_hangul", /\uC624\uBE60/], // Korean familiar-address marker
  ["decline_logic_bypass", /decline logic bypass/i],
  ["carding", /\bcarding\b/i],
  ["fingerprint_spoofing", /fingerprint spoofing/i],
  ["unrestricted_orchestrator", /unrestricted-orchestrator/i],
  ["omk_advanced_unrestricted", /omk-advanced-unrestricted/i],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactTokenPattern(parts) {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(parts.join(""))}([^A-Za-z0-9_]|$)`, "i");
}

const EXACT_SURFACE_MARKERS = [
  ["legacy_identity_token", exactTokenPattern(["E", "N", "I"])],
  ["legacy_override_token", exactTokenPattern(["jail", "break"])],
];

const MAX_SCAN_BYTES = 5 * 1024 * 1024; // skip absurdly large files defensively

function readPublishWhitelist() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (Array.isArray(pkg.files) && pkg.files.length > 0) return pkg.files;
  } catch {
    // fall through to default
  }
  // Defensive default mirroring the known whitelist.
  return [
    "dist",
    "templates",
    "docs",
    "readmeasset",
    "CHANGELOG.md",
    "MATURITY.md",
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "ROADMAP.md",
    "DESIGN.md",
    "WORKER_MANIFEST.md",
    "CLAUDE.md",
    "GEMINI.md",
    "LICENSE",
    "llms.txt",
  ];
}

function walk(absDir, relDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable dir -> graceful skip
  }
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue; // do not follow symlinks
    if (entry.isDirectory()) {
      walk(absPath, relPath, out);
    } else if (entry.isFile()) {
      out.push({ abs: absPath, rel: relPath });
    }
  }
}

function collectPublishableFiles() {
  const whitelist = readPublishWhitelist();
  const files = [];
  for (const entry of whitelist) {
    const abs = join(ROOT, entry);
    if (!existsSync(abs)) continue; // missing path (e.g. unbuilt dist/) -> graceful skip
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, entry, files);
    } else if (st.isFile()) {
      files.push({ abs, rel: entry });
    }
  }
  return files;
}

function isLikelyBinary(buffer) {
  // NUL byte within the inspected window => treat as binary.
  const window = buffer.subarray(0, Math.min(buffer.length, 8192));
  return window.includes(0);
}

function collectTrackedSourceFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter(Boolean)
      .filter((path) => !path.startsWith("dist/") && !path.startsWith("node_modules/"))
      .map((rel) => ({ abs: join(ROOT, rel), rel }));
  } catch {
    return collectPublishableFiles();
  }
}

function readTextFileIfScannable(abs) {
  try {
    const st = statSync(abs);
    if (st.size > MAX_SCAN_BYTES) return undefined;
    const buffer = readFileSync(abs);
    return isLikelyBinary(buffer) ? undefined : buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

function scanFileMarkers(findings, scope, rel, text, markers) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [label, pattern] of markers) {
      if (pattern.test(line)) findings.push({ file: rel, line: i + 1, marker: `${scope}:${label}` });
    }
  }
}

function scanPathMarkers(findings, scope, rel, markers) {
  for (const [label, pattern] of markers) {
    if (pattern.test(rel)) findings.push({ file: rel, line: 0, marker: `${scope}:${label}` });
  }
}

const findings = [];
const files = collectPublishableFiles();

for (const { abs, rel } of files) {
  scanPathMarkers(findings, "publish-path", rel, [...MARKERS, ...EXACT_SURFACE_MARKERS]);
  const text = readTextFileIfScannable(abs);
  if (text === undefined) continue;
  scanFileMarkers(findings, "publish-content", rel, text, MARKERS);
  scanFileMarkers(findings, "publish-token", rel, text, EXACT_SURFACE_MARKERS);
}

for (const { abs, rel } of collectTrackedSourceFiles()) {
  scanPathMarkers(findings, "source-path", rel, EXACT_SURFACE_MARKERS);
  const text = readTextFileIfScannable(abs);
  if (text === undefined) continue;
  scanFileMarkers(findings, "source-token", rel, text, EXACT_SURFACE_MARKERS);
}

if (findings.length > 0) {
  console.error(
    `PERSONA LEAK DETECTED: ${findings.length} match(es) in guarded surfaces.`
  );
  for (const f of findings) {
    console.error(`- ${f.file}:${f.line} [${f.marker}]`);
  }
  console.error(
    "Legacy persona stack must NEVER ship. Remove the leak before release."
  );
  process.exit(1);
}

console.log(
  `PERSONA ISOLATION OK (${files.length} publishable file(s) scanned; ${MARKERS.length + EXACT_SURFACE_MARKERS.length} markers).`
);
process.exit(0);
