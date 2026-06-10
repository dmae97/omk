/**
 * CLI Theme — Color Tier Explanation
 * Re-derives the degradation tier with the SAME precedence rules as
 * terminal-capability.ts detectColorDepth(), but records WHY each decision
 * was taken (env vars, --no-color flag, TERM) for `omk doctor` reporting.
 */

import { colorTierForDepth } from "./terminal-capability.js";
import type { ColorDepth, ColorTier } from "./terminal-capability.js";

export interface ColorTierExplanation {
  readonly tier: ColorTier;
  /** Human-readable reasons, in detection-precedence order. */
  readonly reasons: readonly string[];
  /** True when NO_COLOR env or --no-color flag asked for color suppression. */
  readonly noColorRequested: boolean;
  /** True when a no-color request actually resulted in the no-color tier. */
  readonly noColorHonored: boolean;
}

interface DepthDecision {
  readonly depth: ColorDepth;
  readonly reason: string;
}

function decideDepth(argv: readonly string[], env: NodeJS.ProcessEnv, isTty: boolean): DepthDecision {
  if (argv.includes("--no-color")) {
    return { depth: 0, reason: "--no-color CLI flag" };
  }
  if (env.NO_COLOR !== undefined) {
    return { depth: 0, reason: "NO_COLOR env var set" };
  }
  if (env.TERM === "dumb") {
    return { depth: 0, reason: "TERM=dumb" };
  }
  const force = env.FORCE_COLOR;
  if (force === "0" || force === "false") return { depth: 0, reason: `FORCE_COLOR=${force}` };
  if (force === "1") return { depth: 1, reason: "FORCE_COLOR=1 (basic ANSI)" };
  if (force === "2") return { depth: 4, reason: "FORCE_COLOR=2 (16-color)" };
  if (force === "3") return { depth: 8, reason: "FORCE_COLOR=3 (256-color)" };
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") {
    return { depth: 24, reason: `COLORTERM=${env.COLORTERM}` };
  }
  const term = env.TERM ?? "";
  if (term.includes("256color") || term.includes("256")) {
    return { depth: 8, reason: `TERM=${term} (256-color terminfo)` };
  }
  if (term.includes("color") || term.includes("xterm") || term.includes("screen") || term.includes("tmux")) {
    return { depth: 4, reason: `TERM=${term} (basic color terminfo)` };
  }
  if (isTty) {
    return { depth: 1, reason: "TTY without explicit color hints (basic ANSI assumed)" };
  }
  return { depth: 0, reason: "not a TTY and no color env hints" };
}

/**
 * Explain the detected color tier. Pure given (argv, env, isTty); defaults
 * mirror terminal-capability.ts getTerminalCapability() inputs.
 */
export function explainColorTier(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  isTty: boolean = process.stdout.isTTY ?? false
): ColorTierExplanation {
  const decision = decideDepth(argv, env, isTty);
  const tier = colorTierForDepth(decision.depth);
  const noColorRequested = argv.includes("--no-color") || env.NO_COLOR !== undefined;
  const reasons: string[] = [decision.reason];
  if (noColorRequested && tier !== "no-color") {
    reasons.push("WARNING: no-color was requested but a color tier was selected");
  }
  return {
    tier,
    reasons,
    noColorRequested,
    noColorHonored: !noColorRequested || tier === "no-color",
  };
}
