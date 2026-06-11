export type RouteWeightKey = "role" | "keyword" | "evidence" | "context" | "safety";

export type RouteWeights = Record<RouteWeightKey, number>;

export interface RouteWeightEvaluation {
  readonly weights: RouteWeights;
  readonly keywordTau: number;
  readonly outcomes: readonly boolean[];
}

export interface RouteCalibrationResult {
  readonly adopted: boolean;
  readonly current: RouteWeightEvaluation;
  readonly candidate: RouteWeightEvaluation;
  readonly meanDelta: number;
  readonly mcnemarP: number;
  readonly oddsRatio: number;
  readonly reason: string;
}

const DEFAULT_KEYS: readonly RouteWeightKey[] = ["role", "keyword", "evidence", "context", "safety"];

export const DEFAULT_ROUTE_WEIGHTS: RouteWeights = Object.freeze({
  role: 0.30,
  keyword: 0.25,
  evidence: 0.20,
  context: 0.15,
  safety: 0.10,
});

export function projectRouteWeights(weights: RouteWeights): RouteWeights {
  const clipped = Object.fromEntries(DEFAULT_KEYS.map((key) => [key, Math.max(0, Number(weights[key]) || 0)])) as RouteWeights;
  const sum = DEFAULT_KEYS.reduce((acc, key) => acc + clipped[key], 0);
  if (sum <= 0) return { ...DEFAULT_ROUTE_WEIGHTS };
  const projected = Object.fromEntries(DEFAULT_KEYS.map((key) => [key, clipped[key] / sum])) as RouteWeights;
  return roundRouteWeights(projected);
}

export function smoothKeywordScore(matchCount: number, tau: number): number {
  const safeTau = Math.max(0.001, tau);
  return round6(1 - Math.exp(-Math.max(0, matchCount) / safeTau));
}

export function generateRouteWeightCandidates(
  current: RouteWeights = DEFAULT_ROUTE_WEIGHTS,
  options: { step?: number; keywordTaus?: readonly number[] } = {},
): RouteWeights[] {
  const step = options.step ?? 0.05;
  const seeds: RouteWeights[] = [projectRouteWeights(current), uniformRouteWeights()];
  for (const key of DEFAULT_KEYS) {
    seeds.push(projectRouteWeights({ ...current, [key]: current[key] + step }));
    seeds.push(projectRouteWeights({ ...current, [key]: Math.max(0, current[key] - step) }));
  }
  const seen = new Set<string>();
  const result: RouteWeights[] = [];
  for (const seed of seeds) {
    const id = DEFAULT_KEYS.map((key) => seed[key].toFixed(6)).join(",");
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(seed);
  }
  return result;
}

export function selectBestRouteWeightEvaluation(evaluations: readonly RouteWeightEvaluation[]): RouteWeightEvaluation {
  if (evaluations.length === 0) throw new Error("route calibration requires at least one evaluation");
  return [...evaluations].sort((a, b) => meanSuccess(b.outcomes) - meanSuccess(a.outcomes))[0];
}

export function decideRouteWeightAdoption(
  current: RouteWeightEvaluation,
  candidate: RouteWeightEvaluation,
  options: { alpha?: number } = {},
): RouteCalibrationResult {
  if (current.outcomes.length !== candidate.outcomes.length) {
    throw new Error("paired route calibration requires equal-length outcome vectors");
  }
  if (current.outcomes.length === 0) {
    throw new Error("route calibration requires at least one paired outcome");
  }
  const currentMean = meanSuccess(current.outcomes);
  const candidateMean = meanSuccess(candidate.outcomes);
  const meanDelta = round6(candidateMean - currentMean);
  const { b, c } = discordantCounts(current.outcomes, candidate.outcomes);
  const mcnemarP = exactMcNemarP(b, c);
  const oddsRatio = c === 0 ? (b > 0 ? Number.POSITIVE_INFINITY : 1) : b / c;
  const alpha = options.alpha ?? 0.05;
  const adopted = mcnemarP < alpha && oddsRatio > 1;
  return {
    adopted,
    current,
    candidate,
    meanDelta,
    mcnemarP,
    oddsRatio,
    reason: adopted
      ? `candidate wins paired McNemar p=${mcnemarP.toFixed(4)}, oddsRatio=${formatRatio(oddsRatio)}`
      : "hand-set weights not yet beaten by paired evidence",
  };
}

function uniformRouteWeights(): RouteWeights {
  return { role: 0.2, keyword: 0.2, evidence: 0.2, context: 0.2, safety: 0.2 };
}

function meanSuccess(outcomes: readonly boolean[]): number {
  return outcomes.filter(Boolean).length / Math.max(1, outcomes.length);
}

function discordantCounts(current: readonly boolean[], candidate: readonly boolean[]): { b: number; c: number } {
  let b = 0;
  let c = 0;
  for (let i = 0; i < current.length; i += 1) {
    if (candidate[i] && !current[i]) b += 1;
    if (!candidate[i] && current[i]) c += 1;
  }
  return { b, c };
}

function exactMcNemarP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const observed = Math.min(b, c);
  let tail = 0;
  for (let k = 0; k <= observed; k += 1) {
    tail += binomialProbability(n, k, 0.5);
  }
  return Math.min(1, 2 * tail);
}

function binomialProbability(n: number, k: number, p: number): number {
  return combination(n, k) * (p ** k) * ((1 - p) ** (n - k));
}

function combination(n: number, k: number): number {
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i += 1) {
    result = (result * (n - kk + i)) / i;
  }
  return result;
}

function roundRouteWeights(weights: RouteWeights): RouteWeights {
  const rounded = Object.fromEntries(DEFAULT_KEYS.map((key) => [key, round6(weights[key])])) as RouteWeights;
  const sum = DEFAULT_KEYS.reduce((total, key) => total + rounded[key], 0);
  const residual = round6(1 - sum);
  const recipient = DEFAULT_KEYS.reduce((best, key) => (rounded[key] > rounded[best] ? key : best));
  rounded[recipient] = round6(Math.max(0, rounded[recipient] + residual));
  return rounded;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "Infinity";
}
