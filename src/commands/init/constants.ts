import { fileURLToPath } from "node:url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const packageRoot = join(__dirname, "..", "..", "..");

export const SKILL_COPY_IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

export const PROTECTED_SKILL_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p8$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
];

export const SKILL_SECRET_LITERAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9\-_]{20,}/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bfc-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

export const GENERIC_SKILL_SECRET_ASSIGNMENT =
  /\b(api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["']?([^"'\s;,]{20,})/i;

export const GENERIC_SKILL_SECRET_ALLOWLIST =
  /\$\{|<|YOUR_|REPLACE_|NPM_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|process\.env|env\.|placeholder|example|sample|redacted|\*\*\*|Do not store secrets|Do not send secrets|secret leakage|secret leak/i;

export const DEFAULT_PROJECT_MCP_COMMENT =
  "Project-local MCP config. omk-project is virtual runtime MCP injected; global MCP servers remain in ~/.kimi/mcp.json and must be imported explicitly only after secret review.";
