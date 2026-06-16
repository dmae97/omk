/**
 * HeadroomPolicy — proactive context compaction trigger.
 *
 * Industrial control-loop policy: given current token usage and model
 * context window, decide whether to compact BEFORE utilization reaches
 * a configurable threshold (default 90%).
 *
 * Prefers the external `headroom` CLI compressor when available;
 * falls back to caller-provided structured text and finally to legacy
 * side-effect optimizers when not.
 *
 * Deterministic except for the injectable `runHeadroom` runner.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeadroomDecision {
  readonly shouldCompact: boolean;
  readonly utilization: number;
  readonly threshold: number;
  readonly usedTokens: number;
  readonly contextWindow: number;
  readonly reason: string;
}

export type HeadroomBackend = "headroom" | "structured-fallback" | "side-effect-fallback" | "none";

export interface HeadroomCompactResult {
  /** Backward-compatible summary: a backend produced compacted text or completed a legacy fallback. */
  readonly compacted: boolean;
  /** Backward-compatible backend family. */
  readonly via: "headroom" | "fallback" | "none";
  readonly compactedText?: string;
  readonly reason?: string;
  /** Whether a compaction attempt was made because the policy threshold was crossed. */
  readonly attempted: boolean;
  /** Specific backend that produced this result. */
  readonly backend: HeadroomBackend;
  /** Whether a textual backend produced non-empty compacted text. */
  readonly compactedTextProduced: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.90;
const MIN_THRESHOLD = 0.50;
const MAX_THRESHOLD = 0.99;

// ─── Threshold resolver ──────────────────────────────────────────────────────

export function resolveHeadroomThreshold(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.OMK_HEADROOM_THRESHOLD;
  if (raw === undefined || raw === "") return DEFAULT_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_THRESHOLD;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, parsed));
}

// ─── Enabled check ───────────────────────────────────────────────────────────

export function isHeadroomEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.OMK_HEADROOM;
  if (raw === undefined || raw === "") return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "0" || normalized === "false") return false;
  return true;
}

// ─── Evaluate ────────────────────────────────────────────────────────────────

export function evaluateHeadroom(input: {
  usedTokens: number;
  contextWindow: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): HeadroomDecision {
  const env = input.env ?? process.env;
  const enabled = isHeadroomEnabled(env);
  const threshold = resolveHeadroomThreshold(env);
  const { usedTokens, contextWindow } = input;

  if (!enabled) {
    return {
      shouldCompact: false,
      utilization: 0,
      threshold,
      usedTokens,
      contextWindow,
      reason: "headroom disabled via OMK_HEADROOM",
    };
  }

  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      shouldCompact: false,
      utilization: 0,
      threshold,
      usedTokens,
      contextWindow,
      reason: `context window size unknown (${String(contextWindow)})`,
    };
  }

  const utilization = usedTokens / contextWindow;
  const shouldCompact = utilization >= threshold;

  return {
    shouldCompact,
    utilization,
    threshold,
    usedTokens,
    contextWindow,
    reason: shouldCompact
      ? `utilization ${(utilization * 100).toFixed(1)}% >= threshold ${(threshold * 100).toFixed(1)}%`
      : `utilization ${(utilization * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`,
  };
}

// ─── Compaction runner ───────────────────────────────────────────────────────

const HEADROOM_CLI_TIMEOUT_MS = 15_000;

async function defaultRunHeadroom(text: string): Promise<string | null> {
  try {
    const { runShell } = await import("../util/shell.js");
    const result = await runShell("headroom", ["compact", "--stdin"], {
      timeout: HEADROOM_CLI_TIMEOUT_MS,
      input: text,
    });
    if (result.failed || result.exitCode !== 0) return null;
    const output = result.stdout.trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

export async function maybeCompactWithHeadroom(args: {
  decision: HeadroomDecision;
  text?: string;
  runHeadroom?: (text: string) => Promise<string | null>;
  fallback?: () => Promise<void>;
  fallbackText?: () => string | null | Promise<string | null>;
}): Promise<HeadroomCompactResult> {
  if (!args.decision.shouldCompact) {
    return {
      compacted: false,
      via: "none",
      attempted: false,
      backend: "none",
      compactedTextProduced: false,
      reason: args.decision.reason,
    };
  }

  // Try headroom first.
  if (args.text) {
    try {
      const runner = args.runHeadroom ?? defaultRunHeadroom;
      const result = await runner(args.text);
      if (typeof result === "string" && result.trim().length > 0) {
        return {
          compacted: true,
          via: "headroom",
          backend: "headroom",
          compactedText: result,
          attempted: true,
          compactedTextProduced: true,
          reason: "headroom CLI compaction produced text",
        };
      }
    } catch {
      // Headroom threw — fall through to fallback.
    }
  }

  // Fall back to a caller-provided textual compaction. This keeps autocompact
  // effective even when the installed headroom CLI exposes proxy/MCP commands
  // but no direct `compact --stdin` subcommand.
  if (args.fallbackText) {
    try {
      const text = await args.fallbackText();
      if (typeof text === "string" && text.trim().length > 0) {
        return {
          compacted: true,
          via: "fallback",
          backend: "structured-fallback",
          compactedText: text,
          attempted: true,
          compactedTextProduced: true,
          reason: "headroom CLI compaction unavailable; used structured fallback text",
        };
      }
      if (typeof text === "string") {
        return {
          compacted: false,
          via: "none",
          backend: "none",
          attempted: true,
          compactedTextProduced: false,
          reason: "empty fallback text",
        };
      }
    } catch {
      // Text fallback failed — try side-effect fallback below.
    }
  }

  // Fall back to built-in optimizer side effects when supplied by older callers.
  if (args.fallback) {
    try {
      await args.fallback();
      return {
        compacted: true,
        via: "fallback",
        backend: "side-effect-fallback",
        attempted: true,
        compactedTextProduced: false,
        reason: "side-effect fallback completed",
      };
    } catch {
      // Fallback also failed — graceful degradation.
    }
  }

  return {
    compacted: false,
    via: "none",
    backend: "none",
    attempted: true,
    compactedTextProduced: false,
    reason: "no compaction backend succeeded",
  };
}
