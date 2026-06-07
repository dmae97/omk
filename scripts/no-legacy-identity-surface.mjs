#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const product = [80, 105].map((code) => String.fromCharCode(code)).join("");
const lower = product.toLowerCase();
const escapedHome = String.raw`~\/\.` + lower + String.raw`(?:\/|$)`;
const escapedDotDir = String.raw`(?:^|[^A-Za-z0-9_])\.` + lower + String.raw`(?:\/|$)`;
const docsHost = lower + String.raw`\.dev`;
const legacyPackageHost = String.raw`earendil-works\/` + lower;
const legacyPackageName = String.raw`@gsd\/` + lower;
const legacyPackageSlug = String.raw`gsd-` + lower;
const forbiddenPattern = new RegExp(
  `(?:\\b${product}\\b|\\b${product.toUpperCase()}\\b|${escapedHome}|${escapedDotDir}|${docsHost}|${legacyPackageHost}|${legacyPackageName}|${legacyPackageSlug})`,
);

const excludedDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist.old",
  "target",
  "coverage",
  ".nyc_output",
  "test",
  ".omk",
  ".kimi",
  ".agents",
  ".omx",
  ".gsd",
  ".bg-shell",
  ".codegraph",
  ".commandcode",
  ".playwright-mcp",
  lower.startsWith(".") ? lower : `.${lower}`,
  "headroom",
  "lobehub",
  "continuous-claude-v3",
  "agent-skills",
  "logs",
]);

const excludedFiles = new Set([
  ".gitignore",
  ".npmignore",
  "package-lock.json",
  "Cargo.lock",
  "scripts/no-legacy-identity-surface.mjs",
  "scripts/package-audit.mjs",
  "test/no-legacy-identity-surface.test.mjs",
]);

const checkedExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const checkedBasenames = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "GEMINI.md",
  "KIMI.md",
  "LICENSE",
  "MATURITY.md",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
  "WORKER_MANIFEST.md",
  "package.json",
  "tsconfig.json",
]);

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function gitListFiles() {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
      .map(normalizePath);
  } catch {
    return walkFiles(".");
  }
}

function walkFiles(dir, prefix = "") {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const normalized = normalizePath(rel);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name) || excludedDirs.has(normalized)) continue;
      results.push(...walkFiles(join(dir, entry.name), normalized));
    } else if (entry.isFile()) {
      results.push(normalized);
    }
  }
  return results;
}

function shouldCheckFile(file) {
  const normalized = normalizePath(file);
  if (excludedFiles.has(normalized) || excludedFiles.has(basename(normalized))) return false;
  if (normalized.split("/").some((segment) => excludedDirs.has(segment))) return false;
  if (!existsSync(normalized)) return false;
  const stat = lstatSync(normalized);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  if (stat.size > 512_000) return false;
  const base = basename(normalized);
  return checkedBasenames.has(base) || checkedExtensions.has(extname(base).toLowerCase());
}

function isLikelyBinary(buffer) {
  return buffer.includes(0);
}

const violations = [];
const checked = [];

for (const file of [...new Set(gitListFiles())].sort()) {
  if (!shouldCheckFile(file)) continue;
  const buffer = readFileSync(file);
  if (isLikelyBinary(buffer)) continue;
  checked.push(file);
  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (forbiddenPattern.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Default OMK public surface contains legacy identity markers:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Default OMK public surface contains no legacy identity markers (${checked.length} files checked).`);
