export interface ProvenanceLayerInput {
  readonly name: string;
  readonly addedModifiedLines: number;
  readonly loc: number;
  readonly importance: number;
}

export interface ProvenanceLayerResult extends ProvenanceLayerInput {
  readonly originality: number;
  readonly weightedOriginality: number;
}

export interface ProvenanceRatioResult {
  readonly headlineOriginality: number;
  readonly layers: readonly ProvenanceLayerResult[];
  readonly importanceSum: number;
}

export function computeProvenanceRatio(layers: readonly ProvenanceLayerInput[]): ProvenanceRatioResult {
  if (layers.length === 0) throw new Error("provenance ratio requires at least one layer");
  const importanceSum = layers.reduce((sum, layer) => sum + layer.importance, 0);
  if (importanceSum <= 0) throw new Error("provenance layer importance must sum to a positive value");
  const normalizedLayers = layers.map((layer) => {
    const importance = layer.importance / importanceSum;
    const originality = clamp01(layer.loc <= 0 ? 0 : layer.addedModifiedLines / layer.loc);
    return {
      ...layer,
      importance,
      originality: round6(originality),
      weightedOriginality: round6(originality * importance),
    };
  });
  const rawHeadline = layers.reduce((sum, layer) => {
    const importance = layer.importance / importanceSum;
    const originality = clamp01(layer.loc <= 0 ? 0 : layer.addedModifiedLines / layer.loc);
    return sum + (originality * importance);
  }, 0);
  return {
    headlineOriginality: round6(rawHeadline),
    layers: normalizedLayers,
    importanceSum: round6(normalizedLayers.reduce((sum, layer) => sum + layer.importance, 0)),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
