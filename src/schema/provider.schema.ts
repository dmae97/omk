import { z } from "zod";
import { OMK_PROVIDER_SCHEMA_VERSION } from "../version.js";

export const ProviderPolicySchema = z.object({
  provider: z.string().min(1),
  mode: z.enum(["auto", "pinned", "fallback"]).optional(),
});

export const ProviderCapabilitySchema = z.object({
  schemaVersion: z.literal(OMK_PROVIDER_SCHEMA_VERSION),
  provider: z.string().min(1),
  maturity: z.enum(["stable", "alpha", "experimental", "unsupported"]),
  roles: z.object({
    writer: z.boolean(),
    reviewer: z.boolean(),
    qa: z.boolean(),
    research: z.boolean(),
    advisory: z.boolean(),
    mergeAuthority: z.boolean(),
  }),
  features: z.object({
    cli: z.boolean(),
    api: z.boolean(),
    streaming: z.boolean(),
    mcp: z.boolean(),
    tools: z.boolean(),
    screenshots: z.boolean(),
    worktreeSafe: z.boolean(),
  }),
  health: z.object({
    available: z.boolean(),
    authenticated: z.boolean(),
    latencyMs: z.number().nonnegative().optional(),
    lastCheckedAt: z.string().min(1),
    warningCodes: z.array(z.string()),
  }),
});
