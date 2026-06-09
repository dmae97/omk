/**
 * Maps existing provider doctor payloads onto the shared {@link ProviderHealth}
 * shape. This is additive: callers keep their original JSON keys and embed the
 * result under a `health` key.
 *
 * Only type imports are used so the module has no runtime dependencies and can
 * be unit-tested in isolation. The mapper never surfaces secret values — it
 * relies on boolean signals (e.g. `apiKeySet`) and environment-variable *names*.
 */
import type {
  ProviderAuthorityLevel,
  ProviderFailureKind,
  ProviderHealth,
  ProviderHealthVector,
} from "../contracts/provider-health.js";
import type { ProviderDoctorStatus } from "./model-registry.js";

/** DeepSeek `provider doctor` JSON object shape (balance preflight + config). */
export interface DeepSeekDoctorHealthInput {
  provider: string;
  available: boolean;
  enabled?: boolean;
  apiKeySet?: boolean;
  checkedAt?: number;
  reason?: string;
  balance?: { is_available?: boolean } | null;
}

/** Union of the doctor payloads the mapper understands. */
export type ProviderHealthInput = ProviderDoctorStatus | DeepSeekDoctorHealthInput;

/** Optional extra context (never carries secrets). */
export interface ProviderHealthExtras {
  /** Resolvable model override (used when the input lacks a `model`). */
  model?: string;
  /** ISO timestamp override (mainly for deterministic tests). */
  checkedAt?: string;
}

const SHELL_KINDS = new Set(["external-cli", "codex-cli", "local"]);
const QUOTA_PATTERN = /balance|quota|insufficient|402|rate[\s_-]*limit/i;

function toAuthorityLevel(authority: string | undefined): ProviderAuthorityLevel {
  switch (authority) {
    case "authority":
    case "full":
      return "full";
    case "direct":
      return "direct";
    case "advisory":
    case "read-only":
      return "advisory";
    case "veto":
    case "none":
      return "none";
    default:
      return "advisory";
  }
}

function hasResolvableModel(model: string | undefined): boolean {
  return typeof model === "string" && model.trim().length > 0 && model !== "default";
}

function isDoctorStatus(input: ProviderHealthInput): input is ProviderDoctorStatus {
  return typeof (input as { kind?: unknown }).kind === "string";
}

interface ClassifierSignals {
  runtimeOk: boolean;
  authOk: boolean;
  modelOk: boolean;
  quotaOk: boolean;
  enabled?: boolean;
  codexCliAvailable?: boolean;
  apiKeyEnv?: string;
}

// Classification relies on the already-derived boolean signals (quotaOk/authOk
// encode the doctor reason where relevant) so free-text reasons never override
// an explicit signal — and raw reason text is never echoed into remediation.
function classifyFailure(signals: ClassifierSignals): {
  failureKind: ProviderFailureKind;
  remediation: string[];
} {
  const { runtimeOk, authOk, modelOk, quotaOk } = signals;
  if (runtimeOk && authOk && modelOk && quotaOk) {
    return { failureKind: "none", remediation: [] };
  }

  if (!quotaOk) {
    return {
      failureKind: "quota",
      remediation: ["Check the provider balance/quota and top up or wait for the quota to reset."],
    };
  }

  if (!authOk) {
    return {
      failureKind: "auth",
      remediation: [
        signals.apiKeyEnv
          ? `Set the ${signals.apiKeyEnv} environment variable, then re-run provider doctor.`
          : "Configure provider authentication, then re-run provider doctor.",
      ],
    };
  }

  if (!runtimeOk) {
    if (signals.codexCliAvailable === false) {
      return {
        failureKind: "runtime",
        remediation: ["Install the Codex CLI and ensure `codex` is on PATH."],
      };
    }
    if (signals.enabled === false) {
      return {
        failureKind: "policy",
        remediation: ["Enable the provider in OMK configuration before use."],
      };
    }
    return {
      failureKind: "runtime",
      remediation: ["Verify the provider runtime is installed and reachable."],
    };
  }

  if (!modelOk) {
    return {
      failureKind: "model",
      remediation: ["Configure a resolvable default model for this provider."],
    };
  }

  return {
    failureKind: "unknown",
    remediation: ["Review provider doctor output for details."],
  };
}

function fromDoctorStatus(status: ProviderDoctorStatus, extras?: ProviderHealthExtras): ProviderHealth {
  const apiKeySet = status.apiKeySet;
  const authMethod = status.authMethod;
  const authOk =
    typeof apiKeySet === "boolean"
      ? apiKeySet
      : authMethod === "api-key-env"
        ? false
        : true; // external-cli / oauth / none: auth handled outside OMK.

  const runtimeOk = status.available && status.codexCliAvailable !== false;
  const modelOk = hasResolvableModel(extras?.model ?? status.model);
  const quotaOk = !QUOTA_PATTERN.test(status.reason ?? "");

  const capabilities = status.capabilities ?? [];
  const baseLevel = toAuthorityLevel(status.authority);
  const declaresMcp = capabilities.includes("mcp") || capabilities.includes("tools");

  const { failureKind, remediation } = classifyFailure({
    runtimeOk,
    authOk,
    modelOk,
    quotaOk,
    enabled: status.enabled,
    codexCliAvailable: status.codexCliAvailable,
    apiKeyEnv: status.apiKeyEnv,
  });

  return {
    provider: status.provider,
    checkedAt: extras?.checkedAt ?? new Date().toISOString(),
    runtimeOk,
    authOk,
    modelOk,
    quotaOk,
    writeAuthority: baseLevel,
    shellAuthority: SHELL_KINDS.has(status.kind) ? baseLevel : "none",
    mcpAuthority: declaresMcp
      ? baseLevel
      : baseLevel === "full" || baseLevel === "direct"
        ? "advisory"
        : "none",
    failureKind,
    remediation,
  };
}

function fromDeepSeekDoctor(input: DeepSeekDoctorHealthInput, extras?: ProviderHealthExtras): ProviderHealth {
  const apiKeySet = input.apiKeySet;
  const authOk = typeof apiKeySet === "boolean" ? apiKeySet : true;
  const runtimeOk = input.available && input.enabled !== false;
  const balanceUnavailable = input.balance?.is_available === false;
  const quotaOk = !balanceUnavailable && !QUOTA_PATTERN.test(input.reason ?? "");
  // DeepSeek is a known provider whose default model always resolves from the
  // registry, so treat the model as resolvable unless an explicit override fails.
  const modelOk = extras?.model ? hasResolvableModel(extras.model) : true;

  const { failureKind, remediation } = classifyFailure({
    runtimeOk,
    authOk,
    modelOk,
    quotaOk,
    enabled: input.enabled,
  });

  const checkedAt =
    extras?.checkedAt ??
    (typeof input.checkedAt === "number" ? new Date(input.checkedAt).toISOString() : new Date().toISOString());

  // DeepSeek participates as an advisory, read-only opportunistic worker.
  return {
    provider: input.provider,
    checkedAt,
    runtimeOk,
    authOk,
    modelOk,
    quotaOk,
    writeAuthority: "advisory",
    shellAuthority: "none",
    mcpAuthority: "none",
    failureKind,
    remediation,
  };
}

function toProviderHealthVectorFromHealth(health: ProviderHealth): ProviderHealthVector {
  const binary: ProviderHealthVector["binary"] = health.runtimeOk ? "ready" : "missing";
  const auth: ProviderHealthVector["auth"] = health.authOk
    ? "ready"
    : health.failureKind === "auth"
      ? "auth_present"
      : "missing";
  const model: ProviderHealthVector["model"] = health.modelOk ? "ready" : "missing";
  const quota: ProviderHealthVector["quota"] = health.quotaOk
    ? "ready"
    : health.failureKind === "quota"
      ? "auth_valid"
      : "missing";

  return {
    provider: health.provider,
    binary,
    auth,
    model,
    quota,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    supportsRead: true,
    supportsWrite: health.writeAuthority !== "none" && health.writeAuthority !== "advisory",
    supportsShell: health.shellAuthority !== "none",
    supportsSandbox: health.shellAuthority !== "none",
    evidencePassRate7d: health.failureKind === "none" ? 1.0 : 0.5,
    failureEwma: health.failureKind === "none" ? 0 : 0.5,
  };
}

/**
 * Maps a provider doctor payload onto a v2 {@link ProviderHealthVector}.
 *
 * @param status A {@link ProviderDoctorStatus} or DeepSeek doctor object.
 * @param extras Optional non-sensitive context overrides.
 */
export function toProviderHealthVector(status: ProviderHealthInput, extras?: ProviderHealthExtras): ProviderHealthVector {
  const health = toProviderHealth(status, extras);
  return toProviderHealthVectorFromHealth(health);
}

/**
 * Maps a provider doctor payload onto the shared {@link ProviderHealth} shape.
 *
 * @param status A {@link ProviderDoctorStatus} or DeepSeek doctor object.
 * @param extras Optional non-sensitive context overrides.
 */
export function toProviderHealth(status: ProviderHealthInput, extras?: ProviderHealthExtras): ProviderHealth {
  return isDoctorStatus(status) ? fromDoctorStatus(status, extras) : fromDeepSeekDoctor(status, extras);
}
