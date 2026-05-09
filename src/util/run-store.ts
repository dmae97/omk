/**
 * Canonical run store API.
 *
 * All `.omk/runs` IO must go through this module.
 * Raw `join(root, ".omk", "runs", runId)` is prohibited outside this file.
 */
import { join } from "path";
import { readdir } from "fs/promises";
import { getOmkPath } from "./fs.js";

export const RUN_ID_MAX_LENGTH = 128;
export const RUN_ARTIFACT_PATH_MAX_LENGTH = 256;
export const RESERVED_RUN_IDS = new Set(["latest"]);

/**
 * Validates a runId and returns the canonical form.
 * Rejects traversal, separators, drive syntax, UNC paths, and reserved names.
 */
export function validateRunId(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error(`Invalid runId: empty or non-string value`);
  }
  if (raw.length > RUN_ID_MAX_LENGTH) {
    throw new Error(`Invalid runId: exceeds ${RUN_ID_MAX_LENGTH} characters`);
  }
  if (raw === "." || raw === "..") {
    throw new Error(`Invalid runId: dot-only segment not allowed`);
  }
  if (RESERVED_RUN_IDS.has(raw)) {
    throw new Error(`Invalid runId: "${raw}" is reserved`);
  }
  // Allow alphanumerics, underscore, hyphen, and single dots inside the name,
  // but reject any path separators or other special characters.
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new Error(`Invalid runId: "${raw}" contains disallowed characters`);
  }
  return raw;
}

/**
 * Sanitizes generated run IDs before they touch `.omk/runs`.
 * User-supplied invalid IDs still fail validation at the store boundary.
 */
export function sanitizeRunId(raw: string, fallbackPrefix = "run"): string {
  if (raw === "." || raw === "..") {
    return buildFallbackRunId(fallbackPrefix);
  }
  let sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "-");
  while (sanitized.includes("..")) {
    sanitized = sanitized.replace(/\.\./g, "-");
  }
  if (sanitized.length > RUN_ID_MAX_LENGTH) {
    sanitized = sanitized.slice(0, RUN_ID_MAX_LENGTH);
  }
  try {
    return validateRunId(sanitized);
  } catch {
    return buildFallbackRunId(fallbackPrefix);
  }
}

/**
 * Validates a relative artifact path below a run directory.
 * Accepts nested POSIX-style segments, rejects traversal, absolute paths,
 * drive paths, UNC paths, empty segments, and special characters.
 */
export function validateRunArtifactPath(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error(`Invalid run artifact path: empty or non-string value`);
  }
  if (raw.length > RUN_ARTIFACT_PATH_MAX_LENGTH) {
    throw new Error(`Invalid run artifact path: exceeds ${RUN_ARTIFACT_PATH_MAX_LENGTH} characters`);
  }
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`Invalid run artifact path: absolute paths are not allowed`);
  }
  if (raw.includes("\\")) {
    throw new Error(`Invalid run artifact path: backslash separators are not allowed`);
  }

  const segments = raw.split("/");
  for (const segment of segments) {
    if (!segment) {
      throw new Error(`Invalid run artifact path: empty path segment not allowed`);
    }
    if (segment === "." || segment === "..") {
      throw new Error(`Invalid run artifact path: dot-only segment not allowed`);
    }
    if (segment.length > RUN_ID_MAX_LENGTH) {
      throw new Error(`Invalid run artifact path: segment exceeds ${RUN_ID_MAX_LENGTH} characters`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error(`Invalid run artifact path: "${raw}" contains disallowed characters`);
    }
  }

  return segments.join("/");
}

function buildFallbackRunId(rawPrefix: string): string {
  const prefix = rawPrefix
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safePrefix = prefix && !RESERVED_RUN_IDS.has(prefix) ? prefix : "run";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const candidate = `${safePrefix}-${timestamp}`.slice(0, RUN_ID_MAX_LENGTH);
  return validateRunId(candidate);
}

/**
 * Returns the `.omk/runs` directory path.
 */
export function getRunsDir(root?: string): string {
  return root ? join(root, ".omk", "runs") : getOmkPath("runs");
}

/**
 * Returns the full path to a run directory or an artifact inside it.
 * Validates the runId before constructing the path.
 */
export function getRunPath(runId: string, artifact?: string, root?: string): string {
  const valid = validateRunId(runId);
  const base = join(getRunsDir(root), valid);
  return artifact ? join(base, validateRunArtifactPath(artifact)) : base;
}

/**
 * Returns the path to a run artifact.
 * Validates both runId and artifact path before constructing the path.
 */
export function getRunArtifactPath(runId: string, artifact: string, root?: string): string {
  return join(getRunsDir(root), validateRunId(runId), validateRunArtifactPath(artifact));
}

/**
 * Lists valid runIds from the runs directory.
 * Skips directories with invalid names (e.g., "latest", ".", "..").
 */
export async function listValidRunIds(root?: string): Promise<string[]> {
  const runsDir = getRunsDir(root);
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const valid: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        validateRunId(entry.name);
        valid.push(entry.name);
      } catch {
        // skip invalid run directory names
      }
    }
    return valid;
  } catch {
    return [];
  }
}
