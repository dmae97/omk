/**
 * omk.weights.v1 — single weights contract for scoring vectors.
 *
 * Source of truth: schemas/omk.weights.v1.json (repo dev). The npm package
 * ships without schemas/, so DEFAULT_WEIGHTS embeds the same values and is
 * used as the fallback. The two MUST stay deep-equal (enforced by
 * test/weights-config.test.mjs).
 *
 * Normalization contract (behavior-preserving):
 *   ŵ = w / Σw, and penalties AND thresholds are scaled by the SAME factor
 *   1/Σw, so the transform is a pure uniform scaling. Rankings and threshold
 *   verdicts are mathematically identical to the historical raw-weight
 *   formulas.
 *
 * intentCapability is intentionally NOT normalized: the vectors are
 * feature-fit emphasis templates whose sub-unit sums are intentional;
 * normalizing them would change cross-term mixing (NOT behavior-preserving).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NodeIntent } from "./contracts/router-v2.js";

// ── Key vocabularies ─────────────────────────────────────────────

const RELEASE_GATE_WEIGHT_KEYS = [
  "ci",
  "build",
  "types",
  "tests",
  "install",
  "demo",
  "proof",
  "maturity",
  "docs",
] as const;
export type ReleaseGateWeightKey = (typeof RELEASE_GATE_WEIGHT_KEYS)[number];

const RELEASE_GATE_PENALTY_KEYS = ["regression"] as const;
export type ReleaseGatePenaltyKey = (typeof RELEASE_GATE_PENALTY_KEYS)[number];

const RELEASE_GATE_THRESHOLD_KEYS = ["preRelease", "stable"] as const;
export type ReleaseGateThresholdKey = (typeof RELEASE_GATE_THRESHOLD_KEYS)[number];

const ROUTER_V2_WEIGHT_KEYS = [
  "bayesianEvidence",
  "confidence",
  "capabilityFit",
  "maturity",
  "latency",
  "cost",
] as const;
export type RouterV2WeightKey = (typeof ROUTER_V2_WEIGHT_KEYS)[number];

const ROUTER_V2_PENALTY_KEYS = ["recentFailure", "blastRadius"] as const;
export type RouterV2PenaltyKey = (typeof ROUTER_V2_PENALTY_KEYS)[number];

const NODE_INTENT_KEYS = [
  "research",
  "planning",
  "coding",
  "debugging",
  "refactor",
  "review",
  "test-generation",
  "documentation",
  "shell-operation",
] as const satisfies readonly NodeIntent[];

const CAPABILITY_WEIGHT_KEYS = [
  "read",
  "write",
  "shell",
  "patch",
  "review",
  "vision",
  "toolCalling",
] as const;
/** Capability keys allowed in intentCapability vectors. */
export type CapabilityWeightKey = (typeof CAPABILITY_WEIGHT_KEYS)[number];

// ── Contract types ───────────────────────────────────────────────

/** A normalize:true vector: weights are normalized, penalties/thresholds scaled uniformly. */
export interface NormalizedVectorSpec<
  W extends string,
  P extends string,
  T extends string = never,
> {
  readonly normalize: true;
  readonly weights: Readonly<Record<W, number>>;
  readonly penalties: Readonly<Record<P, number>>;
  readonly thresholds?: Readonly<Record<T, number>>;
}

/** A normalize:false vector family kept verbatim (no scaling). */
export interface IntentCapabilitySpec {
  readonly normalize: false;
  readonly rationale: string;
  readonly vectors: Readonly<
    Record<NodeIntent, Readonly<Partial<Record<CapabilityWeightKey, number>>>>
  >;
}

export type ReleaseGateSpec = NormalizedVectorSpec<
  ReleaseGateWeightKey,
  ReleaseGatePenaltyKey,
  ReleaseGateThresholdKey
>;

export type RouterV2CompositeSpec = NormalizedVectorSpec<
  RouterV2WeightKey,
  RouterV2PenaltyKey
>;

export interface WeightsConfigV1 {
  readonly schemaVersion: "omk.weights.v1";
  readonly vectors: {
    readonly releaseGate: ReleaseGateSpec;
    readonly routerV2Composite: RouterV2CompositeSpec;
    readonly intentCapability: IntentCapabilitySpec;
  };
}

/** Effective (uniformly scaled) weights/penalties/thresholds for a vector. */
export interface EffectiveVector<
  W extends string,
  P extends string,
  T extends string = never,
> {
  readonly weights: Readonly<Record<W, number>>;
  readonly penalties: Readonly<Record<P, number>>;
  readonly thresholds: Readonly<Record<T, number>>;
  /** Uniform scale factor 1/Σw applied to weights, penalties, and thresholds. */
  readonly scale: number;
}

// ── Embedded defaults (mirror of schemas/omk.weights.v1.json) ────

export const DEFAULT_WEIGHTS: WeightsConfigV1 = {
  schemaVersion: "omk.weights.v1",
  vectors: {
    releaseGate: {
      normalize: true,
      weights: {
        ci: 0.15,
        build: 0.1,
        types: 0.1,
        tests: 0.1,
        install: 0.1,
        demo: 0.15,
        proof: 0.15,
        maturity: 0.1,
        docs: 0.1,
      },
      penalties: { regression: 0.15 },
      thresholds: { preRelease: 0.75, stable: 0.9 },
    },
    routerV2Composite: {
      normalize: true,
      weights: {
        bayesianEvidence: 0.25,
        confidence: 0.15,
        capabilityFit: 0.2,
        maturity: 0.15,
        latency: 0.1,
        cost: 0.1,
      },
      penalties: { recentFailure: 0.15, blastRadius: 0.1 },
    },
    intentCapability: {
      normalize: false,
      rationale:
        "feature-fit emphasis templates; sub-unit sums intentional; normalizing would change cross-term mixing (NOT behavior-preserving)",
      vectors: {
        research: { read: 0.35, review: 0.2, toolCalling: 0.15, vision: 0.1 },
        planning: { read: 0.3, review: 0.2, toolCalling: 0.15 },
        coding: { write: 0.3, patch: 0.25, shell: 0.15, toolCalling: 0.1 },
        debugging: { read: 0.2, write: 0.2, patch: 0.2, shell: 0.15, toolCalling: 0.1 },
        refactor: { write: 0.25, patch: 0.25, review: 0.15, toolCalling: 0.1 },
        review: { review: 0.35, read: 0.25, toolCalling: 0.1 },
        "test-generation": { write: 0.25, patch: 0.2, review: 0.15, toolCalling: 0.1 },
        documentation: { read: 0.25, write: 0.15, review: 0.15, toolCalling: 0.1 },
        "shell-operation": { shell: 0.4, read: 0.15, write: 0.1 },
      },
    },
  },
};

// ── JSON loading ─────────────────────────────────────────────────

const SCHEMA_FILENAME = "omk.weights.v1.json";

function schemaFilePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/runtime/weights-config.js → <repo>/schemas/omk.weights.v1.json
  return join(here, "..", "..", "schemas", SCHEMA_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumberKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isCapabilityVector(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, weight]) =>
      (CAPABILITY_WEIGHT_KEYS as readonly string[]).includes(key) &&
      typeof weight === "number" &&
      Number.isFinite(weight),
  );
}

function isWeightsConfigV1(value: unknown): value is WeightsConfigV1 {
  if (!isRecord(value) || value.schemaVersion !== "omk.weights.v1") return false;
  const vectors = value.vectors;
  if (!isRecord(vectors)) return false;

  const releaseGate = vectors.releaseGate;
  if (
    !isRecord(releaseGate) ||
    releaseGate.normalize !== true ||
    !hasNumberKeys(releaseGate.weights, RELEASE_GATE_WEIGHT_KEYS) ||
    !hasNumberKeys(releaseGate.penalties, RELEASE_GATE_PENALTY_KEYS) ||
    !hasNumberKeys(releaseGate.thresholds, RELEASE_GATE_THRESHOLD_KEYS)
  ) {
    return false;
  }

  const routerV2 = vectors.routerV2Composite;
  if (
    !isRecord(routerV2) ||
    routerV2.normalize !== true ||
    !hasNumberKeys(routerV2.weights, ROUTER_V2_WEIGHT_KEYS) ||
    !hasNumberKeys(routerV2.penalties, ROUTER_V2_PENALTY_KEYS)
  ) {
    return false;
  }

  const intentCapability = vectors.intentCapability;
  if (
    !isRecord(intentCapability) ||
    intentCapability.normalize !== false ||
    typeof intentCapability.rationale !== "string" ||
    !isRecord(intentCapability.vectors)
  ) {
    return false;
  }
  const intentVectors = intentCapability.vectors;
  return NODE_INTENT_KEYS.every((intent) => isCapabilityVector(intentVectors[intent]));
}

/**
 * Load the omk.weights.v1 config: prefer schemas/omk.weights.v1.json when the
 * repo file exists (dev checkout), otherwise use the embedded defaults
 * (published package ships without schemas/).
 */
export function loadWeightsConfig(): WeightsConfigV1 {
  const filePath = schemaFilePath();
  if (existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (isWeightsConfigV1(parsed)) return parsed;
    } catch {
      // Malformed repo file: fall back to embedded defaults.
    }
  }
  return DEFAULT_WEIGHTS;
}

let cachedConfig: WeightsConfigV1 | undefined;

/** Memoized accessor for the loaded weights config. */
export function getWeightsConfig(): WeightsConfigV1 {
  if (cachedConfig === undefined) cachedConfig = loadWeightsConfig();
  return cachedConfig;
}

// ── Normalization ────────────────────────────────────────────────

function scaleRecord<K extends string>(
  record: Readonly<Record<K, number>>,
  scale: number,
): Readonly<Record<K, number>> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record as Record<string, number>)) {
    out[key] = value * scale;
  }
  return out as Readonly<Record<K, number>>;
}

/**
 * Normalize a normalize:true vector: ŵ = w/Σw. Penalties and thresholds are
 * scaled by the SAME factor 1/Σw so the transform is a pure uniform scaling
 * (ranking and threshold semantics preserved).
 *
 * @throws Error when the post-normalization invariant |Σŵ-1|>1e-6 fails.
 */
export function normalizeVector<W extends string, P extends string, T extends string>(
  name: string,
  spec: NormalizedVectorSpec<W, P, T>,
): EffectiveVector<W, P, T> {
  const positiveSum = Object.values<number>(
    spec.weights as Record<string, number>,
  ).reduce((acc, value) => acc + value, 0);
  if (!(positiveSum > 0)) {
    throw new Error(`omk.weights.v1 invariant violated: Σw≤0 for ${name}`);
  }
  const scale = 1 / positiveSum;

  const weights = scaleRecord<W>(spec.weights, scale);
  const normalizedSum = Object.values<number>(
    weights as Record<string, number>,
  ).reduce((acc, value) => acc + value, 0);
  if (Math.abs(normalizedSum - 1) > 1e-6) {
    throw new Error(`omk.weights.v1 invariant violated: |Σŵ-1|>1e-6 for ${name}`);
  }

  const penalties = scaleRecord<P>(spec.penalties, scale);
  const thresholds = scaleRecord<T>(
    (spec.thresholds ?? ({} as Readonly<Record<T, number>>)),
    scale,
  );
  return { weights, penalties, thresholds, scale };
}

// ── Effective vector accessors ───────────────────────────────────

/** Effective (normalized) release-gate weights, penalties, and thresholds. */
export function releaseGateEffective(
  config: WeightsConfigV1 = getWeightsConfig(),
): EffectiveVector<ReleaseGateWeightKey, ReleaseGatePenaltyKey, ReleaseGateThresholdKey> {
  return normalizeVector("releaseGate", config.vectors.releaseGate);
}

/** Effective (normalized) Router V2 composite weights and penalties. */
export function routerV2CompositeEffective(
  config: WeightsConfigV1 = getWeightsConfig(),
): EffectiveVector<RouterV2WeightKey, RouterV2PenaltyKey> {
  return normalizeVector("routerV2Composite", config.vectors.routerV2Composite);
}

/**
 * Intent → capability weight entries, verbatim (normalize:false), in the
 * declared order of each vector.
 */
export function intentCapabilityWeights(
  config: WeightsConfigV1 = getWeightsConfig(),
): Readonly<Record<NodeIntent, ReadonlyArray<readonly [CapabilityWeightKey, number]>>> {
  const out = {} as Record<NodeIntent, ReadonlyArray<readonly [CapabilityWeightKey, number]>>;
  for (const intent of NODE_INTENT_KEYS) {
    const vector = config.vectors.intentCapability.vectors[intent];
    const entries: Array<readonly [CapabilityWeightKey, number]> = [];
    for (const [key, weight] of Object.entries(vector)) {
      if (typeof weight === "number") {
        entries.push([key as CapabilityWeightKey, weight] as const);
      }
    }
    out[intent] = entries;
  }
  return out;
}
