# ECRAF dimensionless normalization (R11)

Status: **pure planner, opt-in, not wired** — the same gate vocabulary as
[runtime-algorithms](./runtime-algorithms.md) applies. This page documents what is
implemented and verified, and states explicitly what remains unproven.

## Versions

`planEcrafAdmissions()` accepts an explicit `algorithmVersion`:

| Version | Density formula | When selected |
| --- | --- | --- |
| `legacy-v1` (default when omitted) | `P_i / (epsilon + Σ_r weight_r · a_ir)` | No normalization options supplied. |
| `normalized-v2` | `P_i / (epsilon + slotCost + Σ_r weight_r · a_ir / s_r)` | `algorithmVersion: "normalized-v2"` **or** `referenceScales` supplied without a version (compatibility with the earlier scales-only opt-in). |

Compatibility policy:

- Omitting `algorithmVersion` and every normalization option reproduces the
  byte-for-byte legacy plan. Legacy regression and property tests are unchanged.
- Supplying `referenceScales` (or `slotCost`) with `legacy-v1` is rejected with
  `RangeError`; the scales-only shape silently choosing a different algorithm was
  the ambiguity this version policy closes.
- Unknown versions and unknown future options are rejected, not coerced.

## normalized-v2 semantics (spec §13.2)

- Every resource with a nonzero demand needs a positive finite reference scale
  `s_r`. In `normalized-v2` omitted entries default to the resource's **positive
  total capacity** — never remaining headroom — so the caller cannot implicitly
  re-scale ranking by scheduling pressure. Unbounded resources (capacity omitted)
  cannot fall back to a scale and require an explicit one.
- Zero capacity is a **feasibility gate**, not a scale: a positive demand on a
  zero-capacity resource is deferred before scoring; a zero demand still uses the
  resource in the legacy sense (admission fails on held usage), so the documented
  "missing capacity = unbounded" and `capacity: 0` meanings are preserved.
- `slotCost` (λ_slot) is finite and **positive**; the slot term charges every
  running candidate one execution slot even when its resource vector is empty or
  all-zero, so an empty node cannot dominate on `epsilon` alone.
- Infinite capacities are rejected in v2 (`RangeError`); the legacy finite-input
  contract is unchanged. Finite inputs can still overflow the denominator,
  density, or reserved usage, and those derived values are rejected with
  `RangeError` as before.

## Verified properties (unit invariance, spec §13.3)

`a'_ir = c_r·a_ir` with `s'_r = c_r·s_r` (`c_r > 0`) produces the identical plan.
The seeded property test (`tool-dag-ecraf-normalization.test.ts`) replays the same
batch under independent power-of-two memory/CPU rescaling, both bounded and
unbounded, with conflicts, held usage, and slot caps, and additionally asserts
partition completeness, slot bounds, feasibility, conflict invariants, and input
immutability. The spec's worked example holds: memory scale 4 GiB / CPU scale 8
gives A = 0.625 < B = 0.75 in both GiB and byte units.

Unit normalization is **not** a fairness guarantee or an optimality proof, and it
is not equivalent to DRF.

## What this is not

- **No live path calls the planner.** `runDagFrontier()` in
  `packages/agent/src/agent-loop.ts` admits ready calls by source order and
  settled-claim conflicts; it does not import `tool-dag-ecraf`. There is no
  shadow recording, feature flag, or default change, and **no measured benefit**
  is claimed anywhere.
- **The conflict predicate covers only this pass.** A live caller must re-check
  unsettled claims, re-validate post-hook arguments, and refuse stale plans
  before granting (spec §13.4). None of that wiring exists.
- Starvation/fairness accounting (spec §13.5) and same-budget comparisons
  (§13.6 steps 4–6) are separate, unstarted work.

## Tests

- `packages/agent/test/tool-dag-ecraf-normalization.test.ts` — version policy,
  scale derivation, zero-capacity gating, slot cost, overflow/validation
  boundaries, unit-invariance property test (seed 110917, 300 runs).
- `packages/agent/test/tool-dag-ecraf.test.ts` — legacy behavior, input
  rejection, admission invariants, and the §13.3 GiB/bytes ranking-flip example.
- `packages/agent/test/tool-dag-ecraf-arithmetic.test.ts` — finite-arithmetic
  overflow rejection, unchanged.

Mutation/negative-control evidence: removing the demand/scale division, weakening
slot-cost positivity to `< 0`, removing the zero-capacity gate, or removing the
version whitelist each makes the assertion harness fail (run from a /tmp mutant
copy; the working tree was not modified during the check).
