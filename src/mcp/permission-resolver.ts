/**
 * Unified permission resolver.
 *
 * Chains: static rules → consent flow → default policy.
 *
 * Replaces the fragmented permission checking in:
 * - host.ts checkPermission() (server-level only)
 * - host.ts governedCallTool() (no consent integration)
 * - governance.ts PermissionMatcher (rules only, no consent)
 * - consent-flow.ts ConsentAwareResolver (consent only, no rules)
 */

import { EventEmitter } from 'events';
import {
  PermissionMatcher,
  ToolPermissionLevel,
  ToolPermissionRule,
  GovernanceRule,
} from './governance.js';
import {
  ConsentFlowManager,
  ConsentAwareResolver,
  ConsentDecision,
  ConsentRequest,
} from './consent-flow.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionResolution {
  /** Final decision */
  level: ToolPermissionLevel;
  /** Source of the decision */
  source: 'rule' | 'consent' | 'default';
  /** Human-readable reason */
  reason: string;
  /** The rule that matched (if source is 'rule') */
  matchedRule?: ToolPermissionRule;
  /** The consent request (if source is 'consent') */
  consentRequest?: ConsentRequest;
}

export interface UnifiedResolverOptions {
  /** Default permission when no rule or consent matches */
  defaultLevel?: ToolPermissionLevel;
  /** Default reason for default permission */
  defaultReason?: string;
  /** Enable consent flow for ASK decisions */
  enableConsent?: boolean;
  /** Custom consent flow options */
  consentOptions?: {
    timeoutMs?: number;
    promptFn?: (request: ConsentRequest) => Promise<ConsentDecision>;
  };
}

// ---------------------------------------------------------------------------
// UnifiedPermissionResolver
// ---------------------------------------------------------------------------

export class UnifiedPermissionResolver extends EventEmitter {
  private readonly matcher: PermissionMatcher;
  private readonly consentResolver: ConsentAwareResolver | null;
  private readonly defaultLevel: ToolPermissionLevel;
  private readonly defaultReason: string;

  constructor(
    rules: GovernanceRule[],
    options: UnifiedResolverOptions = {},
  ) {
    super();

    this.matcher = new PermissionMatcher(rules);
    this.defaultLevel = options.defaultLevel ?? ToolPermissionLevel.ALLOW;
    this.defaultReason = options.defaultReason ?? 'No matching rule';

    if (options.enableConsent !== false) {
      const consentManager = new ConsentFlowManager(
        options.consentOptions ? { timeoutMs: options.consentOptions.timeoutMs } : undefined,
      );
      this.consentResolver = new ConsentAwareResolver(consentManager);

      // Forward consent events
      consentManager.on('consent:requested', (req) => this.emit('consent:requested', req));
      consentManager.on('consent:granted', (res) => this.emit('consent:granted', res));
      consentManager.on('consent:denied', (res) => this.emit('consent:denied', res));
    } else {
      this.consentResolver = null;
    }
  }

  /**
   * Resolve permission for a tool call.
   *
   * Resolution order:
   * 1. Static rules (highest priority)
   * 2. Consent flow (for ASK decisions)
   * 3. Default policy
   */
  async resolvePermission(
    toolName: string,
    serverName?: string,
    args?: Record<string, unknown>,
  ): Promise<PermissionResolution> {
    // Step 1: Check static rules
    const resolved = this.matcher.resolve(toolName);

    if (resolved.permission === ToolPermissionLevel.ALLOW) {
      return {
        level: ToolPermissionLevel.ALLOW,
        source: 'rule',
        reason: resolved.matchedRule?.reason ?? 'Allowed by rule',
        matchedRule: resolved.matchedRule ?? undefined,
      };
    }

    if (resolved.permission === ToolPermissionLevel.DENY) {
      return {
        level: ToolPermissionLevel.DENY,
        source: 'rule',
        reason: resolved.matchedRule?.reason ?? 'Denied by rule',
        matchedRule: resolved.matchedRule ?? undefined,
      };
    }

    // Step 2: Consent flow (for ASK decisions)
    if (this.consentResolver) {
      const consentResult = this.consentResolver.resolveWithConsent(
        toolName,
        serverName ?? 'unknown',
        args ?? {},
        resolved,
      );

      if (consentResult.permission === ToolPermissionLevel.ALLOW) {
        return {
          level: ToolPermissionLevel.ALLOW,
          source: 'consent',
          reason: consentResult.consentRequest
            ? `Consent granted (${consentResult.consentResult?.decision ?? 'approved'})`
            : 'Consent granted',
          consentRequest: consentResult.consentRequest ?? undefined,
        };
      }

      if (consentResult.permission === ToolPermissionLevel.DENY) {
        return {
          level: ToolPermissionLevel.DENY,
          source: 'consent',
          reason: consentResult.consentRequest
            ? `Consent denied (${consentResult.consentResult?.decision ?? 'denied'})`
            : 'Consent denied',
          consentRequest: consentResult.consentRequest ?? undefined,
        };
      }
    }

    // Step 3: Default policy
    return {
      level: this.defaultLevel,
      source: 'default',
      reason: this.defaultReason,
    };
  }

  /**
   * Update rules (e.g., when config changes).
   */
  updateRules(rules: GovernanceRule[]): void {
    this.matcher.updateRules(rules);
  }

  /**
   * Get the underlying PermissionMatcher (for testing).
   */
  getMatcher(): PermissionMatcher {
    return this.matcher;
  }

  /**
   * Get the underlying ConsentFlowManager (for testing).
   */
  getConsentManager(): ConsentFlowManager | null {
    return this.consentResolver?.getConsentManager() ?? null;
  }
}
