/**
 * Freedomd policy compiler.
 *
 * Translates environment, org defaults, and optional user config into a
 * normalized policy that drives provider-sovereignty routing, retention gates,
 * and degraded-mode fallback decisions.
 */

export type FreedomdMode = "off" | "balanced" | "strict";

export interface FreedomdProviderOverride {
  readonly enabled: boolean;
  readonly reason?: string;
  readonly priority?: number;
}

export interface FreedomdPolicy {
  readonly mode: FreedomdMode;
  readonly preferLocal: boolean;
  readonly maxRetentionDays: number;
  readonly allowExportRestrictedProvider: boolean;
  readonly allowProviderExceptions: boolean;
  readonly requireLocalEvidenceEnvelope: boolean;
  readonly providerOverrides: Readonly<Record<string, FreedomdProviderOverride>>;
  readonly maxJurisdictionRisk: number;
  readonly maxRetentionRisk: number;
  readonly maxCutoffRisk: number;
}

export interface FreedomdPolicyInputs {
  readonly env?: NodeJS.ProcessEnv;
  readonly orgDefaults?: Partial<FreedomdPolicy>;
  readonly taskFlags?: Partial<FreedomdPolicy>;
}

const DEFAULT_POLICY: FreedomdPolicy = {
  mode: "off",
  preferLocal: false,
  maxRetentionDays: Number.POSITIVE_INFINITY,
  allowExportRestrictedProvider: true,
  allowProviderExceptions: true,
  requireLocalEvidenceEnvelope: false,
  providerOverrides: {},
  maxJurisdictionRisk: 1.0,
  maxRetentionRisk: 1.0,
  maxCutoffRisk: 1.0,
};

function parseMode(raw: string | undefined): FreedomdMode | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "0" || normalized === "false") return "off";
  if (normalized === "balanced" || normalized === "1" || normalized === "true") return "balanced";
  if (normalized === "strict" || normalized === "2") return "strict";
  return undefined;
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "off") return false;
  return undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function mergePolicy(base: FreedomdPolicy, patch: Partial<FreedomdPolicy>): FreedomdPolicy {
  return {
    ...base,
    ...patch,
    providerOverrides: {
      ...base.providerOverrides,
      ...patch.providerOverrides,
    },
  };
}

export function compileFreedomdPolicy(inputs: FreedomdPolicyInputs = {}): FreedomdPolicy {
  const env = inputs.env ?? process.env;
  let policy = mergePolicy(DEFAULT_POLICY, inputs.orgDefaults ?? {});

  const envMode = parseMode(env.OMK_FREEDOMD_MODE);
  if (envMode !== undefined) {
    policy = mergePolicy(policy, { mode: envMode });
  }

  const preferLocal = parseBoolean(env.OMK_PREFER_LOCAL);
  if (preferLocal !== undefined) {
    policy = mergePolicy(policy, { preferLocal });
  }

  const maxRetentionDays = parseNumber(env.OMK_MAX_RETENTION_DAYS);
  if (maxRetentionDays !== undefined) {
    policy = mergePolicy(policy, { maxRetentionDays });
  }

  const allowExportRestricted = parseBoolean(env.OMK_BLOCK_EXPORT_RESTRICTED);
  if (allowExportRestricted !== undefined) {
    policy = mergePolicy(policy, { allowExportRestrictedProvider: !allowExportRestricted });
  }

  const allowProviderExceptions = parseBoolean(env.OMK_ALLOW_PROVIDER_EXCEPTIONS);
  if (allowProviderExceptions !== undefined) {
    policy = mergePolicy(policy, { allowProviderExceptions });
  }

  policy = mergePolicy(policy, inputs.taskFlags ?? {});

  if (policy.mode === "strict") {
    policy = mergePolicy(policy, {
      preferLocal: true,
      allowExportRestrictedProvider: false,
      requireLocalEvidenceEnvelope: true,
    });
    if (!Number.isFinite(policy.maxRetentionDays) || policy.maxRetentionDays > 0) {
      policy = mergePolicy(policy, { maxRetentionDays: 0 });
    }
  }

  return policy;
}

export function isFreedomdEnabled(policy: Pick<FreedomdPolicy, "mode">): boolean {
  return policy.mode !== "off";
}

export function explainFreedomdPolicy(policy: FreedomdPolicy): string {
  return [
    `mode=${policy.mode}`,
    `preferLocal=${policy.preferLocal}`,
    `maxRetentionDays=${Number.isFinite(policy.maxRetentionDays) ? policy.maxRetentionDays : "unlimited"}`,
    `allowExportRestricted=${policy.allowExportRestrictedProvider}`,
    `allowExceptions=${policy.allowProviderExceptions}`,
    `localEvidenceEnvelope=${policy.requireLocalEvidenceEnvelope}`,
  ].join("; ");
}
