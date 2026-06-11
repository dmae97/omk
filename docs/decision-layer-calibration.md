# Decision-Layer Formalization And Calibration

This note tracks the implementation of the June 11 decision-layer hardening spec.

## Implemented

- Route scoring source prior is now a strict tiebreaker: `project=0.02`, `builtin=0.01`, `global=0`.
- Route scoring computes a base-score lattice gap and asserts `priorSpread < minBaseGap` at module load.
- Route selection emits bounded `routeTrace` records with `baseScore`, `sourcePrior`, final `score`, features, and reason for benchmark replay.
- Route calibration helpers implement simplex projection, structured perturbation candidates, smooth keyword saturation, and exact paired McNemar adoption.
- Trust calibration helpers implement underpowered-data refusal, MAP-style logistic fitting with shrinkage to current checklist weights, AUC comparison, and threshold selection.
- Ensemble decision can consume Hedge persona weights; the Hedge module updates online weights with an anti-collapse floor and collapse alert.
- Provenance ratio helpers and `npm run provenance:ratio` report layer-wise originality against an upstream or merge-base fallback.
- CI fast gate includes a new-file size guard for source/test/script files over 1,000 LoC.

## Deferred

- `git filter-repo --path proof/ --invert-paths` is destructive and requires explicit branch/tag/force-push scope confirmation before execution.
- Trust and Hedge adoption should be persisted only after enough labeled runs exist (`n >= 100` for trust calibration).
- Route calibration needs a benchmark suite with at least 50 paired tasks before changing production weights.
