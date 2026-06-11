export const TRUST_FIELD_KEYS = [
  "schema",
  "commands",
  "stdout",
  "hashes",
  "decisions",
  "evidence",
  "limitations",
  "replay",
] as const;

export type TrustFieldKey = typeof TRUST_FIELD_KEYS[number];
export type TrustWeights = Record<TrustFieldKey, number>;

export interface TrustCalibrationExample {
  readonly features: Record<TrustFieldKey, 0 | 1>;
  readonly success: boolean;
}

export interface TrustCalibrationResult {
  readonly adopted: boolean;
  readonly weights: TrustWeights;
  readonly threshold: number;
  readonly baselineAuc: number;
  readonly candidateAuc: number;
  readonly reason: string;
}

export const DEFAULT_TRUST_WEIGHTS: TrustWeights = Object.freeze({
  schema: 0.15,
  commands: 0.15,
  stdout: 0.10,
  hashes: 0.15,
  decisions: 0.15,
  evidence: 0.15,
  limitations: 0.05,
  replay: 0.10,
});

export function scoreTrustFeatures(features: Record<TrustFieldKey, number>, weights: TrustWeights = DEFAULT_TRUST_WEIGHTS): number {
  return round6(TRUST_FIELD_KEYS.reduce((sum, key) => sum + (weights[key] * (features[key] ? 1 : 0)), 0));
}

export function calibrateTrustWeights(
  data: readonly TrustCalibrationExample[],
  options: { minSamples?: number; epsilon?: number; iterations?: number; learningRate?: number; priorSigma?: number } = {},
): TrustCalibrationResult {
  const minSamples = options.minSamples ?? 100;
  if (data.length < minSamples) {
    return {
      adopted: false,
      weights: { ...DEFAULT_TRUST_WEIGHTS },
      threshold: 0.75,
      baselineAuc: 0,
      candidateAuc: 0,
      reason: `insufficient labeled runs: ${data.length} < ${minSamples}`,
    };
  }

  const beta = fitLogisticMap(data, options);
  const weights = normalizeTrustWeights(Object.fromEntries(
    TRUST_FIELD_KEYS.map((key, index) => [key, Math.max(options.epsilon ?? 0.01, beta[index])])
  ) as TrustWeights);
  const baselineScores = data.map((example) => scoreTrustFeatures(example.features, DEFAULT_TRUST_WEIGHTS));
  const candidateScores = data.map((example) => scoreTrustFeatures(example.features, weights));
  const labels = data.map((example) => example.success);
  const baselineAuc = auc(baselineScores, labels);
  const candidateAuc = auc(candidateScores, labels);
  const threshold = youdenThreshold(candidateScores, labels);
  const adopted = candidateAuc > baselineAuc;
  return {
    adopted,
    weights: adopted ? weights : { ...DEFAULT_TRUST_WEIGHTS },
    threshold: adopted ? threshold : 0.75,
    baselineAuc,
    candidateAuc,
    reason: adopted
      ? `candidate trust weights improved AUC by ${(candidateAuc - baselineAuc).toFixed(4)}`
      : "current trust weights not yet beaten by labeled evidence",
  };
}

export function normalizeTrustWeights(weights: TrustWeights): TrustWeights {
  const positive = Object.fromEntries(TRUST_FIELD_KEYS.map((key) => [key, Math.max(0, Number(weights[key]) || 0)])) as TrustWeights;
  const sum = TRUST_FIELD_KEYS.reduce((acc, key) => acc + positive[key], 0);
  if (sum <= 0) return { ...DEFAULT_TRUST_WEIGHTS };
  return Object.fromEntries(TRUST_FIELD_KEYS.map((key) => [key, round6(positive[key] / sum)])) as TrustWeights;
}

function fitLogisticMap(
  data: readonly TrustCalibrationExample[],
  options: { iterations?: number; learningRate?: number; priorSigma?: number } = {},
): number[] {
  const iterations = options.iterations ?? 500;
  const learningRate = options.learningRate ?? 0.05;
  const priorSigma = options.priorSigma ?? 1;
  const prior = TRUST_FIELD_KEYS.map((key) => DEFAULT_TRUST_WEIGHTS[key]);
  const beta = [...prior];
  let intercept = 0;
  for (let iter = 0; iter < iterations; iter += 1) {
    const grad = new Array(beta.length).fill(0) as number[];
    let interceptGrad = 0;
    for (const example of data) {
      const x = TRUST_FIELD_KEYS.map((key) => example.features[key]);
      const y = example.success ? 1 : 0;
      const p = sigmoid(intercept + dot(beta, x));
      const error = p - y;
      interceptGrad += error;
      for (let i = 0; i < beta.length; i += 1) grad[i] += error * x[i];
    }
    intercept -= learningRate * (interceptGrad / data.length);
    for (let i = 0; i < beta.length; i += 1) {
      const shrinkage = (beta[i] - prior[i]) / (priorSigma * priorSigma);
      beta[i] -= learningRate * ((grad[i] / data.length) + shrinkage);
    }
  }
  return beta;
}

function auc(scores: readonly number[], labels: readonly boolean[]): number {
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    if (labels[i]) positives.push(scores[i]); else negatives.push(scores[i]);
  }
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  let wins = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos > neg) wins += 1;
      else if (pos === neg) wins += 0.5;
    }
  }
  return round6(wins / (positives.length * negatives.length));
}

function youdenThreshold(scores: readonly number[], labels: readonly boolean[]): number {
  const thresholds = [...new Set(scores)].sort((a, b) => a - b);
  let best = thresholds[0] ?? 0.75;
  let bestJ = -Infinity;
  for (const threshold of thresholds) {
    let tp = 0; let tn = 0; let fp = 0; let fn = 0;
    for (let i = 0; i < scores.length; i += 1) {
      const predicted = scores[i] >= threshold;
      const actual = labels[i];
      if (predicted && actual) tp += 1;
      else if (predicted && !actual) fp += 1;
      else if (!predicted && actual) fn += 1;
      else tn += 1;
    }
    const sensitivity = tp / Math.max(1, tp + fn);
    const specificity = tn / Math.max(1, tn + fp);
    const j = sensitivity + specificity - 1;
    if (j > bestJ) {
      bestJ = j;
      best = threshold;
    }
  }
  return round6(best);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
