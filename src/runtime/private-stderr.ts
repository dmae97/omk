import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getRunArtifactPath } from "../util/run-store.js";
import { maskSensitiveText } from "../util/secret-mask.js";

export interface PrivateStderrRetentionOptions {
  readonly runId?: string;
  readonly nodeId?: string;
  readonly runtimeId?: string;
  readonly root?: string;
  readonly env?: Record<string, string | undefined>;
}

export interface StderrSanitizableResult {
  readonly stderr: string;
  readonly metadata?: Record<string, unknown>;
}

export function privateStderrRetentionEnabled(env?: Record<string, string | undefined>): boolean {
  const value = env?.OMK_PRIVATE_STDERR_ARTIFACTS ?? env?.OMK_DEBUG;
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

export function sanitizeRuntimeStderrResult<T extends StderrSanitizableResult>(
  result: T,
  options: PrivateStderrRetentionOptions = {},
): T {
  const originalStderr = result.stderr ?? "";
  const sanitizedStderr = maskSensitiveText(originalStderr);
  const redacted = sanitizedStderr !== originalStderr;
  const privateArtifact = writePrivateStderrArtifact(sanitizedStderr, originalStderr, options);
  if (!redacted && !privateArtifact && sanitizedStderr === result.stderr) return result;
  return {
    ...result,
    stderr: sanitizedStderr,
    metadata: {
      ...(result.metadata ?? {}),
      stderrRedacted: true,
      secretLikeContentRedacted: redacted,
      stderrPreview: sanitizedStderr.slice(0, 500),
      ...(privateArtifact && {
        stderrPrivateArtifact: privateArtifact.path,
        stderrPrivateArtifactSha256: privateArtifact.sha256,
        stderrRetainedPrivately: true,
      }),
    },
  };
}

function writePrivateStderrArtifact(
  sanitizedStderr: string,
  originalStderr: string,
  options: PrivateStderrRetentionOptions,
): { path: string; sha256: string } | undefined {
  if (!privateStderrRetentionEnabled(options.env)) return undefined;
  if (sanitizedStderr.trim().length === 0) return undefined;
  const runId = options.runId;
  if (!runId || runId.startsWith("local-")) return undefined;
  try {
    const node = safeArtifactSegment(options.nodeId, "node");
    const runtime = safeArtifactSegment(options.runtimeId, "runtime");
    const sha256 = createHash("sha256").update(sanitizedStderr).digest("hex");
    const rel = `private/stderr/${node}-${runtime}-${sha256.slice(0, 12)}.json`;
    const full = getRunArtifactPath(runId, rel, options.root);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify({
      schemaVersion: "omk.private-stderr.v1",
      runId,
      nodeId: options.nodeId,
      runtimeId: options.runtimeId,
      redaction: "secret-like-content-masked-before-retention",
      publicPreviewLength: 500,
      sha256,
      rawSha256: createHash("sha256").update(originalStderr).digest("hex"),
      stderr: sanitizedStderr,
      timestamp: new Date().toISOString(),
    }, null, 2), "utf-8");
    return { path: rel, sha256 };
  } catch {
    return undefined;
  }
}

function safeArtifactSegment(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? fallback).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48);
  return sanitized.length > 0 ? sanitized : fallback;
}
