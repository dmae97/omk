/**
 * Freedomd provider exception approval.
 *
 * Interactive approval flow for blocked providers. Records user decisions as
 * local artifacts and graph nodes so every override is auditable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LocalGraphMemoryStore } from "../memory/local-graph-memory-store.js";

export type ProviderExceptionScope = "once" | "run" | "deny";

export interface ProviderExceptionRequest {
  readonly providerId: string;
  readonly runtimeMode?: string;
  readonly blockedReason: string;
  readonly retentionDays: number;
  readonly jurisdictionRisk: number;
  readonly localFallbackAvailable: boolean;
  readonly taskSensitivity: string;
}

export interface ProviderExceptionResult {
  readonly decision: ProviderExceptionScope;
  readonly reason: string;
  readonly artifactPath?: string;
  readonly policyOverridePath?: string;
}

export interface ProviderExceptionApproverOptions {
  readonly runId: string;
  readonly nodeId: string;
  readonly projectRoot?: string;
  readonly graphStore?: LocalGraphMemoryStore;
  readonly isTty?: boolean;
  readonly promptUser?: (message: string) => Promise<string>;
}

export async function requestProviderException(
  request: ProviderExceptionRequest,
  options: ProviderExceptionApproverOptions,
): Promise<ProviderExceptionResult> {
  const root = resolve(options.projectRoot ?? process.cwd());

  if (options.isTty === false) {
    return { decision: "deny", reason: "non-interactive provider exception denied" };
  }

  const summary = [
    `Provider: ${request.providerId}${request.runtimeMode ? ` (${request.runtimeMode})` : ""}`,
    `Blocked reason: ${request.blockedReason}`,
    `Retention: ${request.retentionDays} days`,
    `Jurisdiction risk: ${request.jurisdictionRisk.toFixed(2)}`,
    `Local fallback available: ${request.localFallbackAvailable}`,
    `Task sensitivity: ${request.taskSensitivity}`,
  ].join("\n");

  const choice = await (options.promptUser?.(summary) ?? Promise.resolve("deny"));
  const normalized = choice.trim().toLowerCase();

  if (normalized.startsWith("allow once")) {
    const artifactPath = await writeExceptionArtifact(root, options.runId, options.nodeId, request, "once");
    await materializeExceptionInGraph(options, request, "once", artifactPath);
    return { decision: "once", reason: "user approved once", artifactPath };
  }

  if (normalized.startsWith("allow for run") || normalized.startsWith("allow run")) {
    const artifactPath = await writeExceptionArtifact(root, options.runId, options.nodeId, request, "run");
    const policyOverridePath = await writeRunPolicyOverride(root, options.runId, request);
    await materializeExceptionInGraph(options, request, "run", artifactPath);
    return { decision: "run", reason: "user approved for this run", artifactPath, policyOverridePath };
  }

  return { decision: "deny", reason: "user denied provider exception" };
}

async function writeExceptionArtifact(
  root: string,
  runId: string,
  nodeId: string,
  request: ProviderExceptionRequest,
  scope: ProviderExceptionScope,
): Promise<string> {
  const dir = join(root, ".omk", "runs", runId, "freedomd");
  const path = join(dir, `${nodeId}-provider-exception.json`);
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    schemaVersion: "omk.freedomd.provider-exception.v1",
    runId,
    nodeId,
    providerId: request.providerId,
    runtimeMode: request.runtimeMode,
    scope,
    requestedAt: new Date().toISOString(),
    request,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

async function writeRunPolicyOverride(
  root: string,
  runId: string,
  request: ProviderExceptionRequest,
): Promise<string> {
  const dir = join(root, ".omk", "runs", runId, "freedomd");
  const path = join(dir, "policy-overrides.json");
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    schemaVersion: "omk.freedomd.policy-overrides.v1",
    runId,
    providerOverrides: {
      [request.providerId]: {
        enabled: true,
        reason: request.blockedReason,
      },
    },
    createdAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

async function materializeExceptionInGraph(
  options: ProviderExceptionApproverOptions,
  request: ProviderExceptionRequest,
  scope: ProviderExceptionScope,
  _artifactPath: string,
): Promise<void> {
  if (!options.graphStore) return;
  try {
    await options.graphStore.materializeFreedomdSovereignty({
      runId: options.runId,
      nodeId: options.nodeId,
      providerId: request.providerId,
      runtimeMode: request.runtimeMode ?? "api",
      sovereignty: {
        mode: "freedomd",
        dataBoundary: "internal",
        retentionDecision: "allow",
        jurisdictionDecision: "allow",
        providerCutoffRisk: 0,
        localFallbackAvailable: request.localFallbackAvailable,
        reason: `provider exception approved: ${scope}`,
      },
    });
  } catch {
    // Best-effort graph materialization.
  }
}
