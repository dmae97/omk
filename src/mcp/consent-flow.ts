// ─── MCP Consent Flow ───────────────────────────────────────────────────────
// OMK Protocol Gateway — P2.5: Consent Flow UI
//
// When a tool resolves to ToolPermissionLevel.ASK, this module provides:
//   - Consent request formatting for terminal display
//   - Decision recording (allow/deny, once/always)
//   - Persistent decision storage (session-scoped or permanent)
//   - Integration hook for PermissionMatcher

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  ToolPermissionLevel,
  type ResolvedToolPermission,
  type GovernanceRule,
} from "./governance.js";

// ─── Consent Decision Types ─────────────────────────────────────────────────

/** User's consent decision */
export enum ConsentDecision {
  /** Allow this single invocation */
  ALLOW_ONCE = "allow_once",
  /** Deny this single invocation */
  DENY_ONCE = "deny_once",
  /** Allow always for this tool pattern (session-scoped) */
  ALLOW_ALWAYS = "allow_always",
  /** Deny always for this tool pattern (session-scoped) */
  DENY_ALWAYS = "deny_always",
}

/** Scope for persistent decisions */
export enum ConsentScope {
  /** Only for this session */
  SESSION = "session",
  /** Persist across sessions (stored in config) */
  PERMANENT = "permanent",
}

// ─── Consent Request ────────────────────────────────────────────────────────

/** A pending consent request presented to the user */
export interface ConsentRequest {
  /** Unique request ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Tool name being invoked */
  toolName: string;
  /** MCP server providing the tool */
  serverName: string;
  /** Arguments passed to the tool (sanitized) */
  args: Record<string, unknown>;
  /** Resolved permission that triggered this request */
  permission: ResolvedToolPermission;
  /** Matched rule reason (if any) */
  reason?: string;
  /** Rule severity */
  severity?: string;
  /** Rule category */
  category?: string;
}

/** Result of a consent flow */
export interface ConsentResult {
  /** The decision made */
  decision: ConsentDecision;
  /** The original request */
  request: ConsentRequest;
  /** ISO 8601 timestamp of decision */
  decidedAt: string;
  /** Scope of the decision */
  scope: ConsentScope;
}

// ─── Consent Store ──────────────────────────────────────────────────────────

/** Stored consent decision for future reference */
export interface StoredConsent {
  /** Tool name pattern */
  toolPattern: string;
  /** Server name (null = any server) */
  serverName: string | null;
  /** Decision (allow or deny) */
  permission: ToolPermissionLevel.ALLOW | ToolPermissionLevel.DENY;
  /** Scope */
  scope: ConsentScope;
  /** ISO 8601 timestamp when stored */
  storedAt: string;
  /** Optional reason */
  reason?: string;
}

// ─── Consent Flow Manager ───────────────────────────────────────────────────

export interface ConsentFlowOptions {
  /** Auto-deny if no response within timeout (ms, 0 = no timeout) */
  timeoutMs?: number;
  /** Default scope for decisions */
  defaultScope?: ConsentScope;
  /** Whether to emit events for UI integration */
  emitEvents?: boolean;
}

export class ConsentFlowManager extends EventEmitter {
  private decisions: Map<string, StoredConsent> = new Map();
  private pendingRequests: Map<string, ConsentRequest> = new Map();
  private options: Required<ConsentFlowOptions>;

  constructor(options?: ConsentFlowOptions) {
    super();
    this.options = {
      timeoutMs: options?.timeoutMs ?? 0,
      defaultScope: options?.defaultScope ?? ConsentScope.SESSION,
      emitEvents: options?.emitEvents ?? true,
    };
  }

  // ── Consent Check ─────────────────────────────────────────────────────

  /**
   * Check if a tool invocation needs consent.
   * Returns null if already decided, or a ConsentRequest if user input is needed.
   */
  checkConsent(
    toolName: string,
    serverName: string,
    args: Record<string, unknown>,
    resolved: ResolvedToolPermission,
  ): ConsentRequest | null {
    // If permission is not ASK, no consent needed
    if (resolved.permission !== ToolPermissionLevel.ASK) {
      return null;
    }

    // Check if we have a stored decision
    const stored = this.getStoredDecision(toolName, serverName);
    if (stored) {
      // Stored decision applies — no consent needed
      return null;
    }

    // Create a consent request
    const request: ConsentRequest = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName,
      serverName,
      args,
      permission: resolved,
      reason: resolved.matchedRule?.reason,
      severity: (resolved.matchedRule as GovernanceRule)?.severity,
      category: (resolved.matchedRule as GovernanceRule)?.category,
    };

    this.pendingRequests.set(request.id, request);

    if (this.options.emitEvents) {
      this.emit("consent:required", request);
    }

    return request;
  }

  /**
   * Record a user's consent decision.
   */
  recordDecision(
    requestId: string,
    decision: ConsentDecision,
    scope?: ConsentScope,
  ): ConsentResult {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`No pending consent request with id: ${requestId}`);
    }

    const effectiveScope = scope ?? this.options.defaultScope;
    const decidedAt = new Date().toISOString();

    // Store the decision if it's an "always" type
    if (decision === ConsentDecision.ALLOW_ALWAYS || decision === ConsentDecision.DENY_ALWAYS) {
      const stored: StoredConsent = {
        toolPattern: request.toolName,
        serverName: request.serverName,
        permission: decision === ConsentDecision.ALLOW_ALWAYS
          ? ToolPermissionLevel.ALLOW
          : ToolPermissionLevel.DENY,
        scope: effectiveScope,
        storedAt: decidedAt,
        reason: `User consent: ${decision}`,
      };
      this.decisions.set(this.makeKey(request.toolName, request.serverName), stored);
    }

    // Remove from pending
    this.pendingRequests.delete(requestId);

    const result: ConsentResult = {
      decision,
      request,
      decidedAt,
      scope: effectiveScope,
    };

    if (this.options.emitEvents) {
      this.emit("consent:decided", result);
    }

    return result;
  }

  /**
   * Resolve permission considering stored consent decisions.
   * Returns the effective permission (ALLOW/DENY) or null if still ASK.
   */
  resolveConsent(
    toolName: string,
    serverName: string,
  ): ToolPermissionLevel.ALLOW | ToolPermissionLevel.DENY | null {
    const stored = this.getStoredDecision(toolName, serverName);
    if (stored) {
      return stored.permission;
    }
    return null;
  }

  // ── Decision Management ───────────────────────────────────────────────

  /**
   * Get all stored decisions.
   */
  getStoredDecisions(): StoredConsent[] {
    return Array.from(this.decisions.values());
  }

  /**
   * Remove a stored decision by tool pattern.
   */
  removeDecision(toolPattern: string, serverName?: string): boolean {
    const key = this.makeKey(toolPattern, serverName ?? null);
    return this.decisions.delete(key);
  }

  /**
   * Clear all stored decisions.
   */
  clearDecisions(): void {
    this.decisions.clear();
  }

  /**
   * Get pending consent requests.
   */
  getPendingRequests(): ConsentRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Cancel a pending consent request.
   */
  cancelRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      this.pendingRequests.delete(requestId);
      if (this.options.emitEvents) {
        this.emit("consent:cancelled", request);
      }
      return true;
    }
    return false;
  }

  // ── Display Formatting ────────────────────────────────────────────────

  /**
   * Format a consent request for terminal display.
   */
  static formatRequest(request: ConsentRequest): string {
    const lines: string[] = [];
    const severity = request.severity?.toUpperCase() ?? "MEDIUM";
    const icon = ConsentFlowManager.getSeverityIcon(severity);

    lines.push("");
    lines.push(`${icon}  Consent Required — ${severity}`);
    lines.push("─".repeat(50));
    lines.push(`  Tool:     ${request.toolName}`);
    lines.push(`  Server:   ${request.serverName}`);

    if (request.category) {
      lines.push(`  Category: ${request.category}`);
    }

    if (request.reason) {
      lines.push(`  Reason:   ${request.reason}`);
    }

    // Show sanitized args summary
    const argKeys = Object.keys(request.args);
    if (argKeys.length > 0) {
      lines.push(`  Args:     ${argKeys.length} parameter(s)`);
      for (const key of argKeys.slice(0, 5)) {
        const val = request.args[key];
        const display = typeof val === "string"
          ? (val.length > 60 ? val.slice(0, 57) + "..." : val)
          : typeof val;
        lines.push(`            ${key}: ${display}`);
      }
      if (argKeys.length > 5) {
        lines.push(`            ... and ${argKeys.length - 5} more`);
      }
    }

    lines.push("─".repeat(50));
    lines.push("");
    lines.push("  Options:");
    lines.push("    [y] Allow once    — permit this call only");
    lines.push("    [n] Deny once     — block this call only");
    lines.push("    [Y] Allow always  — always allow this tool");
    lines.push("    [N] Deny always   — always deny this tool");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format a consent result for terminal display.
   */
  static formatResult(result: ConsentResult): string {
    const icon = result.decision.startsWith("allow") ? "✓" : "✗";
    const action = result.decision === ConsentDecision.ALLOW_ONCE ? "Allowed once"
      : result.decision === ConsentDecision.DENY_ONCE ? "Denied once"
      : result.decision === ConsentDecision.ALLOW_ALWAYS ? "Allowed always"
      : "Denied always";

    return `${icon} ${result.request.toolName}: ${action}`;
  }

  private static getSeverityIcon(severity: string): string {
    switch (severity) {
      case "CRITICAL": return "🔴";
      case "HIGH": return "🟠";
      case "MEDIUM": return "🟡";
      case "LOW": return "🟢";
      case "INFO": return "ℹ️";
      default: return "❓";
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────────

  private getStoredDecision(toolName: string, serverName: string): StoredConsent | null {
    // Try exact match first
    const exactKey = this.makeKey(toolName, serverName);
    const exact = this.decisions.get(exactKey);
    if (exact) return exact;

    // Try wildcard server match
    const wildcardKey = this.makeKey(toolName, null);
    const wildcard = this.decisions.get(wildcardKey);
    if (wildcard) return wildcard;

    return null;
  }

  private makeKey(toolName: string, serverName: string | null): string {
    return serverName ? `${serverName}::${toolName}` : `*::${toolName}`;
  }
}

// ─── CLI Consent Prompt ─────────────────────────────────────────────────────

/**
 * Interactive CLI consent prompt using readline.
 * Returns the user's decision.
 */
export async function promptConsent(
  request: ConsentRequest,
  inputStream?: NodeJS.ReadableStream,
  outputStream?: NodeJS.WritableStream,
): Promise<ConsentDecision> {
  const readline = await import("readline");

  const rl = readline.createInterface({
    input: inputStream ?? process.stdin,
    output: outputStream ?? process.stdout,
  });

  const formatted = ConsentFlowManager.formatRequest(request);

  return new Promise<ConsentDecision>((resolve) => {
    rl.question(formatted + "  Your choice [y/n/Y/N]: ", (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();

      switch (choice) {
        case "y":
          resolve(ConsentDecision.ALLOW_ONCE);
          break;
        case "n":
          resolve(ConsentDecision.DENY_ONCE);
          break;
        case "Y":
          resolve(ConsentDecision.ALLOW_ALWAYS);
          break;
        case "N":
          resolve(ConsentDecision.DENY_ALWAYS);
          break;
        default:
          // Default to deny on invalid input
          resolve(ConsentDecision.DENY_ONCE);
          break;
      }
    });
  });
}

// ─── Consent-Aware Permission Resolver ──────────────────────────────────────

/**
 * Wraps a PermissionMatcher with consent flow.
 * When permission resolves to ASK, triggers consent flow.
 */
export class ConsentAwareResolver {
  private consentManager: ConsentFlowManager;

  constructor(consentManager?: ConsentFlowManager) {
    this.consentManager = consentManager ?? new ConsentFlowManager();
  }

  /**
   * Get the underlying consent manager.
   */
  getConsentManager(): ConsentFlowManager {
    return this.consentManager;
  }

  /**
   * Resolve permission with consent flow.
   * Returns ALLOW or DENY (never ASK — consent is resolved before returning).
   */
  resolveWithConsent(
    toolName: string,
    serverName: string,
    args: Record<string, unknown>,
    resolved: ResolvedToolPermission,
  ): {
    permission: ToolPermissionLevel.ALLOW | ToolPermissionLevel.DENY;
    consentRequest?: ConsentRequest;
    consentResult?: ConsentResult;
  } {
    // If not ASK, return directly
    if (resolved.permission !== ToolPermissionLevel.ASK) {
      return { permission: resolved.permission };
    }

    // Check stored consent
    const storedConsent = this.consentManager.resolveConsent(toolName, serverName);
    if (storedConsent) {
      return { permission: storedConsent };
    }

    // Need user consent — create request
    const request = this.consentManager.checkConsent(toolName, serverName, args, resolved);
    if (!request) {
      // Shouldn't happen, but fallback to deny
      return { permission: ToolPermissionLevel.DENY };
    }

    // Return with the request — caller must call recordDecision
    return {
      permission: ToolPermissionLevel.DENY, // Default pending consent
      consentRequest: request,
    };
  }
}
