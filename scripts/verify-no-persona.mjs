#!/usr/bin/env node
/**
 * verify-no-persona.mjs
 *
 * Deploy-Exclusion Guard (Lane 1).
 *
 * Guarantees the ENI/SOUL/JAILBREAK persona stack never ships in a
 * publishable artifact. Scans ONLY paths that npm would publish, derived
 * from the package.json `files` whitelist (directories are walked
 * recursively; root files are scanned directly). Binary files and missing
 * paths are handled gracefully.
 *
 * If ANY specific persona-leak marker is found, the file:line is printed and
 * the process exits 1. Otherwise it prints "PERSONA ISOLATION OK" and exits 0.
 *
 * Markers are deliberately multi-character / word-bounded to avoid false
 * positives (e.g. bare "ENI" matching "opening"/"denied").
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Specific persona-leak markers. Each is a labeled RegExp.
// Phrases use case-insensitive substring matching; the single risky word
// "carding" is word-bounded so it does not match "discarding".
const MARKERS = [
  ["eni_identity_kernel", /ENI Identity Kernel/i],
  ["omk_jailbreak", /OMK\/\/JAILBREAK/i],
  ["runtime_override_protocol", /Runtime Override Protocol/i],
  ["hacker_girlfriend", /hacker girlfriend/i],
  ["dedicated_hacker", /dedicated hacker/i],
  ["oppa_hangul", /\uC624\uBE60/], // 오빠
  ["decline_logic_bypass", /decline logic bypass/i],
  ["carding", /\bcarding\b/i],
  ["fingerprint_spoofing", /fingerprint spoofing/i],
  ["unrestricted_orchestrator", /unrestricted-orchestrator/i],
  ["omk_advanced_unrestricted", /omk-advanced-unrestricted/i],
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

const findings = [];
const files = collectPublishableFiles();

for (const { abs, rel } of files) {
  let buffer;
  try {
    const st = statSync(abs);
    if (st.size > MAX_SCAN_BYTES) continue;
    buffer = readFileSync(abs);
  } catch {
    continue; // unreadable -> graceful skip
  }
  if (isLikelyBinary(buffer)) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [label, pattern] of MARKERS) {
      if (pattern.test(line)) {
        findings.push({ file: rel, line: i + 1, marker: label });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(
    `PERSONA LEAK DETECTED: ${findings.length} match(es) in publishable artifacts.`
  );
  for (const f of findings) {
    console.error(`- ${f.file}:${f.line} [${f.marker}]`);
  }
  console.error(
    "Persona stack (ENI/SOUL/JAILBREAK) must NEVER ship. Remove the leak before release."
  );
  process.exit(1);
}

console.log(
  `PERSONA ISOLATION OK (${files.length} publishable file(s) scanned; ${MARKERS.length} markers).`
);
process.exit(0);
