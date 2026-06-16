/**
 * Provider sovereignty scoring for Freedomd.
 *
 * Translates provider jurisdiction, retention, cutoff/portability, and locality
 * properties into a normalized score that feeds runtime routing. The score is
 * intentionally conservative: unknowns are treated as risk.
 */

import type { AgentRuntime, AgentTask } from "./agent-runtime.js";
import type { RuntimeHealth } from "./contracts/shared.js";
import { runtimeProviderId, runtimeModeOf } from "./authority-matrix.js";

export type ExportPolicy = "open" | "restricted" | "controlled" | "unknown";

export interface ProviderSovereigntyProfile {
  readonly providerId: string;
  readonly runtimeMode: string;
  readonly providerCountry: string;
  readonly exportPolicy: ExportPolicy;
  readonly retentionDays: number;
  readonly zeroDataRetention: boolean;
  readonly trainingUse: boolean;
  readonly supportsSelfHosted: boolean;
  readonly openApiCompatible: boolean;
  readonly policyInstabilityScore: number;
  readonly exportControlExposure: number;
  readonly accountDependency: number;
  readonly metadataEvidenceSupport: boolean;
}

export interface ProviderIncidentState {
  readonly providerId: string;
  readonly runtimeMode?: string;
  readonly kind: "availability" | "policy" | "export-control" | "retention" | "jurisdiction";
  readonly severity: "info" | "warn" | "block";
  readonly reason: string;
  readonly updatedAt: string;
}

export interface SovereigntyDiagnostics {
  readonly jurisdictionRisk: number;
  readonly retentionRisk: number;
  readonly cutoffRisk: number;
  readonly localityScore: number;
  readonly portabilityScore: number;
  readonly incidentSeverity?: string;
  readonly reason: string;
}

export interface SovereigntyScore {
  readonly score: number;
  readonly diagnostics: SovereigntyDiagnostics;
}

export interface ComputeSovereigntyOptions {
  readonly profile: ProviderSovereigntyProfile;
  readonly userCountry?: string;
  readonly taskRisk?: string;
  readonly incidents?: readonly ProviderIncidentState[];
  readonly localAvailable?: boolean;
}

const EXPORT_POLICY_RISK: Readonly<Record<ExportPolicy, number>> = {
  open: 0.0,
  restricted: 0.4,
  controlled: 0.8,
  unknown: 0.6,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function assessJurisdictionRisk(options: {
  readonly providerCountry: string;
  readonly userCountry?: string;
  readonly taskRisk?: string;
  readonly exportPolicy: ExportPolicy;
  readonly incidents?: readonly ProviderIncidentState[];
}): number {
  let risk = EXPORT_POLICY_RISK[options.exportPolicy] ?? 0.6;

  if (options.userCountry && options.providerCountry !== options.userCountry) {
    risk = Math.max(risk, 0.3);
  }

  if (options.taskRisk === "shell" || options.taskRisk === "merge") {
    risk = Math.min(1, risk * 1.3 + 0.1);
  }

  const incident = (options.incidents ?? []).find(
    (i) => i.kind === "export-control" || i.kind === "jurisdiction" || i.kind === "policy",
  );
  if (incident) {
    const severityMultiplier = incident.severity === "block" ? 1.0 : incident.severity === "warn" ? 0.5 : 0.2;
    risk = Math.min(1, risk + severityMultiplier * 0.3);
  }

  return clamp01(risk);
}

export function assessRetentionRisk(options: {
  readonly retentionDays: number;
  readonly zeroDataRetention: boolean;
  readonly trainingUse: boolean;
  readonly maxRetentionDays?: number;
}): number {
  if (options.zeroDataRetention) return 0.0;
  if (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0) return 0.5;

  let risk = clamp01(options.retentionDays / 365);
  if (options.trainingUse) {
    risk = Math.min(1, risk + 0.3);
  }
  if (options.maxRetentionDays !== undefined && options.maxRetentionDays >= 0) {
    if (options.retentionDays > options.maxRetentionDays) {
      risk = Math.min(1, risk + 0.4);
    }
  }
  return risk;
}

export function assessCutoffRisk(options: {
  readonly health?: RuntimeHealth;
  readonly policyInstabilityScore: number;
  readonly exportControlExposure: number;
  readonly accountDependency: number;
  readonly incidents?: readonly ProviderIncidentState[];
}): number {
  let risk = 0;
  risk += clamp01(options.policyInstabilityScore) * 0.35;
  risk += clamp01(options.exportControlExposure) * 0.35;
  risk += clamp01(options.accountDependency) * 0.30;

  if (options.health?.available === false) {
    risk = Math.min(1, risk + 0.5);
  }

  const incident = (options.incidents ?? []).find(
    (i) => i.kind === "availability" || i.kind === "export-control" || i.kind === "policy",
  );
  if (incident) {
    const bump = incident.severity === "block" ? 0.6 : incident.severity === "warn" ? 0.3 : 0.1;
    risk = Math.min(1, risk + bump);
  }

  return clamp01(risk);
}

export function assessPortability(options: {
  readonly supportsOpenApiCompat: boolean;
  readonly supportsToolContract: boolean;
  readonly supportsEvidenceReturn: boolean;
}): number {
  let score = 0.4;
  if (options.supportsOpenApiCompat) score += 0.25;
  if (options.supportsToolContract) score += 0.15;
  if (options.supportsEvidenceReturn) score += 0.20;
  return clamp01(score);
}

export function computeProviderSovereigntyScore(
  runtime: AgentRuntime,
  task: AgentTask,
  options: ComputeSovereigntyOptions,
): SovereigntyScore {
  const profile = options.profile;
  const providerId = runtimeProviderId(runtime);
  const runtimeMode = runtimeModeOf(runtime);

  const incidents = (options.incidents ?? []).filter(
    (i) =>
      i.providerId === providerId &&
      (!i.runtimeMode || i.runtimeMode === runtimeMode),
  );

  const jurisdictionRisk = assessJurisdictionRisk({
    providerCountry: profile.providerCountry,
    userCountry: options.userCountry,
    taskRisk: options.taskRisk ?? task.safety?.risk,
    exportPolicy: profile.exportPolicy,
    incidents,
  });

  const retentionRisk = assessRetentionRisk({
    retentionDays: profile.retentionDays,
    zeroDataRetention: profile.zeroDataRetention,
    trainingUse: profile.trainingUse,
  });

  const cutoffRisk = assessCutoffRisk({
    policyInstabilityScore: profile.policyInstabilityScore,
    exportControlExposure: profile.exportControlExposure,
    accountDependency: profile.accountDependency,
    incidents,
  });

  const localityScore = options.localAvailable
    ? 1.0
    : profile.supportsSelfHosted
      ? 0.8
      : 0.4;

  const portabilityScore = assessPortability({
    supportsOpenApiCompat: profile.openApiCompatible,
    supportsToolContract: runtime.capabilities?.toolCalling === true || runtime.capabilities?.supportsToolCalling === true,
    supportsEvidenceReturn: profile.metadataEvidenceSupport,
  });

  const score =
    0.25 * (1 - jurisdictionRisk) +
    0.25 * (1 - retentionRisk) +
    0.20 * (1 - cutoffRisk) +
    0.15 * localityScore +
    0.15 * portabilityScore;

  const diagnostics: SovereigntyDiagnostics = {
    jurisdictionRisk,
    retentionRisk,
    cutoffRisk,
    localityScore,
    portabilityScore,
    incidentSeverity: incidents.length > 0 ? incidents[0].severity : undefined,
    reason: `jurisdiction=${jurisdictionRisk.toFixed(2)} retention=${retentionRisk.toFixed(2)} cutoff=${cutoffRisk.toFixed(2)} locality=${localityScore.toFixed(2)} portability=${portabilityScore.toFixed(2)}`,
  };

  return { score: clamp01(score), diagnostics };
}

export function buildProviderSovereigntyProfiles(): Readonly<Record<string, ProviderSovereigntyProfile>> {
  const now = new Date().toISOString();
  const profiles: Record<string, ProviderSovereigntyProfile> = {
    "local-llm": {
      providerId: "local-llm",
      runtimeMode: "api",
      providerCountry: "user-device",
      exportPolicy: "open",
      retentionDays: 0,
      zeroDataRetention: true,
      trainingUse: false,
      supportsSelfHosted: true,
      openApiCompatible: true,
      policyInstabilityScore: 0.05,
      exportControlExposure: 0.0,
      accountDependency: 0.0,
      metadataEvidenceSupport: true,
    },
    codex: {
      providerId: "codex",
      runtimeMode: "cli",
      providerCountry: "US",
      exportPolicy: "restricted",
      retentionDays: 0,
      zeroDataRetention: true,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: false,
      policyInstabilityScore: 0.2,
      exportControlExposure: 0.3,
      accountDependency: 0.4,
      metadataEvidenceSupport: true,
    },
    kimi: {
      providerId: "kimi",
      runtimeMode: "api",
      providerCountry: "CN",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.25,
      exportControlExposure: 0.35,
      accountDependency: 0.5,
      metadataEvidenceSupport: true,
    },
    mimo: {
      providerId: "mimo",
      runtimeMode: "api",
      providerCountry: "CN",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.25,
      exportControlExposure: 0.35,
      accountDependency: 0.5,
      metadataEvidenceSupport: true,
    },
    deepseek: {
      providerId: "deepseek",
      runtimeMode: "api",
      providerCountry: "CN",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.3,
      exportControlExposure: 0.4,
      accountDependency: 0.5,
      metadataEvidenceSupport: true,
    },
    opencode: {
      providerId: "opencode",
      runtimeMode: "cli",
      providerCountry: "KR",
      exportPolicy: "open",
      retentionDays: 0,
      zeroDataRetention: true,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: false,
      policyInstabilityScore: 0.2,
      exportControlExposure: 0.1,
      accountDependency: 0.3,
      metadataEvidenceSupport: true,
    },
    commandcode: {
      providerId: "commandcode",
      runtimeMode: "cli",
      providerCountry: "US",
      exportPolicy: "open",
      retentionDays: 0,
      zeroDataRetention: true,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: false,
      policyInstabilityScore: 0.2,
      exportControlExposure: 0.1,
      accountDependency: 0.3,
      metadataEvidenceSupport: true,
    },
    glm: {
      providerId: "glm",
      runtimeMode: "api",
      providerCountry: "CN",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.3,
      exportControlExposure: 0.4,
      accountDependency: 0.5,
      metadataEvidenceSupport: true,
    },
    openrouter: {
      providerId: "openrouter",
      runtimeMode: "api",
      providerCountry: "US",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.25,
      exportControlExposure: 0.3,
      accountDependency: 0.6,
      metadataEvidenceSupport: true,
    },
    qwen: {
      providerId: "qwen",
      runtimeMode: "api",
      providerCountry: "CN",
      exportPolicy: "restricted",
      retentionDays: 30,
      zeroDataRetention: false,
      trainingUse: false,
      supportsSelfHosted: false,
      openApiCompatible: true,
      policyInstabilityScore: 0.3,
      exportControlExposure: 0.4,
      accountDependency: 0.5,
      metadataEvidenceSupport: true,
    },
  };
  void now;
  return profiles;
}

export function lookupSovereigntyProfile(
  runtime: AgentRuntime,
  profiles?: Readonly<Record<string, ProviderSovereigntyProfile>>,
): ProviderSovereigntyProfile | undefined {
  const map = profiles ?? buildProviderSovereigntyProfiles();
  const providerId = runtimeProviderId(runtime);
  return map[providerId] ?? map[runtime.id];
}
