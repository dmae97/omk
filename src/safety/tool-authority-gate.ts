/**
 * Pure tool-authority decision primitive.
 *
 * Decides allow / ask / block for a tool operation given the provider's
 * write/shell authority, the active approval policy, the sandbox mode, and
 * whether a TTY is attached. The function is intentionally pure: no IO, no
 * environment reads, no secrets, no side effects.
 *
 * STATUS (0.78.2 stabilization): this primitive is NOT wired into any live
 * tool-dispatch path. It exists so 0.78.3 can wire it into
 * `dispatchToolCallsByContract` (src/runtime/tool-dispatch-contracts.ts) and
 * the kimi runner tool loop without re-deriving the policy. Zero behavior
 * change to current execution.
 *
 * Design rules (authority outranks policy; fail-closed):
 *  1. read ops are always allowed.
 *  2. a read-only sandbox is a hard floor: any non-read op is blocked.
 *  3. authority must be satisfied for the op before policy is consulted:
 *       write  -> writeAuthority === "full"
 *       shell  -> shellAuthority === "full"
 *       merge  -> writeAuthority === "full" AND shellAuthority === "full"
 *  4. once authority is satisfied, the approval policy decides:
 *       block       -> block
 *       yolo        -> allow
 *       auto        -> allow
 *       interactive -> ask when a TTY is present, otherwise block
 *                      (ask in a non-TTY context = deny-by-default).
 */

import type { ProviderAuthorityLevel } from "../contracts/provider-health.js";

/** Coarse operation class used by the authority gate. */
export type ToolOp = "read" | "write" | "shell" | "merge";

/** Gate verdict for a single tool operation. */
export type ToolAuthorityDecision = "allow" | "ask" | "block";

/** Inputs to the authority decision. Fully self-contained and side-effect free. */
export interface ToolAuthorityContext {
  /** Operation class derived from the tool being invoked. */
  readonly op: ToolOp;
  /** Provider authority for write/mutation work. */
  readonly writeAuthority: ProviderAuthorityLevel;
  /** Provider authority for shell/CLI work. */
  readonly shellAuthority: ProviderAuthorityLevel;
  /** Active approval policy for the run. */
  readonly approvalPolicy: "interactive" | "auto" | "yolo" | "block";
  /** Active sandbox mode; "read-only" is a hard floor for non-read ops. */
  readonly sandboxMode: "read-only" | "workspace-write";
  /** Whether an interactive TTY is attached (gates "interactive" -> ask). */
  readonly tty: boolean;
}

/**
 * Map a raw tool name to its coarse {@link ToolOp} class.
 *
 * Matching is case-insensitive. Unrecognized tools fail closed to the most
 * restrictive sensible op (`shell` = arbitrary effect execution) rather than
 * `read`, so an unknown tool is never silently treated as harmless.
 */
export function mapToolNameToOp(toolName: string): ToolOp {
  const name = toolName.trim().toLowerCase();

  // Highest-risk git operations publish or rewrite history -> merge.
  const mergeSignals = ["push", "merge", "cherry-pick", "cherrypick", "rebase", "tag"];
  const looksLikeGit = name.startsWith("git") || /\bgit\b/.test(name);
  if (looksLikeGit && mergeSignals.some((signal) => name.includes(signal))) {
    return "merge";
  }
  // Bare verbs used directly as tool names (e.g. "merge", "rebase").
  if (mergeSignals.some((signal) => name === signal)) {
    return "merge";
  }

  // Shell / command execution.
  if (name === "shell" || name === "bash" || name.includes("shell") || name.includes("bash")) {
    return "shell";
  }

  // Write / mutation tools.
  const writeSignals = ["write", "str_replace", "strreplace", "applydiff", "apply_diff", "edit"];
  if (writeSignals.some((signal) => name.includes(signal))) {
    return "write";
  }

  // Read-only tools (exact names to avoid accidental substring matches).
  const readSignals = ["read", "grep", "glob", "ls", "cat"];
  if (readSignals.includes(name)) {
    return "read";
  }

  // Unknown / unrecognized -> most restrictive sensible op (fail-closed).
  return "shell";
}

/** Returns true when provider authority is sufficient for the requested op. */
function isAuthoritySatisfied(ctx: ToolAuthorityContext): boolean {
  switch (ctx.op) {
    case "read":
      return true;
    case "write":
      return ctx.writeAuthority === "full";
    case "shell":
      return ctx.shellAuthority === "full";
    case "merge":
      return ctx.writeAuthority === "full" && ctx.shellAuthority === "full";
  }
}

/**
 * Decide allow / ask / block for a tool operation. Pure and fail-closed.
 *
 * @see ToolAuthorityContext for the decision inputs and ordering rules.
 */
export function decideToolAuthority(ctx: ToolAuthorityContext): ToolAuthorityDecision {
  // Rule 1: reads are always allowed.
  if (ctx.op === "read") {
    return "allow";
  }

  // Rule 2: a read-only sandbox is a hard floor for any non-read op.
  if (ctx.sandboxMode === "read-only") {
    return "block";
  }

  // Rule 3: authority outranks policy. Insufficient authority => block.
  if (!isAuthoritySatisfied(ctx)) {
    return "block";
  }

  // Rule 4: authority satisfied -> apply approval policy.
  if (ctx.approvalPolicy === "block") {
    return "block";
  }
  if (ctx.approvalPolicy === "yolo") {
    return "allow";
  }
  if (ctx.approvalPolicy === "auto") {
    return "allow";
  }
  // interactive: ask only when a TTY is attached; non-TTY ask = deny-by-default.
  return ctx.tty ? "ask" : "block";
}
