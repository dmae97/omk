// ─── MCP Tool Governance ─────────────────────────────────────────────────────
// OMK Protocol Gateway — P1: Tool Governance Layer
//
// Decomposes tool results into three channels:
//   - Model-facing: compressed summary for LLM context optimization
//   - Evidence-facing: raw result for debugging/QA
//   - Audit-facing: immutable record for compliance
//
// Also provides tool-level permission policy, secret redaction, and audit logging.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SECRET_PATTERNS, SECRET_KEY_NAMES } from "./shared-secret-registry.js";

// ─── MCP Tool Result Types ───────────────────────────────────────────────────

/** Raw MCP tool result content block */
export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/** Raw MCP CallToolResult */
export interface McpCallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

// ─── Governed Tool Result ────────────────────────────────────────────────────

/** Model-facing compressed result for LLM context */
export interface ModelFacingResult {
  /** Summarized text content (truncated if needed) */
  summary: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Content type hints for the model */
  contentTypes: string[];
  /** Total character count of original result */
  originalSize: number;
  /** Compression ratio achieved */
  compressionRatio: number;
}

/** Evidence-facing raw result for debugging/QA */
export interface EvidenceFacingResult {
  /** Full raw content blocks */
  content: McpContentBlock[];
  /** Whether the tool call errored */
  isError: boolean;
  /** Server that provided the result */
  serverName: string;
  /** Tool name that was called */
  toolName: string;
  /** Arguments passed (sanitized — no secrets) */
  sanitizedArgs: Record<string, unknown>;
}

/** Audit-facing immutable record for compliance */
export interface AuditRecord {
  /** Unique record ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Tool name */
  toolName: string;
  /** Server name */
  serverName: string;
  /** SHA-256 hash of arguments (for dedup/correlation) */
  argsHash: string;
  /** SHA-256 hash of raw result */
  resultHash: string;
  /** Number of content blocks */
  contentBlockCount: number;
  /** Whether secrets were redacted */
  secretsRedacted: boolean;
  /** Number of secrets found and redacted */
  secretCount: number;
  /** Whether the result was truncated */
  truncated: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether the call errored */
  isError: boolean;
  /** Error message if isError */
  errorMessage?: string;
}

/** Full governed tool result with all three channels */
export interface GovernedToolResult {
  /** Model-facing: compressed for LLM context */
  model: ModelFacingResult;
  /** Evidence-facing: raw for debugging */
  evidence: EvidenceFacingResult;
  /** Audit-facing: immutable record */
  audit: AuditRecord;
}

// ─── Tool Governance Policy ──────────────────────────────────────────────────

export interface ToolGovernancePolicy {
  /** Tool name patterns to allow (glob-style, null = allow all) */
  allowTools: string[] | null;
  /** Tool name patterns to deny */
  denyTools: string[];
  /** Maximum content size in chars before truncation (default: 4000) */
  maxModelContentChars: number;
  /** Whether to enable secret redaction (default: true) */
  enableSecretRedaction: boolean;
  /** Whether to enable audit logging (default: true) */
  enableAuditLog: boolean;
  /** Maximum audit log entries (ring buffer, default: 1000) */
  maxAuditEntries: number;
  /** Custom secret patterns to add to defaults */
  customSecretPatterns?: RegExp[];
  /** Tools that bypass governance entirely (raw passthrough) */
  bypassGovernance: string[];
}

// ─── Tool Permission Types (P2.2) ───────────────────────────────────────────

/** Permission level for MCP tool access */
export enum ToolPermissionLevel {
  /** Tool is allowed without additional consent */
  ALLOW = "allow",
  /** Tool requires explicit user consent before execution */
  ASK = "ask",
  /** Tool is denied — cannot be executed */
  DENY = "deny",
}

/** A single tool permission rule matching tool name patterns */
export interface ToolPermissionRule {
  /** Glob-style tool name pattern (e.g. "github:*", "browser_click") */
  pattern: string;
  /** Permission level for matching tools */
  permission: ToolPermissionLevel;
  /** Optional reason for audit trail */
  reason?: string;
  /** Rule priority — higher overrides lower (default: 0) */
  priority?: number;
}

/** Resolved permission for a specific tool invocation */
export interface ResolvedToolPermission {
  /** Final permission level */
  permission: ToolPermissionLevel;
  /** Rule that determined this permission (null = default) */
  matchedRule: ToolPermissionRule | null;
  /** Whether this was resolved from server-level policy */
  serverLevel: boolean;
  /** Whether governance layer bypass is active */
  governanceBypass: boolean;
}

const DEFAULT_GOVERNANCE_POLICY: ToolGovernancePolicy = {
  allowTools: null,
  denyTools: [],
  maxModelContentChars: 4000,
  enableSecretRedaction: true,
  enableAuditLog: true,
  maxAuditEntries: 1000,
  bypassGovernance: [],
};

// ─── Secret Redaction Engine ─────────────────────────────────────────────────

interface RedactPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** Derive redaction patterns from shared registry */
const DEFAULT_SECRET_PATTERNS: RedactPattern[] = SECRET_PATTERNS.map((sp) => ({
  name: sp.name,
  pattern: sp.pattern,
  replacement: `[REDACTED_${sp.name.toUpperCase()}]`,
}));

// ─── P2.4: Governance Rules ─────────────────────────────────────────────────

/** Severity level for governance rules */
export enum RuleSeverity {
  /** Critical — always blocks, cannot be overridden by lower-priority rules */
  CRITICAL = "critical",
  /** High — blocks unless explicitly overridden */
  HIGH = "high",
  /** Medium — standard rule, follows normal priority resolution */
  MEDIUM = "medium",
  /** Low — advisory, only applies if no higher-severity rule matches */
  LOW = "low",
  /** Info — informational only, logged but not enforced */
  INFO = "info",
}

/** Extended permission rule with severity and server scoping */
export interface GovernanceRule extends ToolPermissionRule {
  /** Rule severity level (default: MEDIUM) */
  severity?: RuleSeverity;
  /** MCP server name this rule applies to (null = all servers) */
  serverName?: string;
  /** Rule category for grouping/filtering */
  category?: string;
  /** Whether this rule is currently enabled */
  enabled?: boolean;
  /** ISO 8601 timestamp when the rule was created */
  createdAt?: string;
}

/** Named governance rule preset */
export interface GovernancePreset {
  /** Preset identifier (e.g. "strict", "permissive", "development") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Rules included in this preset */
  rules: GovernanceRule[];
  /** Default permission level when no rule matches */
  defaultPermission: ToolPermissionLevel;
}

/** Create a GovernanceRule with defaults */
export function createRule(
  pattern: string,
  permission: ToolPermissionLevel,
  options?: {
    severity?: RuleSeverity;
    reason?: string;
    priority?: number;
    serverName?: string;
    category?: string;
  },
): GovernanceRule {
  return {
    pattern,
    permission,
    severity: options?.severity ?? RuleSeverity.MEDIUM,
    reason: options?.reason,
    priority: options?.priority ?? 0,
    serverName: options?.serverName,
    category: options?.category,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

// ─── Predefined Governance Presets ──────────────────────────────────────────

const CRITICAL_DENY_RULES: GovernanceRule[] = [
  // Destructive file operations
  createRule("*rm_rf*", ToolPermissionLevel.DENY, {
    severity: RuleSeverity.CRITICAL,
    reason: "Recursive delete is extremely dangerous",
    category: "destructive",
  }),
  createRule("*git_reset_hard*", ToolPermissionLevel.DENY, {
    severity: RuleSeverity.CRITICAL,
    reason: "Hard reset discards all uncommitted changes",
    category: "destructive",
  }),
  createRule("*git_push_force*", ToolPermissionLevel.DENY, {
    severity: RuleSeverity.CRITICAL,
    reason: "Force push can overwrite remote history",
    category: "destructive",
  }),
  // Dangerous shell commands
  createRule("*chmod_777*", ToolPermissionLevel.DENY, {
    severity: RuleSeverity.CRITICAL,
    reason: "chmod 777 gives full permissions to everyone",
    category: "security",
  }),
  createRule("*curl_pipe*", ToolPermissionLevel.DENY, {
    severity: RuleSeverity.CRITICAL,
    reason: "Piping curl to shell is a remote code execution risk",
    category: "security",
  }),
];

/** Strict preset — deny by default, only explicitly allowed tools pass */
export const STRICT_PRESET: GovernancePreset = {
  name: "strict",
  description: "Maximum safety. Denies all tools unless explicitly allowed. Requires consent for most operations.",
  rules: [
    ...CRITICAL_DENY_RULES,
    // File operations — ASK
    createRule("read*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file", reason: "Read-only file access" }),
    createRule("write*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "file", reason: "File write requires consent" }),
    createRule("edit*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "file", reason: "File edit requires consent" }),
    createRule("delete*", ToolPermissionLevel.DENY, { severity: RuleSeverity.HIGH, category: "file", reason: "File deletion denied by default" }),
    // Git operations — ASK
    createRule("git_*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "git", reason: "Git operations require consent" }),
    // Shell — ASK
    createRule("bash*", ToolPermissionLevel.ASK, { severity: RuleSeverity.HIGH, category: "shell", reason: "Shell commands require consent" }),
    createRule("shell*", ToolPermissionLevel.ASK, { severity: RuleSeverity.HIGH, category: "shell", reason: "Shell commands require consent" }),
    // Browser — ASK
    createRule("browser_*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "browser", reason: "Browser operations require consent" }),
    // GitHub — ASK for write, ALLOW for read
    createRule("github_get_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github", reason: "GitHub read operations" }),
    createRule("github_list_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github", reason: "GitHub list operations" }),
    createRule("github_search_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github", reason: "GitHub search operations" }),
    createRule("github_*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "github", reason: "GitHub write operations require consent" }),
  ],
  defaultPermission: ToolPermissionLevel.ASK,
};

/** Permissive preset — allow most operations, only deny dangerous ones */
export const PERMISSIVE_PRESET: GovernancePreset = {
  name: "permissive",
  description: "Low friction. Allows most operations. Only denies critically dangerous commands.",
  rules: [
    ...CRITICAL_DENY_RULES,
    // Most operations allowed
    createRule("read*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("write*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("edit*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("git_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "git" }),
    createRule("github_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github" }),
    createRule("browser_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "browser" }),
    // Shell — ASK (still needs consent)
    createRule("bash*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "shell", reason: "Shell commands still need consent" }),
    createRule("shell*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "shell", reason: "Shell commands still need consent" }),
    // Delete — ASK
    createRule("delete*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "file", reason: "Deletion needs confirmation" }),
  ],
  defaultPermission: ToolPermissionLevel.ALLOW,
};

/** Development preset — balanced for local dev work */
export const DEVELOPMENT_PRESET: GovernancePreset = {
  name: "development",
  description: "Balanced for local development. Allows common dev operations, asks for risky ones.",
  rules: [
    ...CRITICAL_DENY_RULES,
    // File operations — ALLOW
    createRule("read*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("write*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("edit*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("glob*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    createRule("grep*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "file" }),
    // Git — ALLOW for read, ASK for write
    createRule("git_status*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "git" }),
    createRule("git_log*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "git" }),
    createRule("git_diff*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "git" }),
    createRule("git_commit*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.MEDIUM, category: "git" }),
    createRule("git_push*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "git", reason: "Push requires consent" }),
    createRule("git_*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "git" }),
    // GitHub — similar split
    createRule("github_get_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github" }),
    createRule("github_list_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github" }),
    createRule("github_search_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github" }),
    createRule("github_create_pull_request", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "github", reason: "PR creation requires consent" }),
    createRule("github_merge_pull_request", ToolPermissionLevel.ASK, { severity: RuleSeverity.HIGH, category: "github", reason: "PR merge requires consent" }),
    createRule("github_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "github" }),
    // Shell — ASK
    createRule("bash*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "shell" }),
    createRule("shell*", ToolPermissionLevel.ASK, { severity: RuleSeverity.MEDIUM, category: "shell" }),
    // Browser — ALLOW
    createRule("browser_*", ToolPermissionLevel.ALLOW, { severity: RuleSeverity.LOW, category: "browser" }),
  ],
  defaultPermission: ToolPermissionLevel.ALLOW,
};

/** All available presets */
export const GOVERNANCE_PRESETS: Record<string, GovernancePreset> = {
  strict: STRICT_PRESET,
  permissive: PERMISSIVE_PRESET,
  development: DEVELOPMENT_PRESET,
};

/** Get a preset by name */
export function getPreset(name: string): GovernancePreset | undefined {
  return GOVERNANCE_PRESETS[name];
}

/** List all available preset names */
export function listPresets(): string[] {
  return Object.keys(GOVERNANCE_PRESETS);
}

export function redactSecrets(text: string, customPatterns?: RegExp[]): { redacted: string; count: number } {
  let count = 0;
  let result = text;

  for (const sp of DEFAULT_SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    sp.pattern.lastIndex = 0;
    const matches = result.match(sp.pattern);
    if (matches) {
      count += matches.length;
      sp.pattern.lastIndex = 0;
      result = result.replace(sp.pattern, sp.replacement);
    }
  }

  if (customPatterns) {
    for (const pattern of customPatterns) {
      pattern.lastIndex = 0;
      const matches = result.match(pattern);
      if (matches) {
        count += matches.length;
        pattern.lastIndex = 0;
        result = result.replace(pattern, "[REDACTED]");
      }
    }
  }

  return { redacted: result, count };
}

// ─── Result Compression ──────────────────────────────────────────────────────

export function compressResult(
  content: McpContentBlock[],
  maxChars: number,
): { summary: string; truncated: boolean; originalSize: number } {
  // Extract all text content
  const textParts: string[] = [];
  let totalSize = 0;

  for (const block of content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
      totalSize += block.text.length;
    } else if (block.type === "image") {
      textParts.push(`[image: ${block.mimeType || "unknown"}]`);
      totalSize += block.data?.length ?? 0;
    } else if (block.type === "resource") {
      textParts.push(`[resource: ${block.mimeType || "unknown"}]`);
      totalSize += JSON.stringify(block).length;
    } else {
      textParts.push(`[${block.type}]`);
      totalSize += JSON.stringify(block).length;
    }
  }

  const fullText = textParts.join("\n");

  if (fullText.length <= maxChars) {
    return { summary: fullText, truncated: false, originalSize: totalSize };
  }

  // Truncation strategy: keep first 70% and last 20%, with indicator in middle
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.2);
  const head = fullText.slice(0, headChars);
  const tail = fullText.slice(-tailChars);
  const omitted = fullText.length - headChars - tailChars;

  return {
    summary: `${head}\n\n[... ${omitted} chars omitted ...]\n\n${tail}`,
    truncated: true,
    originalSize: totalSize,
  };
}

// ─── Argument Sanitization ───────────────────────────────────────────────────

export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const lowerKey = key.toLowerCase();
    const normalized = lowerKey.replace(/[_-]/g, "");
    if (SECRET_KEY_NAMES.has(lowerKey) || SECRET_KEY_NAMES.has(normalized)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      // Check if value looks like a secret
      const { redacted } = redactSecrets(value);
      sanitized[key] = redacted;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ─── Audit Logger ────────────────────────────────────────────────────────────

export class AuditLogger extends EventEmitter {
  private buffer: AuditRecord[];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    super();
    this.buffer = [];
    this.maxSize = maxSize;
  }

  /** Add a record to the audit log (ring buffer) */
  add(record: AuditRecord): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(record);
    this.emit("audit:entry", record);
  }

  /** Get all audit records */
  getAll(): AuditRecord[] {
    return [...this.buffer];
  }

  /** Get last N records */
  getLast(n: number): AuditRecord[] {
    return this.buffer.slice(-n);
  }

  /** Get records for a specific tool */
  getByTool(toolName: string): AuditRecord[] {
    return this.buffer.filter((r) => r.toolName === toolName);
  }

  /** Get records for a specific server */
  getByServer(serverName: string): AuditRecord[] {
    return this.buffer.filter((r) => r.serverName === serverName);
  }

  /** Get error records only */
  getErrors(): AuditRecord[] {
    return this.buffer.filter((r) => r.isError);
  }

  /** Get records with redacted secrets */
  getRedacted(): AuditRecord[] {
    return this.buffer.filter((r) => r.secretsRedacted);
  }

  /** Clear the audit log */
  clear(): void {
    this.buffer = [];
    this.emit("audit:cleared");
  }

  /** Get current size */
  get size(): number {
    return this.buffer.length;
  }
}

// ─── Hashing Utility ─────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

export function hashContent(data: unknown): string {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

// ─── Tool Name Pattern Matching ──────────────────────────────────────────────

/** Glob-style pattern matching for tool names (* and ? supported) */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
  // Exact match (case-insensitive for MCP URI patterns)
  if (toolName === pattern) return true;
  if (pattern.includes("://") && toolName.toLowerCase() === pattern.toLowerCase()) return true;

  // If pattern has wildcards, convert to regex
  if (pattern.includes("*") || pattern.includes("?")) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // escape regex specials (except * and ?)
      .replace(/\*/g, ".*")   // * matches any sequence
      .replace(/\?/g, ".");   // ? matches single char
    const regex = new RegExp("^" + escaped + "$", "i");
    return regex.test(toolName);
  }

  return false;
}

// ─── Permission Matcher (P2.3) ──────────────────────────────────────────────
/**
 * Resolves tool permission from a set of rules.
 *
 * Rules are evaluated in priority order (highest first).
 * First matching rule wins. If no rules match, returns default permission.
 */
export class PermissionMatcher {
  private rules: ToolPermissionRule[];
  private defaultPermission: ToolPermissionLevel;

  /**
   * @param rules Permission rules to evaluate
   * @param defaultPermission Permission when no rules match (default: ASK)
   */
  constructor(
    rules: ToolPermissionRule[] = [],
    defaultPermission: ToolPermissionLevel = ToolPermissionLevel.ASK,
  ) {
    // Sort by priority descending — highest priority first
    this.rules = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.defaultPermission = defaultPermission;
  }

  /**
   * Resolve permission for a tool name.
   *
   * @param toolName Fully qualified tool name (e.g. "github_create_issue", "browser_click")
   * @param serverName Optional server name for server-level resolution
   * @param governanceBypass Whether governance bypass is active for this tool
   * @returns Resolved permission with matched rule info
   */
  resolve(
    toolName: string,
    serverName?: string,
    governanceBypass = false,
  ): ResolvedToolPermission {
    if (governanceBypass) {
      return {
        permission: ToolPermissionLevel.ALLOW,
        matchedRule: null,
        serverLevel: false,
        governanceBypass: true,
      };
    }

    // Try server-qualified pattern first: "server/tool" or "server:tool"
    if (serverName) {
      const qualified = `${serverName}/${toolName}`;
      const serverMatch = this.matchRules(qualified);
      if (serverMatch) {
        return {
          permission: serverMatch.permission,
          matchedRule: serverMatch,
          serverLevel: true,
          governanceBypass: false,
        };
      }
    }

    // Try bare tool name
    const bareMatch = this.matchRules(toolName);
    if (bareMatch) {
      return {
        permission: bareMatch.permission,
        matchedRule: bareMatch,
        serverLevel: false,
        governanceBypass: false,
      };
    }

    // No rules matched — use default
    return {
      permission: this.defaultPermission,
      matchedRule: null,
      serverLevel: false,
      governanceBypass: false,
    };
  }

  /**
   * Get all matching rules for a tool name (for diagnostics).
   */
  getMatchingRules(toolName: string): ToolPermissionRule[] {
    return this.rules.filter((r) => matchesToolPattern(toolName, r.pattern));
  }

  /**
   * Add rules at runtime.
   */
  addRules(rules: ToolPermissionRule[]): void {
    this.rules.push(...rules);
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Replace all rules at runtime.
   */
  updateRules(rules: ToolPermissionRule[]): void {
    this.rules = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Remove rules by pattern.
   */
  removeRules(patterns: string[]): void {
    const patternSet = new Set(patterns);
    this.rules = this.rules.filter((r) => !patternSet.has(r.pattern));
  }

  /**
   * Get current rule count.
   */
  get ruleCount(): number {
    return this.rules.length;
  }

  private matchRules(toolName: string): ToolPermissionRule | null {
    for (const rule of this.rules) {
      if (matchesToolPattern(toolName, rule.pattern)) {
        return rule;
      }
    }
    return null;
  }
}

/** Check if a tool is allowed by the governance policy */
export function isToolAllowed(
  toolName: string,
  policy: Pick<ToolGovernancePolicy, "allowTools" | "denyTools">,
): { allowed: boolean; reason?: string } {
  // Check deny list first
  for (const pattern of policy.denyTools) {
    if (matchesToolPattern(toolName, pattern)) {
      return { allowed: false, reason: `Tool "${toolName}" matches deny pattern "${pattern}"` };
    }
  }

  // If allow list is null, allow all (except denied)
  if (policy.allowTools === null) {
    return { allowed: true };
  }

  // Check allow list
  for (const pattern of policy.allowTools) {
    if (matchesToolPattern(toolName, pattern)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `Tool "${toolName}" not in allow list` };
}

// ─── Tool Governor ───────────────────────────────────────────────────────────

export class ToolGovernor extends EventEmitter {
  private policy: ToolGovernancePolicy;
  private auditLogger: AuditLogger;

  constructor(policy?: Partial<ToolGovernancePolicy>) {
    super();
    this.policy = { ...DEFAULT_GOVERNANCE_POLICY, ...policy };
    this.auditLogger = new AuditLogger(this.policy.maxAuditEntries);

    // Forward audit events
    this.auditLogger.on("audit:entry", (record) => this.emit("audit:entry", record));
    this.auditLogger.on("audit:cleared", () => this.emit("audit:cleared"));
  }

  /** Check if a tool call is permitted */
  checkToolPermission(toolName: string): { allowed: boolean; reason?: string } {
    return isToolAllowed(toolName, this.policy);
  }

  /** Check if a tool bypasses governance */
  shouldBypassGovernance(toolName: string): boolean {
    return this.policy.bypassGovernance.some((p) => matchesToolPattern(toolName, p));
  }

  /** Process a raw tool result through the governance pipeline */
  govern(
    toolName: string,
    serverName: string,
    args: Record<string, unknown>,
    rawResult: unknown,
    durationMs: number,
  ): GovernedToolResult {
    // Normalize raw result to McpCallToolResult
    const normalized = this.normalizeResult(rawResult);

    // ── Secret Redaction ──
    let totalSecretsRedacted = 0;
    let redactedContent = normalized.content;

    if (this.policy.enableSecretRedaction) {
      redactedContent = normalized.content.map((block) => {
        if (block.type === "text" && block.text) {
          const { redacted, count } = redactSecrets(block.text, this.policy.customSecretPatterns);
          totalSecretsRedacted += count;
          return { ...block, text: redacted };
        }
        return block;
      });
    }

    // ── Sanitize Args ──
    const sanitizedArgs = sanitizeArgs(args);

    // ── Compress for Model ──
    const { summary, truncated, originalSize } = compressResult(
      redactedContent,
      this.policy.maxModelContentChars,
    );

    const compressedSize = summary.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

    // ── Build Audit Record ──
    const auditRecord: AuditRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName,
      serverName,
      argsHash: hashContent(sanitizedArgs),
      resultHash: hashContent(normalized.content),
      contentBlockCount: normalized.content.length,
      secretsRedacted: totalSecretsRedacted > 0,
      secretCount: totalSecretsRedacted,
      truncated,
      durationMs,
      isError: normalized.isError ?? false,
      errorMessage: normalized.isError ? this.extractErrorMessage(normalized.content) : undefined,
    };

    // ── Record Audit ──
    if (this.policy.enableAuditLog) {
      this.auditLogger.add(auditRecord);
    }

    // ── Build Governed Result ──
    const result: GovernedToolResult = {
      model: {
        summary,
        success: !(normalized.isError ?? false),
        contentTypes: normalized.content.map((b) => b.type),
        originalSize,
        compressionRatio,
      },
      evidence: {
        content: redactedContent,
        isError: normalized.isError ?? false,
        serverName,
        toolName,
        sanitizedArgs,
      },
      audit: auditRecord,
    };

    return result;
  }

  /** Get the audit logger */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  /** Update governance policy at runtime */
  updatePolicy(update: Partial<ToolGovernancePolicy>): void {
    this.policy = { ...this.policy, ...update };
    this.emit("policy:updated", this.policy);
  }

  /** Get current policy */
  getPolicy(): ToolGovernancePolicy {
    return { ...this.policy };
  }

  // ── Internal Helpers ──

  private normalizeResult(raw: unknown): McpCallToolResult {
    if (raw && typeof raw === "object" && "content" in raw && Array.isArray((raw as McpCallToolResult).content)) {
      return raw as McpCallToolResult;
    }
    // Wrap non-standard results
    return {
      content: [{ type: "text", text: typeof raw === "string" ? raw : JSON.stringify(raw) }],
      isError: false,
    };
  }

  private extractErrorMessage(content: McpContentBlock[]): string | undefined {
    for (const block of content) {
      if (block.type === "text" && block.text) {
        // Try to extract error from text
        const lines = block.text.split("\n");
        const errorLine = lines.find((l) => /error|exception|fail/i.test(l));
        if (errorLine) return errorLine.trim().slice(0, 200);
        return block.text.slice(0, 200);
      }
    }
    return undefined;
  }
}
