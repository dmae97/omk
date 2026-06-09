/**
 * Blast radius penalty — penalizes runtimes for high-risk, wide-impact tasks.
 *
 * Higher downstream dependency counts, larger affected file surfaces, and
 * global side-effects increase the penalty, nudging the router toward
 * more mature or lower-blast-radius runtimes.
 */

import type { BlastRadiusParams } from "./contracts/router-v2.js";

export type { BlastRadiusParams } from "./contracts/router-v2.js";

export function computeBlastRadiusPenalty(params: BlastRadiusParams): number {
  const { downstreamNodeCount, affectedFileCount, hasGlobalSideEffects } = params;

  const downstreamPenalty = Math.min(0.15, downstreamNodeCount * 0.03);
  const filePenalty = Math.min(0.10, affectedFileCount * 0.01);
  const sideEffectPenalty = hasGlobalSideEffects ? 0.10 : 0.0;

  return Math.min(0.30, downstreamPenalty + filePenalty + sideEffectPenalty);
}
