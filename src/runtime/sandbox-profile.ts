import * as nodePath from "node:path";
import * as fs from "node:fs";

export type RuntimeSandboxMode = "read-only" | "workspace-write";

export type RuntimeSandboxEnforcement = "env-only" | "provider-native" | "not-enforced";

export type RuntimeNetworkPolicy = "unspecified" | "allowed" | "blocked-planned";

export type RuntimeSecretEnvPolicy = "drop-by-default" | "explicit-grants";

export interface RuntimeSandboxProfile {
  readonly mode: RuntimeSandboxMode;
  readonly enforcement: RuntimeSandboxEnforcement;
  readonly cwd: string;
  readonly writableRoots: readonly string[];
  readonly readableRoots: readonly string[];
  readonly network: RuntimeNetworkPolicy;
  readonly secretEnvPolicy: RuntimeSecretEnvPolicy;
  readonly notes?: readonly string[];
}

export interface CreateRuntimeSandboxProfileOptions {
  readonly cwd: string;
  readonly mode?: RuntimeSandboxMode;
  readonly enforcement?: RuntimeSandboxEnforcement;
  readonly writableRoots?: readonly string[];
  readonly readableRoots?: readonly string[];
  readonly network?: RuntimeNetworkPolicy;
  readonly secretEnvPolicy?: RuntimeSecretEnvPolicy;
  readonly notes?: readonly string[];
}

export function createRuntimeSandboxProfile(
  options: CreateRuntimeSandboxProfileOptions
): RuntimeSandboxProfile {
  const mode = options.mode ?? "read-only";
  const enforcement = options.enforcement ?? "env-only";
  return {
    mode,
    enforcement,
    cwd: options.cwd,
    writableRoots: options.writableRoots ?? defaultWritableRoots(mode, enforcement, options.cwd),
    readableRoots: options.readableRoots ?? [options.cwd],
    network: options.network ?? "unspecified",
    secretEnvPolicy: options.secretEnvPolicy ?? "drop-by-default",
    notes: options.notes ?? defaultSandboxNotes(enforcement),
  };
}

function defaultWritableRoots(
  mode: RuntimeSandboxMode,
  enforcement: RuntimeSandboxEnforcement,
  cwd: string
): readonly string[] {
  if (mode === "workspace-write" && enforcement === "provider-native") return [cwd];
  return [];
}

function defaultSandboxNotes(enforcement: RuntimeSandboxEnforcement): readonly string[] {
  if (enforcement === "provider-native") {
    return [
      "OMK sanitizes child env.",
      "Runtime receives provider-native sandbox flags.",
      "OMK does not yet enforce OS-level filesystem or network isolation.",
    ];
  }
  if (enforcement === "env-only") {
    return [
      "Child runtime env is sanitized.",
      "OS-level sandboxing is future work.",
    ];
  }
  return ["OS-level sandbox enforcement is not configured."];
}

// ---------------------------------------------------------------------------
// writableRoots enforcement (Lane C2)
//
// Pure helpers that decide whether a target path is permitted by an explicit
// list of writable roots. SAFE DEFAULT: an empty/undefined root list means
// "unrestricted" so existing behavior (no enforcement) is preserved. These are
// IO-free; callers resolve the active sandbox profile and pass its roots.
// ---------------------------------------------------------------------------

/**
 * Resolve `p` to a canonical real path, best-effort and fail-safe.
 *
 * The write target may not exist yet, so we cannot `realpathSync` it directly.
 * Instead we walk UP to the deepest EXISTING ancestor, `realpathSync` that
 * ancestor (collapsing any symlinks on the existing portion), then re-append the
 * remaining non-existent segments. This catches a symlink whose real target
 * escapes the writable roots even when the final file does not exist yet.
 *
 * Fail-safe: `realpathSync` can throw (ENOENT while walking, EACCES). This
 * function NEVER throws — on total failure it falls back to {@link nodePath.resolve}
 * (the prior behavior). Only {@link assertWritable} throws, and only on a genuine
 * deny.
 */
function resolveRealPathBestEffort(p: string): string {
  const resolved = nodePath.resolve(p);
  const trailing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length === 0 ? real : nodePath.join(real, ...trailing);
    } catch {
      const parent = nodePath.dirname(current);
      if (parent === current) {
        // Reached the filesystem root with no resolvable ancestor: fall back to
        // the plain resolved path (never throw from the resolution step).
        return resolved;
      }
      trailing.unshift(nodePath.basename(current));
      current = parent;
    }
  }
}

/**
 * Error thrown by {@link assertWritable} when a path is outside every writable
 * root. Carries only the resolved target and roots (no secret values).
 */
export class SandboxWriteDeniedError extends Error {
  readonly target: string;
  readonly roots: readonly string[];
  constructor(target: string, roots: readonly string[]) {
    super(
      `Write denied by sandbox writableRoots policy: "${target}" is not inside ` +
        `any writable root [${roots.join(", ")}]`
    );
    this.name = "SandboxWriteDeniedError";
    this.target = target;
    this.roots = roots;
  }
}

/**
 * Return true when `p` is writable under `roots`.
 *
 * Rules:
 *  - Empty/undefined `roots` => unrestricted (returns true). This preserves the
 *    current "metadata only" behavior; enforcement activates only when a
 *    sandbox profile explicitly sets non-empty `writableRoots`.
 *  - Both target and roots are resolved via {@link resolveRealPathBestEffort},
 *    which (a) collapses `.`/`..` segments and (b) realpath-resolves the deepest
 *    existing ancestor so a SYMLINK whose real target escapes every root is
 *    DENIED — even when the final write target does not exist yet.
 *  - Prefix matching is segment-boundary safe: target must equal a root or sit
 *    under `root + path.sep`, so root `/a/b` does NOT match sibling `/a/bc`.
 */
export function isPathWritable(p: string, roots: readonly string[] | undefined): boolean {
  if (!roots || roots.length === 0) return true;
  const target = resolveRealPathBestEffort(p);
  for (const root of roots) {
    if (!root) continue;
    const normalizedRoot = resolveRealPathBestEffort(root);
    if (target === normalizedRoot) return true;
    const rootWithSep = normalizedRoot.endsWith(nodePath.sep)
      ? normalizedRoot
      : normalizedRoot + nodePath.sep;
    if (target.startsWith(rootWithSep)) return true;
  }
  return false;
}

/**
 * Throw {@link SandboxWriteDeniedError} when `p` is not writable under `roots`.
 * No-op when `roots` is empty/undefined (safe default => unrestricted).
 */
export function assertWritable(p: string, roots: readonly string[] | undefined): void {
  if (isPathWritable(p, roots)) return;
  throw new SandboxWriteDeniedError(resolveRealPathBestEffort(p), roots ?? []);
}
