# Spec 121 — Evidence-driven harness improvements

Date: 2026-11-12. Baseline: `3045c4ca2f548865b4638759a4e253cd23333688`,
with spec 120 decision I1's reviewed G0 corpus. Status: active, staged work.
Owner request: finish K0 and strengthen subsequent harness work using applicable
primary research. No publication, provider spend or blanket dependency approval.

## Impact and chosen path

**Advance:** improve evidence freshness and repeated-trial measurement before
adding more orchestration. **Preserve:** G0/I1, permissions, budgets, single-writer
ownership, model/provider contracts, extension semantics and existing audit output.

Research is recorded in `packages/coding-agent/docs/harness-research-2026-11.md`.
The chosen path is outcome-verified incremental execution with explicit continuity,
then measured context/routing improvements. It is not a new orchestrator and does
not install AutoGen, ADK, Claude SDK or an external research implementation.

## First independently testable units

### H1: checkpoint freshness is visible

Current `formatDurableGoalCheckpoint()` prints historical evidence as `Verified`
after a round advance, although its generation no longer matches. The continuation
wrapper warns about this, but direct SDK/UI formatting does not distinguish it.

- Preserve the existing checkpoint schema, digest and trust boundary.
- Current generation keeps the existing `Verified:` label.
- Prior generation renders `Historical evidence (reverify):` and never a
  `Verified:` label, including after serialization and through controller display.
- No checkpoint means the existing output exactly. Clearing/editing remains unchanged.
- Metric: false-current-evidence labels on stale fixtures. Baseline: 1 failing
  scenario at the pinned source. Target/floor: zero; all current/absent controls pass.
- Verify: focused `durable-goal-checkpoint` and `goal-controller-checkpoint` Vitest
  files, current-source LSP, repository check and fresh G0/I1 comparison.

This label is not an attestation or an independent verifier. Existing receipt and
workspace-fingerprint gates remain authoritative.

### H2: repeated offline evaluation

The existing `tb21-audit` validates exactly one trial per task per arm. Keep that
API and report unchanged. Add a separate explicit repeat-set input which pins
multiple existing audit manifests by digest; never search for latest jobs.

- Every repeat uses identical task/checksum, dataset, declared conditions,
  per-arm model/harness/adapter identities. Per-repeat run IDs differ.
- Every original audit must pass; missing trials, costs, nonterminal records or
  altered manifests fail the whole report, not a reduced denominator.
- Reject reused trial IDs across repeats, duplicate manifests and unsafe paths.
- Report per-task successes/n, empirical pass@1, finite-sample pass@k
  `1-C(n-c,k)/C(n,k)` and all-success `C(c,k)/C(n,k)` (labelled pass^k estimator).
  Macro-average tasks equally; never pool unequal task sizes or substitute
  `(c/n)^k`. Enforce `1 <= k <= n`, with a bounded input size.
- Keep timeouts as failures and retain their costs. Unknown cost is not zero.
- Record all input digests and explicit limits: no proof of independent trials,
  same actual model, truthful grading, real billing or statistical superiority.
- Metric: false-complete reports for invalid repeat sets. Target/floor: zero on
  mutation cases. Numerical gate: exact small combinatorial examples, k=1/k=n,
  all-fail/all-pass, no NaN/overflow. Existing single-run report byte shape preserved.
- Verify: new repeat-audit tests plus the three existing TB audit test files,
  strict JS typecheck, then `npm run check`.

H2 is checkout-only evaluation infrastructure. It runs no agent and demonstrates
no solve-rate improvement by itself.

### H3a/H7a: executable recovery and authority corpus

The next scoped unit preserves existing runtime behavior and advances regression
measurement. At baseline `3045c4ca2f`, the relevant tests exist separately but no
fixed H3/H7 inventory checks that every selected case actually ran. Add
[corpus.json](corpus.json) and a checkout-only runner; reuse 32 existing cases,
add one live-loopback isolation attack and one permitted-read control, and tighten
the outside-write-scope test to assert the original workspace is unchanged.

- Inventory: exactly 20 uniquely identified recovery cases and seven distinct
  attack/control pairs, with exact test file and full test name.
- Target: all 34 selected cases pass once. Missing/duplicate/renamed/skipped cases,
  failed hooks or unexpected executed cases cannot become a successful report.
- Regression floor: all existing scenario assertions stay intact; no mocked
  executor for the new sandbox pair, no backend-unavailable skip or policy bypass.
- Guard metric: zero false passes on report/manifest mutations, including a
  missing case, skip, changed filename, hook failure and duplicate identity.
- Verification: `node scripts/verify-harness-corpus.mjs`,
  `node --test scripts/test/harness-corpus.test.mjs`, strict JS typecheck and
  `npm run check`. Report IDs and corpus/test digests; keep raw failures local.
- Evidence: `tasks.md` plus the runner's JSON output. The corpus baseline is a
  comparison reference, not an assertion that the current dirty source equals it.

This delivers the first corpus, not H3's opt-in resume preflight or H7 platform
certification. Existing reduced-state/crash-window fixtures are not described as
all being process-kill tests. The new Linux TCP experiment touches only a temporary
host loopback listener. No model, external service or real credential is used.

## Promotion contract for later runtime work

Before changing routing, context pruning, memory, retries or verifier selection:
freeze the same model/provider/configuration, task revision, tool permissions,
environment, budget, stop policy, grader digest and analysis plan. Use isolated
paired trials; keep capability and regression suites separate. Compare one
component at a time. Record failures, abstentions, missingness and costs, not only
successful runs. Full protocol and stage gates are in the accompanying roadmap.

No research coefficient or anecdotal gain is a production threshold. Model judges
may advise only after deterministic checks and cannot grant authority, waive
failures or certify their own output. Any paid evaluation requires a user dollar
cap. Untrusted retrieved content cannot modify approvals or executable plans.

## Scope exclusions

No runtime default flip, new Rust crate, CI workflow change, model invocation,
automatic context reset, new scheduler, mutable self-written pass criteria,
benchmark fixture laundering, auto-publication or imported vendor prompt/code.
K1 dependency approval and K5 native artifact acceptance remain spec 120 gates.
