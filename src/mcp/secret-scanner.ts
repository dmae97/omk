// ─── Secret Detection & Redaction Engine ──────────────────────────────────────
// OMK Protocol Gateway — P2.6: Secret Scanner
//
// Standalone secret detection engine with:
//   - Severity levels (CRITICAL, HIGH, MEDIUM, LOW)
//   - Multiple scanning modes (QUICK, DEEP, PARANOID)
//   - File and directory scanning
//   - Structured reports with statistics
//   - Custom pattern management
//   - Integration with governance redaction pipeline
//
// Re-exports and extends the patterns from governance.ts redactSecrets().

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { EventEmitter } from "node:events";
import { SECRET_KEY_NAMES } from "./shared-secret-registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Severity of a detected secret */
export enum SecretSeverity {
  /** Confirmed credential — immediate risk (AWS keys, tokens, passwords) */
  CRITICAL = "critical",
  /** High-confidence secret pattern (API keys, JWTs, private keys) */
  HIGH = "high",
  /** Possible secret (generic env vars, hex strings) */
  MEDIUM = "medium",
  /** Low-confidence / informational (short tokens, partial matches) */
  LOW = "low",
}

/** Scanning mode controls depth vs speed tradeoff */
export enum ScanMode {
  /** Fast — common patterns only, no file I/O */
  QUICK = "quick",
  /** Balanced — all patterns, file scanning, context analysis */
  DEEP = "deep",
  /** Thorough — all patterns, entropy analysis, aggressive heuristics */
  PARANOID = "paranoid",
}

/** A single secret detection pattern */
export interface SecretPatternDef {
  /** Unique pattern identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Regex pattern to match (must be global for counting) */
  pattern: RegExp;
  /** Replacement string for redaction */
  replacement: string;
  /** Severity level */
  severity: SecretSeverity;
  /** Pattern category for grouping */
  category: string;
  /** Whether this pattern is enabled */
  enabled: boolean;
  /** Scan mode minimum — only active in this mode or higher */
  minMode: ScanMode;
}

/** A detected secret finding */
export interface SecretFinding {
  /** Unique finding ID */
  id: string;
  /** Pattern that matched */
  patternName: string;
  /** Severity of the finding */
  severity: SecretSeverity;
  /** Category of the pattern */
  category: string;
  /** Matched text (redacted) */
  redactedMatch: string;
  /** Original matched text (NEVER exposed in output) */
  originalLength: number;
  /** Character offset in source text */
  offset: number;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed) */
  column: number;
  /** Source file path (if scanning files) */
  sourceFile?: string;
  /** Context snippet around the match */
  context: string;
}

/** Scan statistics */
export interface ScanStats {
  /** Total patterns checked */
  patternsChecked: number;
  /** Total patterns that matched */
  patternsMatched: number;
  /** Total findings */
  totalFindings: number;
  /** Findings by severity */
  bySeverity: Record<SecretSeverity, number>;
  /** Findings by category */
  byCategory: Record<string, number>;
  /** Total characters scanned */
  charsScanned: number;
  /** Total files scanned (if file scan) */
  filesScanned: number;
  /** Files skipped (binary/too large) */
  filesSkipped: number;
  /** Scan duration in ms */
  durationMs: number;
  /** Scan mode used */
  mode: ScanMode;
}

/** Full scan report */
export interface ScanReport {
  /** Report ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Scan mode used */
  mode: ScanMode;
  /** All findings */
  findings: SecretFinding[];
  /** Redacted text (if text scan) */
  redactedText?: string;
  /** Statistics */
  stats: ScanStats;
  /** Whether any CRITICAL or HIGH findings exist */
  hasCriticalFindings: boolean;
  /** Summary line for CLI display */
  summary: string;
}

/** Options for the scanner */
export interface ScannerOptions {
  /** Scan mode (default: DEEP) */
  mode?: ScanMode;
  /** Custom patterns to add */
  customPatterns?: SecretPatternDef[];
  /** Disabled pattern names */
  disabledPatterns?: string[];
  /** Max file size to scan in bytes (default: 1MB) */
  maxFileSize?: number;
  /** File extensions to include (default: text files) */
  includeExtensions?: string[];
  /** File extensions to exclude */
  excludeExtensions?: string[];
  /** Directories to exclude */
  excludeDirs?: string[];
  /** Max context chars around each match (default: 40) */
  contextChars?: number;
  /** Source label for reports */
  sourceLabel?: string;
}

// ─── Built-in Secret Patterns ────────────────────────────────────────────────

const BUILTIN_PATTERNS: SecretPatternDef[] = [
  // CRITICAL — confirmed credentials
  {
    name: "aws_access_key",
    description: "AWS Access Key ID",
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
    severity: SecretSeverity.CRITICAL,
    category: "cloud",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "aws_secret_key",
    description: "AWS Secret Access Key",
    pattern: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    replacement: "[REDACTED_AWS_SECRET]",
    severity: SecretSeverity.CRITICAL,
    category: "cloud",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "private_key",
    description: "PEM Private Key",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
    severity: SecretSeverity.CRITICAL,
    category: "crypto",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "github_token",
    description: "GitHub Personal Access Token",
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
    severity: SecretSeverity.CRITICAL,
    category: "scm",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "gitlab_token",
    description: "GitLab Personal Access Token",
    pattern: /glpat-[A-Za-z0-9_\-]{20,}/g,
    replacement: "[REDACTED_GITLAB_TOKEN]",
    severity: SecretSeverity.CRITICAL,
    category: "scm",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "slack_token",
    description: "Slack Bot/User/Workspace Token",
    pattern: /xox[bpoas]-[A-Za-z0-9\-]{10,}/g,
    replacement: "[REDACTED_SLACK_TOKEN]",
    severity: SecretSeverity.CRITICAL,
    category: "messaging",
    enabled: true,
    minMode: ScanMode.QUICK,
  },

  // HIGH — strong patterns for API keys and tokens
  {
    name: "openai_key",
    description: "OpenAI API Key",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "[REDACTED_OPENAI_KEY]",
    severity: SecretSeverity.HIGH,
    category: "ai",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "anthropic_key",
    description: "Anthropic API Key",
    pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g,
    replacement: "[REDACTED_ANTHROPIC_KEY]",
    severity: SecretSeverity.HIGH,
    category: "ai",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "google_api_key",
    description: "Google API Key",
    pattern: /AIza[A-Za-z0-9_\-]{35}/g,
    replacement: "[REDACTED_GOOGLE_KEY]",
    severity: SecretSeverity.HIGH,
    category: "cloud",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "jwt_token",
    description: "JSON Web Token",
    pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
    replacement: "[REDACTED_JWT]",
    severity: SecretSeverity.HIGH,
    category: "auth",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "bearer_token",
    description: "Bearer Authorization Token",
    pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
    severity: SecretSeverity.HIGH,
    category: "auth",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "api_key_generic",
    description: "Generic API Key assignment",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
    replacement: "[REDACTED_API_KEY]",
    severity: SecretSeverity.HIGH,
    category: "auth",
    enabled: true,
    minMode: ScanMode.QUICK,
  },
  {
    name: "connection_string",
    description: "Database Connection String with Password",
    pattern: /(?:mongodb|postgres|mysql|redis|mssql):\/\/[^:]+:([^@]+)@/gi,
    replacement: "://[REDACTED]:[REDACTED]@",
    severity: SecretSeverity.HIGH,
    category: "database",
    enabled: true,
    minMode: ScanMode.QUICK,
  },

  // MEDIUM — generic env-style secrets
  {
    name: "secret_env_var",
    description: "Secret Environment Variable Assignment",
    pattern: /(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    replacement: "[REDACTED_SECRET]",
    severity: SecretSeverity.MEDIUM,
    category: "env",
    enabled: true,
    minMode: ScanMode.DEEP,
  },
  {
    name: "hex_secret",
    description: "Hex-encoded Secret",
    pattern: /(?:secret|key|token|password)\s*[:=]\s*["']?([a-f0-9]{32,})["']?/gi,
    replacement: "[REDACTED_HEX_SECRET]",
    severity: SecretSeverity.MEDIUM,
    category: "env",
    enabled: true,
    minMode: ScanMode.DEEP,
  },

  // LOW — paranoid-mode patterns
  {
    name: "base64_long",
    description: "Long Base64 String (potential encoded secret)",
    pattern: /["']?[A-Za-z0-9+/]{60,}={0,2}["']?/g,
    replacement: "[REDACTED_BASE64]",
    severity: SecretSeverity.LOW,
    category: "encoded",
    enabled: true,
    minMode: ScanMode.PARANOID,
  },
  {
    name: "hex_long",
    description: "Long Hex String (potential encoded secret)",
    pattern: /["']?[a-f0-9]{64,}["']?/gi,
    replacement: "[REDACTED_HEX]",
    severity: SecretSeverity.LOW,
    category: "encoded",
    enabled: true,
    minMode: ScanMode.PARANOID,
  },
];

// ─── Key Name Patterns (for arg sanitization) ───────────────────────────────

/** Known secret key names for arg-level redaction */
// Re-exported from shared-secret-registry.ts (P2.7.6: eliminate duplication)
export { SECRET_KEY_NAMES };

// ─── Scanner Class ───────────────────────────────────────────────────────────

export class SecretScanner extends EventEmitter {
  private patterns: SecretPatternDef[];
  private mode: ScanMode;
  private maxFileSize: number;
  private includeExtensions: Set<string>;
  private excludeExtensions: Set<string>;
  private excludeDirs: Set<string>;
  private contextChars: number;
  private sourceLabel: string;

  private static readonly DEFAULT_TEXT_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".yaml", ".yml", ".toml",
    ".env", ".env.local", ".env.production", ".env.development",
    ".md", ".txt", ".csv", ".log",
    ".sh", ".bash", ".zsh", ".fish",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".xml", ".html", ".css", ".scss",
    ".cfg", ".conf", ".ini", ".properties",
    ".pem", ".key", ".crt", ".cer",
  ]);

  private static readonly DEFAULT_EXCLUDE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", "__pycache__",
    ".cache", ".venv", "vendor", "coverage", ".turbo",
  ]);

  private static readonly BINARY_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".sqlite", ".db",
  ]);

  constructor(options?: ScannerOptions) {
    super();
    this.mode = options?.mode ?? ScanMode.DEEP;
    this.maxFileSize = options?.maxFileSize ?? 1024 * 1024; // 1MB
    this.includeExtensions = options?.includeExtensions
      ? new Set(options.includeExtensions)
      : SecretScanner.DEFAULT_TEXT_EXTENSIONS;
    this.excludeExtensions = new Set([
      ...SecretScanner.BINARY_EXTENSIONS,
      ...(options?.excludeExtensions ?? []),
    ]);
    this.excludeDirs = new Set([
      ...SecretScanner.DEFAULT_EXCLUDE_DIRS,
      ...(options?.excludeDirs ?? []),
    ]);
    this.contextChars = options?.contextChars ?? 40;
    this.sourceLabel = options?.sourceLabel ?? "input";

    // Build active pattern list
    const disabled = new Set(options?.disabledPatterns ?? []);
    this.patterns = [
      ...BUILTIN_PATTERNS.filter((p) => !disabled.has(p.name)),
      ...(options?.customPatterns ?? []),
    ];
  }

  // ── Text Scanning ──

  /** Scan text for secrets. Returns report with findings and redacted text. */
  scanText(text: string, sourceLabel?: string): ScanReport {
    const start = Date.now();
    const findings: SecretFinding[] = [];
    let redacted = text;
    const activePatterns = this.getActivePatterns();

    for (const pattern of activePatterns) {
      pattern.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.pattern.exec(text)) !== null) {
        const matchedText = match[0];
        const offset = match.index;
        const { line, column } = this.getLineColumn(text, offset);
        const context = this.getContext(text, offset, matchedText.length);

        findings.push({
          id: this.generateId(),
          patternName: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          redactedMatch: pattern.replacement,
          originalLength: matchedText.length,
          offset,
          line,
          column,
          sourceFile: sourceLabel ?? this.sourceLabel,
          context,
        });

        this.emit("finding", findings[findings.length - 1]);
      }

      // Apply redaction
      pattern.pattern.lastIndex = 0;
      redacted = redacted.replace(pattern.pattern, pattern.replacement);
    }

    const durationMs = Date.now() - start;
    const stats = this.buildStats(findings, activePatterns.length, text.length, 0, 0, durationMs);
    const report = this.buildReport(findings, stats, redacted);

    this.emit("scan:complete", report);
    return report;
  }

  // ── File Scanning ──

  /** Scan a single file for secrets. */
  async scanFile(filePath: string): Promise<ScanReport> {
    const start = Date.now();
    const content = await this.readFileSafe(filePath);

    if (content === null) {
      // Binary or unreadable — return empty report
      const durationMs = Date.now() - start;
      return this.buildReport([], this.buildStats([], 0, 0, 0, 1, durationMs, ScanMode.QUICK));
    }

    const findings = this.findInText(content, filePath);
    const redacted = this.redactText(content);
    const durationMs = Date.now() - start;
    const stats = this.buildStats(findings, this.getActivePatterns().length, content.length, 1, 0, durationMs);
    const report = this.buildReport(findings, stats, redacted);

    this.emit("scan:complete", report);
    return report;
  }

  /** Scan a directory recursively for secrets. */
  async scanDir(dirPath: string): Promise<ScanReport> {
    const start = Date.now();
    const allFindings: SecretFinding[] = [];
    let totalChars = 0;
    let filesScanned = 0;
    let filesSkipped = 0;

    const files = await this.walkDir(dirPath);
    const activePatterns = this.getActivePatterns();

    for (const filePath of files) {
      const content = await this.readFileSafe(filePath);
      if (content === null) {
        filesSkipped++;
        continue;
      }

      filesScanned++;
      totalChars += content.length;
      const findings = this.findInText(content, filePath);
      allFindings.push(...findings);

      this.emit("file:scanned", { path: filePath, findings: findings.length });
    }

    const durationMs = Date.now() - start;
    const stats = this.buildStats(allFindings, activePatterns.length, totalChars, filesScanned, filesSkipped, durationMs);
    const report = this.buildReport(allFindings, stats);

    this.emit("scan:complete", report);
    return report;
  }

  // ── Arg Sanitization ──

  /** Sanitize tool arguments, redacting known secret key names. */
  sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const lowerKey = key.toLowerCase();
      const normalized = lowerKey.replace(/[_-]/g, "");

      if (SECRET_KEY_NAMES.has(lowerKey) || SECRET_KEY_NAMES.has(normalized)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        sanitized[key] = this.redactText(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeArgs(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  // ── Pattern Management ──

  /** Get all active patterns for current mode. */
  getActivePatterns(): SecretPatternDef[] {
    const modeOrder = ScanMode.QUICK === this.mode ? 0 : this.mode === ScanMode.DEEP ? 1 : 2;
    return this.patterns.filter((p) => {
      if (!p.enabled) return false;
      const pMode = p.minMode === ScanMode.QUICK ? 0 : p.minMode === ScanMode.DEEP ? 1 : 2;
      return pMode <= modeOrder;
    });
  }

  /** Add a custom pattern at runtime. */
  addPattern(pattern: SecretPatternDef): void {
    this.patterns.push(pattern);
  }

  /** Remove a pattern by name. */
  removePattern(name: string): boolean {
    const idx = this.patterns.findIndex((p) => p.name === name);
    if (idx >= 0) {
      this.patterns.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Enable or disable a pattern. */
  setPatternEnabled(name: string, enabled: boolean): boolean {
    const pattern = this.patterns.find((p) => p.name === name);
    if (pattern) {
      pattern.enabled = enabled;
      return true;
    }
    return false;
  }

  /** List all registered patterns. */
  listPatterns(): SecretPatternDef[] {
    return [...this.patterns];
  }

  // ── Report Formatting ──

  /** Format a scan report for terminal display. */
  static formatReport(report: ScanReport): string {
    const lines: string[] = [];
    const { findings, stats, mode } = report;

    // Header
    const severityIcon = report.hasCriticalFindings ? "🚨" : findings.length > 0 ? "⚠️" : "✅";
    lines.push("");
    lines.push(`  ${severityIcon} Secret Scan Report [${mode.toUpperCase()}]`);
    lines.push("  " + "─".repeat(50));

    if (findings.length === 0) {
      lines.push("  No secrets detected.");
    } else {
      // Group by severity
      const grouped = new Map<SecretSeverity, SecretFinding[]>();
      for (const f of findings) {
        if (!grouped.has(f.severity)) grouped.set(f.severity, []);
        grouped.get(f.severity)!.push(f);
      }

      for (const severity of [SecretSeverity.CRITICAL, SecretSeverity.HIGH, SecretSeverity.MEDIUM, SecretSeverity.LOW]) {
        const group = grouped.get(severity);
        if (!group || group.length === 0) continue;

        const icon = SecretScanner.severityIcon(severity);
        lines.push("");
        lines.push(`  ${icon} ${severity.toUpperCase()} (${group.length})`);

        for (const f of group.slice(0, 10)) {
          const loc = f.sourceFile ? `${f.sourceFile}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
          lines.push(`    ├─ ${f.patternName} @ ${loc}`);
          lines.push(`    │  ${f.context}`);
        }

        if (group.length > 10) {
          lines.push(`    └─ ... and ${group.length - 10} more`);
        }
      }
    }

    // Stats
    lines.push("");
    lines.push("  " + "─".repeat(50));
    lines.push(`  Findings: ${stats.totalFindings} | Critical: ${stats.bySeverity[SecretSeverity.CRITICAL] ?? 0} | High: ${stats.bySeverity[SecretSeverity.HIGH] ?? 0}`);
    lines.push(`  Files: ${stats.filesScanned} scanned, ${stats.filesSkipped} skipped | ${stats.charsScanned.toLocaleString()} chars | ${stats.durationMs}ms`);
    lines.push("");

    return lines.join("\n");
  }

  /** Format a compact summary line. */
  static formatSummary(report: ScanReport): string {
    const { stats, findings } = report;
    if (findings.length === 0) return "✅ No secrets detected";
    const critical = stats.bySeverity[SecretSeverity.CRITICAL] ?? 0;
    const high = stats.bySeverity[SecretSeverity.HIGH] ?? 0;
    const icon = critical > 0 ? "🚨" : "⚠️";
    return `${icon} ${findings.length} secret(s) found (${critical} critical, ${high} high)`;
  }

  /** Get severity icon for terminal display. */
  static severityIcon(severity: SecretSeverity): string {
    switch (severity) {
      case SecretSeverity.CRITICAL: return "🔴";
      case SecretSeverity.HIGH: return "🟠";
      case SecretSeverity.MEDIUM: return "🟡";
      case SecretSeverity.LOW: return "⚪";
    }
  }

  // ── Internal Helpers ──

  private findInText(text: string, sourceFile: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const activePatterns = this.getActivePatterns();

    for (const pattern of activePatterns) {
      pattern.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.pattern.exec(text)) !== null) {
        const matchedText = match[0];
        const offset = match.index;
        const { line, column } = this.getLineColumn(text, offset);
        const context = this.getContext(text, offset, matchedText.length);

        findings.push({
          id: this.generateId(),
          patternName: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          redactedMatch: pattern.replacement,
          originalLength: matchedText.length,
          offset,
          line,
          column,
          sourceFile,
          context,
        });

        this.emit("finding", findings[findings.length - 1]);
      }
    }

    return findings;
  }

  private redactText(text: string): string {
    let result = text;
    for (const pattern of this.getActivePatterns()) {
      pattern.pattern.lastIndex = 0;
      result = result.replace(pattern.pattern, pattern.replacement);
    }
    return result;
  }

  private getLineColumn(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { line, column };
  }

  private getContext(text: string, offset: number, matchLength: number): string {
    const ctxChars = this.contextChars;
    const start = Math.max(0, offset - ctxChars);
    const end = Math.min(text.length, offset + matchLength + ctxChars);
    let snippet = "";

    if (start > 0) snippet += "...";
    snippet += text.slice(start, offset);
    snippet += "█".repeat(Math.min(matchLength, 20));
    snippet += text.slice(offset + matchLength, end);
    if (end < text.length) snippet += "...";

    return snippet.replace(/\n/g, " ").slice(0, 120);
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > this.maxFileSize) return null;

      const ext = extname(filePath).toLowerCase();
      const effectiveExt = ext || (filePath.split(/[/\\]/).pop()?.startsWith(".") ? filePath.split(/[/\\]/).pop()!.toLowerCase() : "");
      if (this.excludeExtensions.has(effectiveExt)) return null;

      const content = await readFile(filePath, "utf-8");
      // Quick binary check: if content has null bytes, skip
      if (content.includes("\0")) return null;

      return content;
    } catch {
      return null;
    }
  }

  private async walkDir(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (current: string) => {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(current, entry.name);

        if (entry.isDirectory()) {
          if (!this.excludeDirs.has(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          // For dotfiles like .env, extname returns "" — check full name
          const effectiveExt = ext || (entry.name.startsWith(".") ? entry.name.toLowerCase() : "");
          if (!this.excludeExtensions.has(effectiveExt) && this.includeExtensions.has(effectiveExt)) {
            results.push(fullPath);
          }
        }
      }
    };

    await walk(dirPath);
    return results;
  }

  private buildStats(
    findings: SecretFinding[],
    patternsChecked: number,
    charsScanned: number,
    filesScanned: number,
    filesSkipped: number,
    durationMs: number,
    mode?: ScanMode,
  ): ScanStats {
    const bySeverity = {} as Record<SecretSeverity, number>;
    const byCategory: Record<string, number> = {};

    for (const severity of Object.values(SecretSeverity)) {
      bySeverity[severity] = 0;
    }

    for (const f of findings) {
      bySeverity[f.severity]++;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    return {
      patternsChecked,
      patternsMatched: new Set(findings.map((f) => f.patternName)).size,
      totalFindings: findings.length,
      bySeverity,
      byCategory,
      charsScanned,
      filesScanned,
      filesSkipped,
      durationMs,
      mode: mode ?? this.mode,
    };
  }

  private buildReport(
    findings: SecretFinding[],
    stats: ScanStats,
    redactedText?: string,
  ): ScanReport {
    const hasCritical = (stats.bySeverity[SecretSeverity.CRITICAL] ?? 0) > 0
      || (stats.bySeverity[SecretSeverity.HIGH] ?? 0) > 0;

    return {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      mode: this.mode,
      findings,
      redactedText,
      stats,
      hasCriticalFindings: hasCritical,
      summary: SecretScanner.formatSummary({ id: "", timestamp: "", mode: this.mode, findings, redactedText, stats, hasCriticalFindings: hasCritical, summary: "" } as ScanReport),
    };
  }

  private generateId(): string {
    return `ss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ─── Convenience Functions ────────────────────────────────────────────────────

/** Quick scan text with default settings. */
export function scanText(text: string, mode?: ScanMode): ScanReport {
  return new SecretScanner({ mode }).scanText(text);
}

/** Quick scan a file. */
export async function scanFile(filePath: string, mode?: ScanMode): Promise<ScanReport> {
  return new SecretScanner({ mode }).scanFile(filePath);
}

/** Quick scan a directory. */
export async function scanDir(dirPath: string, mode?: ScanMode): Promise<ScanReport> {
  return new SecretScanner({ mode }).scanDir(dirPath);
}

/** Redact secrets from text using governance-compatible patterns. */
export function redactSecrets(text: string, customPatterns?: RegExp[]): { redacted: string; count: number } {
  const scanner = new SecretScanner({ mode: ScanMode.DEEP });
  const report = scanner.scanText(text);
  return {
    redacted: report.redactedText ?? text,
    count: report.stats.totalFindings,
  };
}
