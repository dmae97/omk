import type { OMK_PROVIDER_SCHEMA_VERSION } from "../version.js";

export type ProviderMaturity = "stable" | "alpha" | "experimental" | "unsupported";

export type ProviderCapability = {
  schemaVersion: typeof OMK_PROVIDER_SCHEMA_VERSION;
  provider: string;
  maturity: ProviderMaturity;
  roles: {
    writer: boolean;
    reviewer: boolean;
    qa: boolean;
    research: boolean;
    advisory: boolean;
    mergeAuthority: boolean;
  };
  features: {
    cli: boolean;
    api: boolean;
    streaming: boolean;
    mcp: boolean;
    tools: boolean;
    screenshots: boolean;
    worktreeSafe: boolean;
  };
  health: {
    available: boolean;
    authenticated: boolean;
    latencyMs?: number;
    lastCheckedAt: string;
    warningCodes: string[];
  };
};

export type ProviderPolicy = {
  provider: string;
  mode?: "auto" | "pinned" | "fallback";
};
