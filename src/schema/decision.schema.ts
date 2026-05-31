import { z } from "zod";
import { OMK_DECISION_SCHEMA_VERSION } from "../version.js";

export const DecisionTraceSchema = z.object({
  schemaVersion: z.literal(OMK_DECISION_SCHEMA_VERSION),
  runId: z.string().min(1),
  decisionId: z.string().min(1),
  timestamp: z.string().min(1),
  kind: z.enum([
    "provider-selection",
    "fallback-routing",
    "retry-policy",
    "skip-policy",
    "dependent-block",
    "context-brokering",
    "skill-assignment",
    "evidence-verdict",
    "security-policy",
  ]),
  actor: z.enum(["runtime-router", "scheduler", "evidence-gate", "provider-router", "operator"]),
  inputRefs: z.array(z.string()),
  outputRefs: z.array(z.string()),
  selected: z.string().optional(),
  candidates: z.array(z.string()).optional(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export const DecisionRefSchema = z.object({
  schemaVersion: z.literal(OMK_DECISION_SCHEMA_VERSION).optional(),
  decisionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  path: z.string().optional(),
});
