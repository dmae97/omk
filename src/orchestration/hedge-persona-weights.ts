import type { NextAction } from "../contracts/orchestration.js";

export interface PersonaWeightState {
  readonly weights: Record<string, number>;
  readonly eta: number;
  readonly floor: number;
  readonly horizon: number;
}

export interface PersonaVoteOutcome {
  readonly id: string;
  readonly action: NextAction;
}

export interface PersonaWeightUpdateResult {
  readonly state: PersonaWeightState;
  readonly collapseAlert: boolean;
  readonly dominantShare: number;
}

export function createHedgePersonaWeights(
  personaIds: readonly string[],
  options: { horizon?: number; floor?: number } = {},
): PersonaWeightState {
  const uniqueIds = [...new Set(personaIds)].filter(Boolean);
  if (uniqueIds.length === 0) throw new Error("Hedge persona weights require at least one persona");
  const horizon = Math.max(1, options.horizon ?? 100);
  const floor = Math.max(0, options.floor ?? 0.3);
  const eta = Math.sqrt((8 * Math.log(uniqueIds.length)) / horizon);
  return {
    weights: Object.fromEntries(uniqueIds.map((id) => [id, 1])),
    eta,
    floor,
    horizon,
  };
}

export function updateHedgePersonaWeights(
  state: PersonaWeightState,
  votes: readonly PersonaVoteOutcome[],
  correctAction: NextAction,
): PersonaWeightUpdateResult {
  const ids = Object.keys(state.weights);
  const voteById = new Map(votes.map((vote) => [vote.id, vote.action]));
  const decayed: Record<string, number> = {};
  for (const id of ids) {
    const loss = voteById.get(id) === correctAction ? 0 : 1;
    decayed[id] = state.weights[id] * Math.exp(-state.eta * loss);
  }
  const sum = Object.values(decayed).reduce((acc, value) => acc + value, 0);
  const scaled: Record<string, number> = {};
  for (const id of ids) {
    scaled[id] = Math.max(state.floor, (ids.length * decayed[id]) / Math.max(Number.EPSILON, sum));
  }
  const scaledSum = Object.values(scaled).reduce((acc, value) => acc + value, 0);
  const normalized = Object.fromEntries(ids.map((id) => [id, round6((ids.length * scaled[id]) / scaledSum)]));
  const total = Object.values(normalized).reduce((acc, value) => acc + value, 0);
  const dominantShare = Math.max(...Object.values(normalized)) / Math.max(Number.EPSILON, total);
  return {
    state: { ...state, weights: normalized },
    collapseAlert: dominantShare > 0.5,
    dominantShare: round6(dominantShare),
  };
}

export function applyPersonaWeights<T extends { id: string; weight: number }>(
  votes: readonly T[],
  state: PersonaWeightState,
): T[] {
  return votes.map((vote) => ({ ...vote, weight: state.weights[vote.id] ?? vote.weight }));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
