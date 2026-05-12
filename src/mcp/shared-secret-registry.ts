/**
 * Shared secret pattern and key name registry.
 *
 * Single source of truth for secret detection across:
 * - governance.ts (ToolGovernor redaction)
 * - secret-scanner.ts (file/dir scanning)
 * - host.ts (runtime sanitization)
 *
 * Eliminates inline duplicates in governance.ts and secret-scanner.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretPattern {
  /** Unique name for this pattern */
  name: string;
  /** Regex to detect the secret in text */
  pattern: RegExp;
  /** Category for reporting */
  category: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecretKeyEntry {
  /** The canonical key name (lowercase, no dashes/underscores) */
  key: string;
  /** Known aliases (e.g. "api-key" for "apikey") */
  aliases: string[];
  /** Category for reporting */
  category: string;
}

// ---------------------------------------------------------------------------
// Secret patterns (regex-based detection)
// ---------------------------------------------------------------------------

/**
 * Default secret patterns for runtime redaction and scanning.
 *
 * governance.ts DEFAULT_SECRET_PATTERNS (14 patterns) replaced by this.
 * secret-scanner.ts BUILTIN_PATTERNS remain separate (they use structured
 * ScanPattern with id/severity/scanMode). This registry provides the
 * runtime-fast subset used by ToolGovernor.redactSecrets().
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
    category: 'api-key',
    severity: 'high',
  },
  {
    name: 'bearer',
    pattern: /bearer\s+[-a-zA-Z0-9._~+/]+=*/gi,
    category: 'bearer',
    severity: 'high',
  },
  {
    name: 'aws_key',
    pattern: /(?:AKIA[0-9A-Z]{16})/g,
    category: 'aws',
    severity: 'critical',
  },
  {
    name: 'aws_secret',
    pattern: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
    category: 'aws',
    severity: 'critical',
  },
  {
    name: 'github_token',
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g,
    category: 'github',
    severity: 'critical',
  },
  {
    name: 'gitlab_token',
    pattern: /glpat-[a-zA-Z0-9-]{20,}/g,
    category: 'gitlab',
    severity: 'critical',
  },
  {
    name: 'slack_token',
    pattern: /xox[bpsorta]-[a-zA-Z0-9-]{10,}/g,
    category: 'slack',
    severity: 'high',
  },
  {
    name: 'google_key',
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    category: 'google',
    severity: 'high',
  },
  {
    name: 'jwt',
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    category: 'jwt',
    severity: 'high',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    category: 'private-key',
    severity: 'critical',
  },
  {
    name: 'secret_var',
    pattern: /(?:secret|SECRET)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{16,})['"]?/g,
    category: 'secret',
    severity: 'medium',
  },
  {
    name: 'openai_key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    category: 'openai',
    severity: 'critical',
  },
  {
    name: 'anthropic_key',
    pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    category: 'anthropic',
    severity: 'critical',
  },
  {
    name: 'connection_string',
    pattern: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'"]+/gi,
    category: 'database',
    severity: 'critical',
  },
  {
    name: 'hex_secret',
    pattern: /(?:secret|token|key)\s*[:=]\s*['"]?([a-f0-9]{32,})['"]?/gi,
    category: 'hex-secret',
    severity: 'high',
  },
];

// ---------------------------------------------------------------------------
// Secret key names (arg sanitization)
// ---------------------------------------------------------------------------

/**
 * Canonical secret key names for argument sanitization.
 *
 * governance.ts inline `secretKeys` Set (16 keys) replaced by this.
 * secret-scanner.ts SECRET_KEY_NAMES (superset) replaced by this.
 *
 * Each entry maps a canonical key to its known aliases.
 * normalizeRuleKey() collapses aliases to canonical form.
 */
const SECRET_KEY_ENTRIES: SecretKeyEntry[] = [
  { key: 'password', aliases: ['passwd', 'pwd'], category: 'credential' },
  { key: 'secret', aliases: ['client_secret', 'clientSecret', 'signing_key', 'signingKey', 'encryption_key', 'encryptionKey', 'master_key', 'masterKey'], category: 'secret' },
  { key: 'token', aliases: ['access_token', 'accessToken', 'refresh_token', 'refreshToken'], category: 'token' },
  { key: 'apikey', aliases: ['api_key', 'api-key'], category: 'api-key' },
  { key: 'auth', aliases: ['authorization'], category: 'auth' },
  { key: 'credential', aliases: ['credentials'], category: 'credential' },
  { key: 'privatekey', aliases: ['private_key'], category: 'private-key' },
  { key: 'sessionid', aliases: ['session_id', 'sessionId'], category: 'session' },
];

/**
 * Flat set of all secret key names (canonical + aliases).
 * Used for O(1) lookup in arg sanitization.
 */
export const SECRET_KEY_NAMES: ReadonlySet<string> = new Set(
  SECRET_KEY_ENTRIES.flatMap((e) => [e.key, ...e.aliases]),
);

/**
 * Canonical key lookup map (alias → canonical key).
 */
const CANONICAL_MAP: ReadonlyMap<string, string> = new Map(
  SECRET_KEY_ENTRIES.flatMap((e) =>
    [[e.key, e.key], ...e.aliases.map((a): [string, string] => [a, e.key])],
  ),
);

/**
 * Normalize a rule/arg key to its canonical form.
 * Strips dashes, underscores, lowercases, then looks up in canonical map.
 *
 * Examples:
 *   "api-key" → "apikey"
 *   "API_KEY" → "apikey"
 *   "access_token" → "token"
 *   "clientSecret" → "secret"
 */
export function normalizeRuleKey(key: string): string {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return CANONICAL_MAP.get(lower) ?? lower;
}

/**
 * Check if a key is a secret key (O(1) lookup).
 */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return CANONICAL_MAP.has(lower);
}

/**
 * Get all entries (for reporting/config UI).
 */
export function getSecretKeyEntries(): readonly SecretKeyEntry[] {
  return SECRET_KEY_ENTRIES;
}
