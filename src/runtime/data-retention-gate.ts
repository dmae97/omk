/**
 * Freedomd data-retention gate.
 *
 * Decides whether a task's prompt, attachments, and relevant files may be sent
 * to a provider given its retention profile and the org/user policy. The gate
 * returns one of {allow, redact, downgrade, block} and never leaks secret-like
 * spans to a retained provider.
 */

import { maskSensitiveText } from "../util/secret-mask.js";
import type { AgentRuntime, AgentTask } from "./agent-runtime.js";
import type { ProviderSovereigntyProfile } from "./provider-sovereignty.js";
import { runtimeProviderId, runtimeModeOf } from "./authority-matrix.js";

export type DataBoundary = "public" | "internal" | "customer" | "secret";
export type RetentionDecision = "allow" | "redact" | "downgrade" | "block";

export interface DataSensitivity {
  readonly boundary: DataBoundary;
  readonly containsSecret: boolean;
  readonly containsCustomerData: boolean;
  readonly sensitiveSpans: readonly string[];
}

export interface ProviderRetentionProfile {
  readonly retentionDays: number;
  readonly zeroDataRetention: boolean;
  readonly trainingUse: boolean;
  readonly auditAccessUnknown: boolean;
}

export interface DataRetentionGateInput {
  readonly task: AgentTask;
  readonly runtime: AgentRuntime;
  readonly providerProfile: ProviderSovereigntyProfile;
  readonly orgMaxRetentionDays: number;
  readonly allowRedaction: boolean;
  readonly relevantFiles?: readonly string[];
}

export interface DataRetentionGateResult {
  readonly decision: RetentionDecision;
  readonly reason: string;
  readonly sensitivity: DataSensitivity;
  readonly redactedSpans?: readonly string[];
  readonly downgradeMode?: "local-only-or-zdr-provider" | "read-only-local-review";
}

const SECRET_KEYWORDS = [
  "password", "secret", "token", "api_key", "apikey", "private_key",
  "credential", "bearer", "authorization", "session", "cookie",
];

const CUSTOMER_DATA_KEYWORDS = [
  "customer", "user_id", "email", "phone", "ssn", "personal",
  "gdpr", "hipaa", "pci", "pii",
];

function boundaryForRisk(risk: string | undefined): DataBoundary {
  if (risk === "shell" || risk === "merge") return "secret";
  if (risk === "write" || risk === "patch") return "internal";
  return "public";
}

function classifyTextSensitivity(text: string): Pick<DataSensitivity, "containsSecret" | "containsCustomerData" | "sensitiveSpans"> {
  const lower = text.toLowerCase();
  const sensitiveSpans: string[] = [];
  let containsSecret = false;
  let containsCustomerData = false;

  for (const keyword of SECRET_KEYWORDS) {
    if (lower.includes(keyword)) {
      containsSecret = true;
      sensitiveSpans.push(`keyword:${keyword}`);
    }
  }

  for (const keyword of CUSTOMER_DATA_KEYWORDS) {
    if (lower.includes(keyword)) {
      containsCustomerData = true;
      sensitiveSpans.push(`keyword:${keyword}`);
    }
  }

  const masked = maskSensitiveText(text);
  if (masked !== text) {
    containsSecret = true;
    sensitiveSpans.push("pattern:secret-like");
  }

  return { containsSecret, containsCustomerData, sensitiveSpans: [...new Set(sensitiveSpans)] };
}

export function classifyDataSensitivity(task: AgentTask, relevantFiles?: readonly string[]): DataSensitivity {
  const text = [
    task.prompt,
    task.context.goal ?? "",
    task.context.system ?? "",
    ...(task.attachments ?? []).map((a) => a.name),
    ...(relevantFiles ?? []),
  ].join("\n");

  const classified = classifyTextSensitivity(text);
  const boundary = boundaryForRisk(task.safety?.risk);

  return {
    boundary,
    containsSecret: classified.containsSecret,
    containsCustomerData: classified.containsCustomerData,
    sensitiveSpans: classified.sensitiveSpans,
  };
}

export function providerRetentionProfileFromSovereignty(profile: ProviderSovereigntyProfile): ProviderRetentionProfile {
  return {
    retentionDays: profile.retentionDays,
    zeroDataRetention: profile.zeroDataRetention,
    trainingUse: profile.trainingUse,
    auditAccessUnknown: !profile.zeroDataRetention && profile.retentionDays > 0,
  };
}

export function evaluateDataRetentionGate(input: DataRetentionGateInput): DataRetentionGateResult {
  const { task, runtime, providerProfile, orgMaxRetentionDays, allowRedaction } = input;
  const sensitivity = classifyDataSensitivity(task, input.relevantFiles);

  if (sensitivity.containsSecret) {
    return {
      decision: "block",
      reason: "secret-like data cannot be sent to retained provider",
      sensitivity,
    };
  }

  const retention = providerRetentionProfileFromSovereignty(providerProfile);

  if (sensitivity.containsCustomerData && !retention.zeroDataRetention) {
    if (allowRedaction) {
      return {
        decision: "redact",
        reason: `customer data redacted before sending to ${runtimeProviderId(runtime)}:${runtimeModeOf(runtime)}`,
        sensitivity,
        redactedSpans: sensitivity.sensitiveSpans,
      };
    }
    return {
      decision: "downgrade",
      reason: "customer data with non-zero retention provider; downgrade required",
      sensitivity,
      downgradeMode: "local-only-or-zdr-provider",
    };
  }

  if (retention.retentionDays > orgMaxRetentionDays) {
    return {
      decision: "block",
      reason: `provider retention ${retention.retentionDays}d exceeds policy ${orgMaxRetentionDays}d`,
      sensitivity,
    };
  }

  const risk = task.safety?.risk;
  if ((risk === "write" || risk === "shell" || risk === "merge") && retention.auditAccessUnknown) {
    return {
      decision: "downgrade",
      reason: "high-risk task with unclear retention/audit boundary",
      sensitivity,
      downgradeMode: "read-only-local-review",
    };
  }

  return {
    decision: "allow",
    reason: "retention policy acceptable for data boundary",
    sensitivity,
  };
}
