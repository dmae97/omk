export const OMK_ERROR_CODES = [
  "CONFIG_INVALID",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTH_REQUIRED",
  "PROVIDER_CAPABILITY_MISMATCH",
  "ROUTE_FALLBACK_TRIGGERED",
  "EVIDENCE_MISSING",
  "EVIDENCE_FAILED",
  "DAG_NODE_BLOCKED",
  "RUN_ARTIFACT_MISSING",
  "REPLAY_INCOMPLETE",
  "SECURITY_POLICY_BLOCKED",
  "MCP_UNHEALTHY",
  "INTERNAL_ERROR",
] as const;

export type OmkErrorCode = (typeof OMK_ERROR_CODES)[number];
export type OmkSeverity = "info" | "warning" | "error" | "fatal";

export type OmkError = {
  code: OmkErrorCode;
  message: string;
  recoverable: boolean;
  severity: OmkSeverity;
  hint?: string;
  cause?: string;
  path?: string;
};

export type OmkWarning = OmkError;
