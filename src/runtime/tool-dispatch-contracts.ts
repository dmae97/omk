import type { OmkToolCall, OmkToolDefinition } from "./tool-registry-contract.js";
import { createToolExecutionBatches } from "./tool-registry-contract.js";
import {
  decideToolAuthority,
  decideToolAuthorityV2,
  mapToolNameToOp,
  type ToolAuthorityDecision,
  type ToolOp,
  type ToolOpV2,
} from "../safety/tool-authority-gate.js";
import type { ProviderAuthorityLevel } from "../contracts/provider-health.js";
import type { EnforcementProof } from "../safety/enforcement-engine.js";
import { assertWritable } from "./sandbox-profile.js";

export interface ToolDispatchResult<R = unknown> {
  readonly call: OmkToolCall;
  readonly status: "fulfilled" | "rejected";
  readonly value?: R;
  readonly reason?: unknown;
}

/** Shadow = record only; warn = visible diagnostic; enforce = a block/ask(non-TTY) verdict rejects the call. */
export type ToolAuthorityMode = "shadow" | "warn" | "enforce";

/**
 * Per-call verdict recorded at the dispatch checkpoint. Carries only coarse,
 * non-secret signals (op class, authority levels, policy) — never tool args.
 */
export interface ToolAuthorityDecisionRecord {
  readonly toolName: string;
  readonly op: ToolOp | ToolOpV2;
  readonly decision: ToolAuthorityDecision;
  readonly mode: ToolAuthorityMode;
  /** True only when the verdict actually rejected the call (enforce + block). */
  readonly enforced: boolean;
  /** Redacted, human-readable reason. Never includes args or secret values. */
  readonly reason: string;
  /** v2 enforcement proof hash when available. */
  readonly policyHash?: string;
}

/**
 * Authority wiring for one dispatch turn. All inputs are non-secret enum/bool
 * signals. When omitted from {@link dispatchToolCallsByContract}, dispatch is
 * byte-identical to the ungated path.
 */
export interface ToolAuthorityWiring {
  readonly writeAuthority: ProviderAuthorityLevel;
  readonly shellAuthority: ProviderAuthorityLevel;
  readonly approvalPolicy: "interactive" | "auto" | "yolo" | "block";
  readonly sandboxMode: "read-only" | "workspace-write";
  readonly tty: boolean;
  /**
   * Enforcement opt-in. Default `false` => shadow mode (zero behavior change):
   * verdicts are computed and recorded but never block. When `true`, a `block`
   * verdict (and `ask` in a non-TTY context, fail-closed) rejects the call.
   */
  readonly enforce?: boolean;
  /** Optional sink for computed verdicts (invoked in both shadow and enforce). */
  readonly onDecision?: (record: ToolAuthorityDecisionRecord) => void;
  /**
   * v2 enforcement proof from the adapter / runtime.
   * When present, the gate uses policy-dependent capability resolution.
   * Runtimes without a valid proof cannot enter authority lanes.
   */
  readonly enforcementProof?: EnforcementProof;
  /**
   * Optional writable-root allowlist for filesystem write enforcement (Lane C2).
   * Only consulted when `enforce === true` AND {@link resolveWritePath} is
   * provided AND it returns a non-empty path. ABSENT or empty => NO path check
   * runs and dispatch is byte-identical to the ungated path.
   */
  readonly writableRoots?: readonly string[];
  /**
   * Optional resolver mapping a tool call to its filesystem write target. Only
   * consulted when `enforce === true` AND `writableRoots` is non-empty. When this
   * is ABSENT (or returns undefined/empty), NO write-path check runs and dispatch
   * is byte-identical to now. When it returns a non-empty path, that path is
   * checked against `writableRoots` via {@link assertWritable}; a deny throws.
   */
  readonly resolveWritePath?: (call: OmkToolCall) => string | undefined;
}

const ENFORCE_PATTERN = /^(1|true|yes|on)$/i;

/**
 * Resolve staged authority mode from the environment. Default OFF means the gate
 * runs in shadow mode (record only). `warn` emits visible diagnostics without
 * blocking. `enforce` fail-closes block/ask(non-TTY) verdicts.
 */
export function resolveToolAuthorityMode(
  env: Record<string, string | undefined> = process.env,
): ToolAuthorityMode {
  const rawMode = (env.OMK_TOOL_AUTHORITY_MODE ?? "").trim().toLowerCase();
  if (rawMode === "enforce" || rawMode === "warn" || rawMode === "shadow") return rawMode;
  if (ENFORCE_PATTERN.test((env.OMK_TOOL_AUTHORITY_ENFORCE ?? "").trim())) return "enforce";
  if (ENFORCE_PATTERN.test((env.OMK_TOOL_AUTHORITY_WARN ?? "").trim())) return "warn";
  return "shadow";
}

/** Backward-compatible boolean resolver for existing dispatch call sites. */
export function resolveToolAuthorityEnforcement(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveToolAuthorityMode(env) === "enforce";
}

/** Build a redacted reason string from non-secret authority signals only. */
function redactedAuthorityReason(
  op: ToolOp,
  decision: ToolAuthorityDecision,
  wiring: ToolAuthorityWiring,
): string {
  return (
    `tool-authority ${decision} for ${op} op ` +
    `(write=${wiring.writeAuthority}, shell=${wiring.shellAuthority}, ` +
    `policy=${wiring.approvalPolicy}, sandbox=${wiring.sandboxMode}, tty=${wiring.tty})`
  );
}

/** Error used to reject a tool call rejected by the authority gate (enforce mode). */
export class ToolAuthorityBlockedError extends Error {
  readonly toolName: string;
  readonly op: ToolOp | ToolOpV2;
  readonly decision: ToolAuthorityDecision;
  readonly policyHash?: string;
  constructor(record: ToolAuthorityDecisionRecord) {
    super(record.reason);
    this.name = "ToolAuthorityBlockedError";
    this.toolName = record.toolName;
    this.op = record.op;
    this.decision = record.decision;
    this.policyHash = record.policyHash;
  }
}

/** Compute the gate verdict for a single call. Pure (no IO, no env reads). */
export function evaluateToolAuthority(
  toolName: string,
  wiring: ToolAuthorityWiring,
): { readonly record: ToolAuthorityDecisionRecord; readonly blocked: boolean } {
  const op = mapToolNameToOp(toolName);
  const decision = decideToolAuthority({
    op,
    writeAuthority: wiring.writeAuthority,
    shellAuthority: wiring.shellAuthority,
    approvalPolicy: wiring.approvalPolicy,
    sandboxMode: wiring.sandboxMode,
    tty: wiring.tty,
  });
  const enforce = wiring.enforce === true;
  // Fail-closed: a non-TTY "ask" is treated as a block (decideToolAuthority
  // already returns "block" for non-TTY interactive; the second clause is a
  // defensive guard in case the caller ever surfaces "ask" without a TTY).
  const wouldBlock = decision === "block" || (decision === "ask" && !wiring.tty);
  const blocked = enforce && wouldBlock;
  return {
    record: {
      toolName,
      op,
      decision,
      mode: enforce ? "enforce" : "shadow",
      enforced: blocked,
      reason: redactedAuthorityReason(op, decision, wiring),
    },
    blocked,
  };
}

/**
 * Compute the gate verdict for a single call using v2 enforcement proof.
 * Pure (no IO, no env reads).
 *
 * If `enforcementProof` is present, the gate uses policy-dependent capability
 * resolution. Runtimes without a valid proof cannot enter authority lanes.
 */
export function evaluateToolAuthorityV2(
  toolName: string,
  wiring: ToolAuthorityWiring,
): { readonly record: ToolAuthorityDecisionRecord; readonly blocked: boolean } {
  const op = mapToolNameToOp(toolName);

  if (wiring.enforcementProof) {
    const decision = decideToolAuthorityV2({
      op,
      writeAuthority: wiring.writeAuthority,
      shellAuthority: wiring.shellAuthority,
      approvalPolicy: wiring.approvalPolicy,
      sandboxMode: wiring.sandboxMode,
      tty: wiring.tty,
      enforcementProof: wiring.enforcementProof,
    });
    const enforce = wiring.enforce === true;
    const wouldBlock = decision === "block" || (decision === "ask" && !wiring.tty);
    const blocked = enforce && wouldBlock;
    return {
      record: {
        toolName,
        op,
        decision,
        mode: enforce ? "enforce" : "shadow",
        enforced: blocked,
        reason: redactedAuthorityReason(op, decision, wiring),
        policyHash: wiring.enforcementProof.policyHash,
      },
      blocked,
    };
  }

  // Fall back to legacy evaluation when no proof is present.
  return evaluateToolAuthority(toolName, wiring);
}

/**
 * Wrap a dispatch function with the authority checkpoint. In shadow mode the
 * wrapper records the verdict and always delegates to `dispatchOne`. In enforce
 * mode a blocked verdict rejects the call with a redacted reason.
 */
function buildGatedDispatch<A, R>(
  wiring: ToolAuthorityWiring,
  dispatchOne: (call: OmkToolCall<A>) => Promise<R>,
): (call: OmkToolCall<A>) => Promise<R> {
  return async (call: OmkToolCall<A>): Promise<R> => {
    const { record, blocked } = evaluateToolAuthorityV2(call.toolName, wiring);
    wiring.onDecision?.(record);
    if (blocked) {
      throw new ToolAuthorityBlockedError(record);
    }
    // Lane C2 filesystem write enforcement. NON-BREAKING: this block is entered
    // only when ALL opt-ins are present (enforce === true AND a non-empty
    // writableRoots AND a resolveWritePath that yields a non-empty path). When
    // any is absent the dispatch path is byte-identical to the pre-C2 behavior.
    // A symlink/escape deny throws SandboxWriteDeniedError from assertWritable.
    if (wiring.enforce === true && wiring.writableRoots?.length && wiring.resolveWritePath) {
      const writeTarget = wiring.resolveWritePath(call);
      if (writeTarget) {
        assertWritable(writeTarget, wiring.writableRoots);
      }
    }
    return dispatchOne(call);
  };
}

export async function dispatchToolCallsByContract<A, R>(
  calls: readonly OmkToolCall<A>[],
  registry: ReadonlyMap<string, OmkToolDefinition<A, R>>,
  dispatchOne: (call: OmkToolCall<A>) => Promise<R>,
  authority?: ToolAuthorityWiring,
): Promise<ToolDispatchResult<R>[]> {
  // When no authority wiring is supplied the dispatch path is byte-identical to
  // the pre-gate behavior (the checkpoint is a no-op).
  const effectiveDispatch = authority ? buildGatedDispatch(authority, dispatchOne) : dispatchOne;
  const batches = createToolExecutionBatches(calls, registry);
  const appended: ToolDispatchResult<R>[] = [];

  for (const batch of batches) {
    if (batch.kind === "parallel") {
      const settled = await Promise.allSettled(batch.calls.map((call) => effectiveDispatch(call)));
      settled.forEach((result, index) => {
        const call = batch.calls[index];
        if (!call) return;
        appended.push(toDispatchResult(call, result));
      });
      continue;
    }

    for (const call of batch.calls) {
      try {
        appended.push({ call, status: "fulfilled", value: await effectiveDispatch(call) });
      } catch (reason) {
        appended.push({ call, status: "rejected", reason });
      }
    }
  }

  return appended;
}

function toDispatchResult<R>(
  call: OmkToolCall,
  result: PromiseSettledResult<R>,
): ToolDispatchResult<R> {
  if (result.status === "fulfilled") {
    return { call, status: "fulfilled", value: result.value };
  }
  return { call, status: "rejected", reason: result.reason };
}
