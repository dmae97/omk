#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const SKIP_PREFIXES = [
  "node_modules/",
  "dist/",
  "target/",
  ".git/",
  ".omk/worktrees/",
  ".omk/images/",
  ".omk/runs/",
  ".omx/",
  "coverage/",
  ".nyc_output/",
];

const SYNTHETIC_SECRET_FIXTURE_FILES = new Set([
  "test/secret-scanner.test.mjs",
  "test/secret-scan-runtime.test.mjs",
  "test/cockpit-render.test.mjs",
]);

const RUNTIME_TRUST_BOUNDARY_FILES = [
  ".omk/config.toml",
  ".omk/kimi.config.toml",
  ".omk/mcp.json",
  ".omk/runtime-preset.json",
  ".omk/runtime-presets.json",
  ".kimi/config.toml",
  ".kimi/kimi.config.toml",
  ".kimi/mcp.json",
  ".kimi/settings.json",
  ".omk/images/metadata.json",
];

const RUNTIME_TRUST_BOUNDARY_DIRS = [
  ".omk/hooks",
  ".omk/images",
  ".omk/runs",
  ".kimi/hooks",
];

const PROTECTED_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /\.pem$/i,
  /\.key$/i,
  /\.p8$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^credentials\.json$/,
  /^service-account.*\.json$/i,
];

const LITERAL_PATTERNS = [
  ["private_key_block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws_access_key", /AKIA[0-9A-Z]{16}/],
  ["github_pat", /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ["gitlab_pat", /glpat-[A-Za-z0-9\-_]{20,}/],
  ["openai_key", /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{16,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["oauth_session_token", /\b(?:oauth|session|refresh|access)[_-]?token\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{20,}/i],
  ["stripe_key", /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ["maintainer_private_path", /\.config\/opencode\/secrets\.env|\/home\/dmae|\/mnt\/m\/(?:oh-my-kimi|open_multi-agent_kit)/],
];

const GENERIC_ASSIGNMENT = /\b(api[_-]?key|secret|token|password|private[_-]?key)\b["']?\s*[:=]\s*["']?([^"'\s;,}]{20,})/i;
const GENERIC_ALLOWLIST = /\$\{|<|YOUR_|REPLACE_|NPM_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|process\.env|env\.|readSetting|parseOptional|parsed\.password|\*\*\*|placeholder|example|sample|redacted|maintainer-local|secret leakage|secret leak|secrets? from|Do not store secrets|Do not send secrets|credentialCache/i;

const runtimeMode = process.argv.includes("--runtime");

function walkDirectory(dir, prefix = "", options = {}) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkip(relPath, options)) continue;
    if (entry.isDirectory()) {
      results.push(...walkDirectory(join(dir, entry.name), relPath, options));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function gitList(args) {
  try {
    const cwd = process.cwd();
    return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter(Boolean);
  } catch (e) {
    console.warn("secret-scan: git listing failed, falling back to filesystem scan");
    return walkDirectory(process.cwd());
  }
}

function collectUntrackedDirectoryFiles() {
  const results = [];
  for (const entry of gitList(["ls-files", "--others", "--directory", "--exclude-standard", "-z"])) {
    const path = entry.replace(/\/+$/, "");
    if (!path || !existsSync(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) results.push(...walkDirectory(path, path));
    else if (stat.isFile()) results.push(path);
  }
  return results;
}

function isRuntimeTrustBoundaryPath(path) {
  return path.startsWith(".omk/runs/") || path.startsWith(".omk/images/");
}

function shouldSkip(path, options = {}) {
  if (options.runtime && isRuntimeTrustBoundaryPath(path)) return false;
  return SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function collectRuntimeTrustBoundaryFiles() {
  const results = [];
  for (const file of RUNTIME_TRUST_BOUNDARY_FILES) {
    if (existsSync(file) && statSync(file).isFile()) results.push(file);
  }
  for (const dir of RUNTIME_TRUST_BOUNDARY_DIRS) {
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      results.push(...walkDirectory(dir, dir, { runtime: true }));
    }
  }
  return results;
}

function isLikelyBinary(buffer) {
  return buffer.includes(0);
}

const files = new Set([
  ...gitList(["ls-files", "-z"]),
  ...gitList(["ls-files", "--others", "--exclude-standard", "-z"]),
  ...collectUntrackedDirectoryFiles(),
  ...(runtimeMode ? collectRuntimeTrustBoundaryFiles() : []),
]);

const findings = [];

for (const file of [...files].sort()) {
  if (shouldSkip(file, { runtime: runtimeMode }) || SYNTHETIC_SECRET_FIXTURE_FILES.has(file) || !existsSync(file) || !statSync(file).isFile()) continue;

  const base = basename(file);
  if (PROTECTED_FILE_PATTERNS.some((pattern) => pattern.test(base))) {
    findings.push({ file, line: 0, type: "protected_filename" });
    continue;
  }

  const buffer = readFileSync(file);
  if (isLikelyBinary(buffer)) continue;
  const text = buffer.toString("utf8");

  text.split(/\r?\n/).forEach((line, index) => {
    for (const [type, pattern] of LITERAL_PATTERNS) {
      if (pattern.test(line)) findings.push({ file, line: index + 1, type });
    }

    if (GENERIC_ASSIGNMENT.test(line) && !GENERIC_ALLOWLIST.test(line)) {
      findings.push({ file, line: index + 1, type: "generic_secret_assignment" });
    }
  });
}

if (findings.length > 0) {
  console.error("Secret scan failed. Findings are redacted by design:");
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`- ${location} [${finding.type}]`);
  }
  process.exit(1);
}

console.log("Secret scan passed: no high-confidence secrets or maintainer-private paths found.");
