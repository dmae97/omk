# Metacognitive Control Kernel

`src/metacognition/` implements the observation / control / evaluation loop from
`docs/OMK_metacognitive_control_algorithms_2026-09-19.md`, on top of the
skill-and-knowledge control kernel from `docs/OMK_skill_knowledge_control_2026-09-19.zip`.

This is a decision-rules library, not a performance claim. It manages what the
agent *expects*, which *obligations* remain, whether *checks* can actually
detect the defects they cover, and when a *strategy* should switch — all as
host-owned structured state, never as model self-report.

## Modules

| Module | Spec | Purpose |
| --- | --- | --- |
| `knowledge.ts` | §13 core | Claim/evidence gap inspection (`inspectKnowledge`) |
| `knowledge-action.ts` | §13 core | Bounded next action (`nextKnowledgeAction`) |
| `skills.ts` | §13 core | Capability-coverage skill planning (`planSkills`) |
| `retrieval.ts` | §13 core | Local BM25 (`searchCorpus`), owned-promise `AcquisitionPool` |
| `context7.ts` | §13 core | Approved-egress Context7 GET adapter (`Context7Client`) |
| `runtime-bridge.ts` | §13 attach | ClaimGraph/ObservationNode → kernel inputs (`toMetaState`) |
| `evaluation.ts` | §11, §15 | DR offline estimator, experience records, completion metrics |
| `observe.ts` | §13 observe | Observation-mode diagnostics (`attachMetaDiagnostics`) |
| `obligations.ts` | A / §4 | Change-atom rules → candidate vs required obligations |
| `predictions.ts` | B / §5 | Pre-registered prediction ledger, Brier/surprise scoring |
| `decision.ts` | C / §6 | Finite Bayes risk + one-step VOI (`experimentValue`) |
| `verifier.ts` | D / §7 | Obligation-scoped negative-control evaluation (`evaluateVerifier`) |
| `calibration.ts` | E+G / §8, §10 | Condition-bucket Beta records + drift demotion |
| `state.ts` | §3, §9.5 | `MetaState` tuple and the three finish states |
| `policy.ts` | F / §9, §14 | Feasibility gating + priority-table action selection |
| `checkpoint.ts` | §9.4 | One ordered checkpoint evaluation (`checkpoint`) |

## Invariants enforced

- Required approvals and required checks are hard constraints, not optimization
  inputs.
- Predictions are registered before outcomes and never overwritten; edits append.
- Model-produced obligations stay candidates until host facts promote them.
- Mutant counts exclude compile-broken, environment-failed, and equivalent
  mutants; an empty denominator reports `unknown`, never a score.
- `max VOI <= 0` never implies verified completion; receipts must bind to the
  current candidate hash.
- Environment failures are recorded separately from code failures — neither
  inflates nor silently discards the other.

## Primitive hardening

The September 21, 2026 review's WP00 fixes harden the local library without
changing the default CLI workflow or enabling a supervisor.

### Contracts and compatibility

- Operations cannot return to observation or proposal after authorization or
  dispatch. Replanning requires a new operation.
- Observations and authorization inputs are copied and frozen. Dispatch must
  match the saved intent, approval, policy version and lease generation, even
  when a replacement permit is internally consistent.
- Permit flags and postconditions must be booleans. Binding strings are bounded
  and nonempty, and generations use canonical decimal `Sequence` values.
- Only unresolved dispatched outcomes can settle. Repeating the current outcome
  is idempotent, including history. Applied and confirmed-failure outcomes cannot
  be overwritten. Cancellation is still not proof of termination.
- The broker validates and snapshots claims before changing state. Malformed or
  sparse arrays cannot acquire or start effects, or expire another reservation.
- Exact claim-set binding includes generation; resource conflicts still ignore
  generation. A changed generation requires readmission before `start`.
- `claimKey` uses a JSON tuple including generation instead of NUL delimiters.
  Consumers must recompute keys rather than mix old and new formats. This
  in-memory kernel provides no durable key migration.
- Instance IDs reject NUL and lengths over 4096; canonical keys also reject
  backslashes. Deadline sums must be safe integers, and sequence increments
  remain within the existing 40-digit wire limit.

### Numerical behavior and tests

Temperature scaling shifts log probabilities before dividing by temperature, so
`Number.MIN_VALUE` preserves a nonzero maximum and finite ties. Log loss rejects
clips whose upper boundary rounds to one and uses `Math.log1p`.

Clopper-Pearson bounds invert the beta survival probability without rounding
`1 - alpha` to one; zero failures use the closed form. Incomplete beta rejects
invalid arguments, non-convergence and invalid results. Bonferroni adjustment
rejects comparison-count overflow and alpha underflow. These floating-point
calculations are not interval-arithmetic proofs or next-action guarantees.

From `packages/coding-agent`:

```bash
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/primitive-hardening.test.ts test/primitive-boundaries.test.ts test/primitive-numeric-oracle.test.ts
```

The original 41 regression cases reproduced 28 failures before the six source
fixes and passed afterwards. The seeded broker model runs 64 seeds with 512
transitions each, branch-count assertions, and an independent component-overlap
oracle. Additional sparse-array regressions cover a gap in the supplied patch.
These are regression cases, not independent product failures or task successes.

`test/fixtures/primitive-numeric-oracle.json` contains 282 fixed values from
SciPy 1.17.0 `scipy.stats.beta.isf(alpha, k + 1, n - k)` (one when `k == n`).
The grid uses `n` in `{1, 2, 10, 100, 300, 1000, 10000, 100000, 1000000}`, valid
unique `k` in `{0, 1, 2, n // 2, n - 1, n}`, and alpha in
`{0.1, 0.05, 0.01, 1e-6, 1e-12, 1e-20}`. Tolerance is
`1e-9 + 1e-8 * abs(expected)`. Before hardening, 48 values exceeded tolerance;
afterwards all passed, with maximum absolute error about `6.82e-14` on this grid.
Tests require neither Python nor network access. Other numerical domains are
not established by this fixture.

### Integration boundary

The coordination and metacognition barrels are re-exported from `src/index.ts`.
In the reviewed source, `AdmissionBroker`, `OperationLifecycle`, temperature
scaling and Clopper-Pearson bounds have no production execution call sites.
`AdmissionBroker.start` uses the strengthened `sameClaimSet`; tests exercise
real implementations, not a mock supervisor. Library availability does not
mean the default agent loop enforces these contracts.

The review's WP01-WP07 remain separate work: an end-to-end verified runtime path,
worker/descendant termination, durable recovery, immutable candidate publication,
loss-aware bridge mapping, shared UI/SDK states, and same-budget efficacy
experiments. Additional primitive proposals are not part of these six fixes.
No release, OS fencing, durable recovery or automatic completion-verification
claim follows from these tests. See [Development](development.md) for the
repository check and explicit test-filter workflow.

## Tests

`test/metacognition-*.test.ts` — 94 tests, including the 13 numerical checks
ported from `check_examples.py` (Brier 0.9025 at p=0.95 failure, VOI 0.84,
XOR two-bit synergy 0.40, probability-vector rejection) and the reference
kernel's contract tests.
