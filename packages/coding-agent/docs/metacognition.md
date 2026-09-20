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

## Tests

`test/metacognition-*.test.ts` — 94 tests, including the 13 numerical checks
ported from `check_examples.py` (Brier 0.9025 at p=0.95 failure, VOI 0.84,
XOR two-bit synergy 0.40, probability-vector rejection) and the reference
kernel's contract tests.
